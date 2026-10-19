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
  'transactiondate', 'statusdate', 'updatedat', 'date', 'datetime', 'eventdate'
];

// A courier may wrap the thing we want in `data`, `payload`, `order` or
// nothing at all, so the body is flattened a couple of levels and then read by
// name. Deeper than that is a different message, not a wrapper.
function flatten(obj, depth, out) {
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

function pick(flat, names) {
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
    when: pick(flat, DATE_KEYS)
  };
}

/* ==================== writing it down ==================== */

// One parcel's status, moved on. Only ever the status: a webhook is a nudge
// about one thing, and the money side of an order stays the sweep's business.
export async function applyStatus(account, { tracking, status, group, when }) {
  if (!tracking || !status) return false;

  const delivered = group === 'delivered';
  const day = (() => {
    if (!when) return null;
    const m = String(when).match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
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
  return r.rowCount > 0;
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
