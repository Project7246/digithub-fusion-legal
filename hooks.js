// The couriers calling us, instead of us calling them every half hour.
//
// A sweep every thirty minutes is the most a courier that only answers
// questions can give us. But several of these couriers will push a status the
// moment it changes - PostEx has a Status Updates Webhook in the merchant
// portal, Sonic has four - and a parcel marked delivered at ten past three
// should say so at ten past three, not at half past.
//
// What a webhook needs, and what is easy to get wrong:
//
//  - It is called by somebody who has never signed in, so it cannot sit behind
//    the session. The address itself has to be the secret, and then some.
//  - Two secrets, not one. The key in the address says *which account* this is
//    (a courier portal gives one URL per merchant account, and we hold several);
//    the header says *that it is really them*. A guessed address alone gets
//    nowhere.
//  - It must answer fast and it must answer 200 even when the parcel is one we
//    have never seen. A courier that gets a 500 retries, backs off, and
//    eventually turns the hook off - so a parcel we do not know is logged and
//    accepted, not refused.
//  - We do not know the exact shape of every courier's body, and the PostEx
//    guide does not document it. So the reader is deliberately forgiving: it
//    hunts for a tracking number and a status wherever they are, and every call
//    is kept for a while so the real shape can be read off the screen and the
//    mapping tightened.

import crypto from 'crypto';
import { pool } from './db.js';

// How many calls per account are kept. Enough to see what is arriving and to
// catch a run of failures; not enough to grow into the database's problem.
const KEEP = 60;

export async function initHooks() {
  await pool.query(`
    ALTER TABLE courier_accounts
      ADD COLUMN IF NOT EXISTS hook_key    TEXT,
      ADD COLUMN IF NOT EXISTS hook_secret TEXT,
      ADD COLUMN IF NOT EXISTS hook_at     TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS hook_hits   INTEGER DEFAULT 0
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS courier_accounts_hook
      ON courier_accounts (hook_key) WHERE hook_key IS NOT NULL
  `);

  // What arrived, so the shape can be read off the screen rather than guessed
  // at. realm_id is on it like every other table that holds a company's work.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS courier_hook_log (
      id         SERIAL PRIMARY KEY,
      realm_id   TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      courier    TEXT,
      at         TIMESTAMPTZ DEFAULT NOW(),
      tracking   TEXT,
      status     TEXT,
      matched    BOOLEAN DEFAULT FALSE,
      note       TEXT,
      body       JSONB
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS courier_hook_log_acc
      ON courier_hook_log (account_id, id DESC)
  `);
}

const rand = n => crypto.randomBytes(n).toString('hex');

// The two secrets for one account, made the first time they are asked for and
// the same ones from then on - the address is pasted into a courier's portal,
// so it must not change underneath them.
export async function hookFor(realmId, accountId) {
  const r = await pool.query(
    `SELECT id, courier, label, hook_key, hook_secret, hook_at, hook_hits
       FROM courier_accounts WHERE realm_id = $1 AND id = $2`,
    [realmId, Number(accountId)]
  );
  const a = r.rows[0];
  if (!a) throw new Error('No such account');

  if (!a.hook_key || !a.hook_secret) {
    const key = rand(16), secret = rand(24);
    await pool.query(
      'UPDATE courier_accounts SET hook_key = $2, hook_secret = $3 WHERE id = $1',
      [a.id, key, secret]
    );
    a.hook_key = key; a.hook_secret = secret;
  }

  return {
    id: a.id, courier: a.courier, label: a.label,
    key: a.hook_key, secret: a.hook_secret,
    lastAt: a.hook_at, hits: a.hook_hits || 0,
    header: 'X-Fusion-Key'
  };
}

// Two locks, and one of them has to move for Trax.
//
// The second secret was a header, because a header is the one thing a guessed
// address cannot carry. But Sonic's webhook screen takes **a URL and nothing
// else** - there is no field to put a header in - so for a courier like that
// the secret rides on the end of the address as `?k=`, and the route takes it
// from either place. It is the same secret and the same two locks; what
// changes is which part of the request carries the second one.
export function hookUrl(base, h, headerless) {
  const url = base.replace(/\/+$/, '') + '/hooks/courier/' + h.courier + '/' + h.key;
  return headerless ? url + '?k=' + h.secret : url;
}

// Whichever way it arrived. A header is preferred where a courier can send
// one; the query is what makes a headerless portal workable.
export function secretFrom(req) {
  return req.get('X-Fusion-Key') || req.get('x-fusion-key') ||
         (req.query && (req.query.k || req.query.key)) || '';
}

// Turned over when somebody thinks the old one got out. The address changes
// with it, which is the point: whatever was pasted anywhere stops working.
export async function rollHook(realmId, accountId) {
  await pool.query(
    'UPDATE courier_accounts SET hook_key = NULL, hook_secret = NULL WHERE realm_id = $1 AND id = $2',
    [realmId, Number(accountId)]
  );
  return hookFor(realmId, accountId);
}

export async function accountByHookKey(key) {
  if (!key || !/^[a-f0-9]{8,64}$/.test(String(key))) return null;
  const r = await pool.query(
    `SELECT id, realm_id, courier, label, hook_secret
       FROM courier_accounts WHERE hook_key = $1`,
    [String(key)]
  );
  return r.rows[0] || null;
}

// Same length or not, comparing takes the same time - a secret compared with
// === leaks its first wrong character to anyone patient enough to measure.
export function sameSecret(given, kept) {
  const a = Buffer.from(String(given || ''), 'utf8');
  const b = Buffer.from(String(kept || ''), 'utf8');
  if (!b.length) return false;
  const pad = Buffer.alloc(Math.max(a.length, b.length));
  const x = Buffer.concat([a, pad]).subarray(0, pad.length);
  const y = Buffer.concat([b, pad]).subarray(0, pad.length);
  return crypto.timingSafeEqual(x, y) && a.length === b.length;
}

/* ==================== reading whatever arrived ==================== */

const TRACK_KEYS = [
  'trackingnumber', 'trackingno', 'tracking', 'cn', 'cnnumber', 'cn_number',
  'consignmentnumber', 'consignment', 'awb', 'awbnumber', 'trackingid'
];
const STATUS_KEYS = [
  'transactionstatus', 'transactionstatusmessage', 'orderstatus', 'status',
  'statusmessage', 'shipmentstatus', 'currentstatus', 'statusname'
];
const REF_KEYS = [
  'orderrefnumber', 'orderref', 'orderid', 'reference', 'referenceno', 'customerreference'
];
const DATE_KEYS = [
  'transactiondate', 'statusdate', 'updatedat', 'date', 'datetime', 'eventdate',
  'deliverydate', 'delivereddate', 'statusdatetime'
];
// Read as well as the status, because of what happens below when the parcel is
// one we have never heard of: whatever the courier troubled itself to send is
// better than an empty row waiting for the next sweep.
const MONEY_KEYS = [
  'invoicepayment', 'codamount', 'cod', 'amount', 'collectableamount',
  'orderamount', 'invoicevalue'
];
const CITY_KEYS = [
  'cityname', 'city', 'destinationcity', 'consigneecity', 'deliverycity', 'tocity'
];

// A courier may wrap the thing we want in `data`, `payload`, `order` or
// nothing at all, so the body is flattened a couple of levels and then read by
// name. Deeper than that is a different message, not a wrapper.
// Exported, because a courier's own answers are as loosely shaped as its
// webhooks: trax.js and mnp.js read their order rows with these two as well,
// so there is one way in this app of finding a field in somebody else's JSON.
export function flatten(obj, depth, out) {
  out = out || {};
  if (!obj || typeof obj !== 'object' || depth > 3) return out;
  Object.keys(obj).forEach(k => {
    const v = obj[k];
    const key = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (v === null || typeof v !== 'object') {
      if (out[key] === undefined) out[key] = v;
    } else if (Array.isArray(v)) {
      if (v.length && typeof v[0] === 'object') flatten(v[0], depth + 1, out);
    } else {
      flatten(v, depth + 1, out);
    }
  });
  return out;
}

export function pick(flat, names) {
  for (const n of names) {
    const v = flat[n];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

export function readHook(body) {
  const flat = flatten(body, 0);
  return {
    tracking: pick(flat, TRACK_KEYS),
    status: pick(flat, STATUS_KEYS),
    ref: pick(flat, REF_KEYS),
    when: pick(flat, DATE_KEYS),
    amount: pick(flat, MONEY_KEYS),
    city: pick(flat, CITY_KEYS)
  };
}

/* ==================== writing it down ==================== */

// One parcel, moved on. For a parcel we hold, only the status is touched: the
// money side of an order is what the sweep reads, and a webhook saying "0" is
// not the courier saying the order is worth nothing.
//
// A parcel we have never heard of is written down instead of being dropped.
// That matters more than it looks: the sweep is deliberately rare now on an
// account whose webhook is live, so a parcel booked and delivered between two
// sweeps used to be invisible for hours and the log only said "not here yet".
// What the hook sent is kept, the next sweep fills in the rest, and the whole
// point of the webhook - not having to ask - holds.
//
// Returns 'updated', 'added' or false, because the log says which happened.
export async function applyStatus(account, hook) {
  const { tracking, status, group, when, ref } = hook || {};
  if (!tracking || !status) return false;

  const delivered = group === 'delivered';
  const day = (() => {
    if (!when) return null;
    const m = String(when).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(when);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  })();

  const r = await pool.query(
    `UPDATE courier_orders
        SET status       = $4,
            status_group = $5,
            delivered_on = CASE WHEN $6::boolean
                                THEN COALESCE($7::date, delivered_on, CURRENT_DATE)
                                ELSE delivered_on END,
            seen_at      = NOW()
      WHERE realm_id = $1 AND account_id = $2 AND tracking = $3`,
    [account.realm_id, account.id, String(tracking), status, group, delivered, day]
  );
  if (r.rowCount > 0) return 'updated';

  const amount = Number(String(hook.amount || '').replace(/[^0-9.\-]/g, ''));

  await pool.query(
    `INSERT INTO courier_orders
       (realm_id, account_id, courier, tracking, order_ref, status, status_group,
        amount, city, booked_on, delivered_on, raw, seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
             COALESCE($10::date, CURRENT_DATE),
             CASE WHEN $11::boolean THEN COALESCE($10::date, CURRENT_DATE) END,
             $12, NOW())
     ON CONFLICT (realm_id, account_id, tracking) DO NOTHING`,
    [account.realm_id, account.id, account.courier, String(tracking),
     ref || null, status, group, isNaN(amount) ? 0 : amount,
     hook.city || null, day, delivered,
     JSON.stringify({ fromWebhook: true, at: new Date().toISOString() })]
  );

  return 'added';
}

// What a charges webhook said a parcel cost. Only ever written over a zero or
// a missing figure for the amount - the sweep's own reading of what the order
// is worth is the better one - but the fee and the tax are the courier's to
// state, so those are taken as given.
export async function applyCharges(account, hook) {
  const tracking = hook && hook.tracking;
  if (!tracking) return false;

  const n = v => {
    const x = Number(String(v === undefined || v === null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isNaN(x) ? null : x;
  };

  const fee = n(hook.fee), tax = n(hook.tax), amount = n(hook.amount);
  if (fee === null && tax === null && amount === null) return false;

  const r = await pool.query(
    `UPDATE courier_orders
        SET fee     = COALESCE($4::numeric, fee),
            tax     = COALESCE($5::numeric, tax),
            amount  = CASE WHEN COALESCE(amount, 0) = 0 AND $6::numeric IS NOT NULL
                           THEN $6::numeric ELSE amount END,
            seen_at = NOW()
      WHERE realm_id = $1 AND account_id = $2 AND tracking = $3`,
    [account.realm_id, account.id, String(tracking), fee, tax, amount]
  );

  if (r.rowCount > 0) return 'updated';

  // The charges hook can beat the status hook to it, so the parcel may be one
  // we have not met. The row is made with what this hook knows and the next
  // thing to arrive fills in the status.
  await pool.query(
    `INSERT INTO courier_orders
       (realm_id, account_id, courier, tracking, status, status_group,
        amount, fee, tax, city, booked_on, raw, seen_at)
     VALUES ($1,$2,$3,$4,'','other',
             COALESCE($5::numeric, 0), COALESCE($6::numeric, 0), COALESCE($7::numeric, 0),
             $8, CURRENT_DATE, $9, NOW())
     ON CONFLICT (realm_id, account_id, tracking) DO NOTHING`,
    [account.realm_id, account.id, account.courier, String(tracking),
     amount, fee, tax, hook.city || null,
     JSON.stringify({ fromWebhook: 'charges', at: new Date().toISOString() })]
  );
  return 'added';
}

// A payment webhook is the courier saying it has paid for this parcel. The
// courier's own id for that payment is the nearest thing to a receipt number,
// so it goes where PostEx's CPR number goes and the receipts page finds it.
export async function applyPayment(account, hook) {
  const tracking = hook && hook.tracking;
  if (!tracking) return false;

  const when = (() => {
    if (!hook.when) return null;
    const m = String(hook.when).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(hook.when);
    return isNaN(d.getTime())
      ? null
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const r = await pool.query(
    `UPDATE courier_orders
        SET settled    = CASE WHEN $4::boolean THEN TRUE ELSE settled END,
            settled_on = COALESCE($5::date, settled_on),
            cpr_number = COALESCE(NULLIF($6, ''), cpr_number),
            seen_at    = NOW()
      WHERE realm_id = $1 AND account_id = $2 AND tracking = $3`,
    [account.realm_id, account.id, String(tracking),
     hook.settled !== false, when, String(hook.paymentId || '')]
  );

  return r.rowCount > 0 ? 'updated' : false;
}

export async function logHook(account, { tracking, status, matched, note, body }) {
  await pool.query(
    `INSERT INTO courier_hook_log
       (realm_id, account_id, courier, tracking, status, matched, note, body)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [account.realm_id, account.id, account.courier,
     tracking || null, status || null, !!matched, note || null,
     JSON.stringify(body || {})]
  );

  await pool.query(
    'UPDATE courier_accounts SET hook_at = NOW(), hook_hits = COALESCE(hook_hits,0) + 1 WHERE id = $1',
    [account.id]
  );

  // the log is a window, not an archive
  await pool.query(
    `DELETE FROM courier_hook_log
      WHERE account_id = $1
        AND id <= (SELECT id FROM courier_hook_log
                    WHERE account_id = $1 ORDER BY id DESC OFFSET $2 LIMIT 1)`,
    [account.id, KEEP]
  );
}

export async function recentHooks(realmId, accountId, limit) {
  const r = await pool.query(
    `SELECT at, tracking, status, matched, note, body
       FROM courier_hook_log
      WHERE realm_id = $1 AND account_id = $2
      ORDER BY id DESC LIMIT $3`,
    [realmId, Number(accountId), Math.min(Number(limit) || 20, KEEP)]
  );
  return r.rows;
}
