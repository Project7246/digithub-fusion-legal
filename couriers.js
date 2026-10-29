import { pool } from './db.js';
import { encrypt, decrypt } from './secrets.js';

// Courier accounts, one row per account. PostEx-RB and PostEx-AH are two rows
// sharing one adapter; a whole new courier is a new adapter, not new tables.
export async function initCouriers() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS courier_accounts (
      id          SERIAL PRIMARY KEY,
      realm_id    TEXT NOT NULL,
      courier     TEXT NOT NULL,          -- postex, trax, daewoo
      label       TEXT NOT NULL,          -- PostEx - RB
      token       TEXT NOT NULL,
      active      BOOLEAN DEFAULT TRUE,
      last_sync   TIMESTAMPTZ,
      last_error  TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS courier_accounts_key
      ON courier_accounts (realm_id, courier, label)
  `);

  // A courier's own portal is a second door with its own key. PostEx needs
  // this for cash payment receipts; the integration token above cannot see
  // them. Added on rather than built in, so accounts that predate it carry on
  // working with the token alone.
  await pool.query(`
    ALTER TABLE courier_accounts
      ADD COLUMN IF NOT EXISTS portal_email  TEXT,
      ADD COLUMN IF NOT EXISTS portal_secret TEXT,
      ADD COLUMN IF NOT EXISTS merchant_id   TEXT
  `);

  // PostEx signs in with one token. Trax wants a key and sometimes an account
  // number; M&P want a mailbox, a password and a shipper code. Rather than a
  // column per courier - which is how a table ends up with nine empty ones -
  // each adapter names the fields it needs and whatever is not the token is
  // kept here, encrypted, as one small object.
  await pool.query(`
    ALTER TABLE courier_accounts
      ADD COLUMN IF NOT EXISTS creds TEXT
  `);

  // every order any courier hands back, flattened into one shape
  await pool.query(`
    CREATE TABLE IF NOT EXISTS courier_orders (
      id            SERIAL PRIMARY KEY,
      realm_id      TEXT NOT NULL,
      account_id    INTEGER NOT NULL,
      courier       TEXT NOT NULL,
      tracking      TEXT NOT NULL,
      order_ref     TEXT,
      status        TEXT,
      status_group  TEXT,                 -- booked, transit, delivered, returned...
      amount        NUMERIC(14,2) DEFAULT 0,
      fee           NUMERIC(14,2) DEFAULT 0,
      tax           NUMERIC(14,2) DEFAULT 0,
      city          TEXT,
      booked_on     DATE,
      picked_on     DATE,
      delivered_on  DATE,
      settled       BOOLEAN,
      settled_on    DATE,
      cpr_number    TEXT,
      raw           JSONB,
      seen_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS courier_orders_key
      ON courier_orders (realm_id, account_id, tracking)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS courier_orders_dates
      ON courier_orders (realm_id, booked_on)
  `);

  // The receipt as the courier's own portal knows it - one row per CPR, with
  // its number, its status and what it is worth. What is inside a receipt
  // stays in courier_orders; this is only the cover sheet.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS courier_cprs (
      id           SERIAL PRIMARY KEY,
      realm_id     TEXT NOT NULL,
      account_id   INTEGER NOT NULL,
      courier      TEXT NOT NULL,
      cpr_number   TEXT NOT NULL,
      remote_id    TEXT,                  -- the courier's own id for it
      status       TEXT,
      status_id    INTEGER,
      net_amount   NUMERIC(14,2) DEFAULT 0,
      created_on   TIMESTAMPTZ,
      approved_on  TIMESTAMPTZ,
      qb_payment_id TEXT,                 -- set once it is receipted in QB
      received_on  TIMESTAMPTZ,
      expected_amount NUMERIC(14,2),      -- what the courier said it collected
      received_amount NUMERIC(14,2),      -- what actually went into QuickBooks
      dc_journal_id TEXT,                 -- the delivery-charges journal entry
      dc_posted_on TIMESTAMPTZ,
      raw          JSONB,
      seen_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS courier_cprs_key
      ON courier_cprs (realm_id, account_id, cpr_number)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS courier_cprs_dates
      ON courier_cprs (realm_id, created_on)
  `);

  await pool.query(`
    ALTER TABLE courier_cprs
      ADD COLUMN IF NOT EXISTS expected_amount NUMERIC(14,2),
      ADD COLUMN IF NOT EXISTS received_amount NUMERIC(14,2),
      ADD COLUMN IF NOT EXISTS dc_journal_id   TEXT,
      ADD COLUMN IF NOT EXISTS dc_posted_on    TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS linked_at       TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS cod_amount      NUMERIC(14,2),
      ADD COLUMN IF NOT EXISTS charges_amount  NUMERIC(14,2),
      ADD COLUMN IF NOT EXISTS tax_amount      NUMERIC(14,2),
      ADD COLUMN IF NOT EXISTS wh_amount       NUMERIC(14,2),
      ADD COLUMN IF NOT EXISTS orders_count    INTEGER
  `);
}

// A receipt seen again is updated, never duplicated. What we have already
// done with it in QuickBooks is ours, so those columns are left alone.
export async function saveCprs(realmId, accountId, courier, rows) {
  if (!rows.length) return 0;

  for (const c of rows) {
    if (!c || !c.cprNumber) continue;
    await pool.query(
      `INSERT INTO courier_cprs
         (realm_id, account_id, courier, cpr_number, remote_id, status, status_id,
          net_amount, created_on, approved_on, raw, seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())
       ON CONFLICT (realm_id, account_id, cpr_number) DO UPDATE SET
         remote_id   = EXCLUDED.remote_id,
         status      = EXCLUDED.status,
         status_id   = EXCLUDED.status_id,
         net_amount  = EXCLUDED.net_amount,
         created_on  = EXCLUDED.created_on,
         approved_on = EXCLUDED.approved_on,
         raw         = EXCLUDED.raw,
         seen_at     = NOW()`,
      [realmId, accountId, courier, c.cprNumber, c.remoteId || null,
       c.status || null, c.statusId || null, c.netAmount || 0,
       c.createdOn || null, c.approvedOn || null,
       JSON.stringify(c.raw || {})]
    );
  }

  return rows.length;
}

export async function listPortalCprs(realmId, opts) {
  const where = ['c.realm_id = $1'];
  const args = [realmId];

  if (opts && opts.account) { args.push(Number(opts.account)); where.push(`c.account_id = $${args.length}`); }
  if (opts && opts.courier) { args.push(String(opts.courier)); where.push(`c.courier = $${args.length}`); }
  if (opts && opts.from)    { args.push(opts.from); where.push(`c.created_on >= $${args.length}`); }
  if (opts && opts.to)      { args.push(opts.to + ' 23:59:59'); where.push(`c.created_on <= $${args.length}`); }

  const r = await pool.query(
    `SELECT c.cpr_number, c.remote_id, c.account_id, a.label, c.courier,
            c.status, c.status_id, c.net_amount, c.created_on, c.approved_on,
            c.qb_payment_id, c.received_on, c.expected_amount, c.received_amount,
            c.dc_journal_id, c.dc_posted_on, c.cod_amount, c.charges_amount,
            c.tax_amount, c.wh_amount, c.orders_count
       FROM courier_cprs c
       JOIN courier_accounts a ON a.id = c.account_id
      WHERE ${where.join(' AND ')}
      ORDER BY c.created_on DESC NULLS LAST`,
    args
  );

  const d = v => v ? new Date(v).toISOString().slice(0, 10) : null;

  return r.rows.map(x => ({
    cpr:        x.cpr_number,
    remoteId:   x.remote_id,
    accountId:  x.account_id,
    account:    x.label,
    courier:    x.courier,
    status:     x.status,
    statusId:   x.status_id,
    netAmount:  Math.round(Number(x.net_amount || 0) * 100) / 100,
    createdOn:  d(x.created_on),
    approvedOn: d(x.approved_on),
    qbPaymentId: x.qb_payment_id,
    receivedOn:  d(x.received_on),
    expected:    x.expected_amount == null ? null : Math.round(Number(x.expected_amount) * 100) / 100,
    received:    x.received_amount == null ? null : Math.round(Number(x.received_amount) * 100) / 100,
    dcJournalId: x.dc_journal_id,
    dcPostedOn:  d(x.dc_posted_on),
    codAmount:   x.cod_amount     == null ? null : Math.round(Number(x.cod_amount) * 100) / 100,
    charges:     x.charges_amount == null ? null : Math.round(Number(x.charges_amount) * 100) / 100,
    taxAmount:   x.tax_amount     == null ? null : Math.round(Number(x.tax_amount) * 100) / 100,
    withholding: x.wh_amount      == null ? null : Math.round(Number(x.wh_amount) * 100) / 100,
    orders:      x.orders_count   == null ? null : Number(x.orders_count)
  }));
}

// Stamped once the receipt has been turned into a QuickBooks payment. Both
// amounts are kept so the list can say whether they agreed - a receipt that
// went in short is worth seeing without opening it.
export async function markCprReceived(realmId, accountId, cprNumber, info) {
  const i = info || {};

  // A receipt can be received more than once: the first run takes what it can
  // match, then the invoices that were missing get made and the rest follow.
  // `add` puts the second run on top of the first instead of replacing it, so
  // the total stays honest and the mark can go green.
  await pool.query(
    `UPDATE courier_cprs
        SET qb_payment_id   = COALESCE($4, qb_payment_id),
            received_on     = NOW(),
            expected_amount = COALESCE($5, expected_amount),
            received_amount = CASE
              WHEN $6::numeric IS NULL THEN received_amount
              WHEN $7::boolean THEN COALESCE(received_amount, 0) + $6::numeric
              ELSE $6::numeric
            END
      WHERE realm_id = $1 AND account_id = $2 AND cpr_number = $3`,
    [realmId, accountId, cprNumber, i.qbPaymentId || null,
     i.expected == null ? null : Number(i.expected),
     i.received == null ? null : Number(i.received),
     i.add === true]
  );
}

// The totals off the receipt's own summary. Net is what the courier pays
// out; COD is what it collected, and that is the figure a QuickBooks payment
// has to match. Kept once so the list does not have to ask again.
export async function saveCprTotals(realmId, accountId, cprNumber, t) {
  await pool.query(
    `UPDATE courier_cprs
        SET cod_amount     = $4,
            charges_amount = $5,
            tax_amount     = $6,
            wh_amount      = $7,
            orders_count   = $8
      WHERE realm_id = $1 AND account_id = $2 AND cpr_number = $3`,
    [realmId, accountId, cprNumber,
     t.cod == null ? null : Number(t.cod),
     t.charges == null ? null : Number(t.charges),
     t.tax == null ? null : Number(t.tax),
     t.withholding == null ? null : Number(t.withholding),
     t.orders == null ? null : Number(t.orders)]
  );
}

// which receipts have not had their totals read yet
export async function cprsMissingTotals(realmId, accountId, limit) {
  const r = await pool.query(
    `SELECT cpr_number, remote_id, created_on
       FROM courier_cprs
      WHERE realm_id = $1 AND account_id = $2 AND cod_amount IS NULL
        AND remote_id IS NOT NULL
      ORDER BY created_on DESC NULLS LAST
      LIMIT $3`,
    [realmId, accountId, Number(limit) || 12]
  );
  return r.rows.map(x => ({
    cpr: x.cpr_number,
    remoteId: x.remote_id,
    createdOn: x.created_on
  }));
}

// the delivery charges for a receipt, once they are journalled
export async function markCprCharges(realmId, accountId, cprNumber, journalId) {
  await pool.query(
    `UPDATE courier_cprs
        SET dc_journal_id = $4, dc_posted_on = NOW()
      WHERE realm_id = $1 AND account_id = $2 AND cpr_number = $3`,
    [realmId, accountId, cprNumber, journalId || null]
  );
}

export async function listAccounts(realmId) {
  const r = await pool.query(
    `SELECT id, courier, label, active, last_sync, last_error,
            LENGTH(token) AS token_len,
            portal_email,
            (portal_secret IS NOT NULL) AS portal_ready,
            merchant_id,
            (creds IS NOT NULL) AS creds_ready,
            hook_at, hook_hits
       FROM courier_accounts
      WHERE realm_id = $1
      ORDER BY courier, label`,
    [realmId]
  );
  return r.rows;
}

export async function getAccount(realmId, id) {
  const r = await pool.query(
    `SELECT * FROM courier_accounts WHERE realm_id = $1 AND id = $2`,
    [realmId, id]
  );
  return r.rows[0] || null;
}

export async function addAccount(realmId, { courier, label, token, extra }) {
  const kept = extra && Object.keys(extra).length ? encrypt(JSON.stringify(extra)) : null;

  const r = await pool.query(
    `INSERT INTO courier_accounts (realm_id, courier, label, token, creds)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (realm_id, courier, label)
       DO UPDATE SET token  = EXCLUDED.token,
                     creds  = EXCLUDED.creds,
                     active = TRUE,
                     last_error = NULL
     RETURNING id`,
    [realmId, courier, label, token, kept]
  );
  return r.rows[0].id;
}

// The rest of an account's sign-in, back as the adapter asked for it. A row
// written before this column existed, or one whose key has changed, reads as
// nothing rather than throwing - the token alone is what most couriers need,
// and an account must not become unusable because an extra field cannot be
// read back.
export function credsOf(account) {
  if (!account || !account.creds) return {};
  try {
    const o = JSON.parse(decrypt(account.creds));
    return o && typeof o === 'object' ? o : {};
  } catch (e) {
    return {};
  }
}

// The portal sign-in for an account. The password arrives already encrypted -
// this file never sees the real one.
export async function setPortalLogin(realmId, id, { email, secret, merchantId }) {
  await pool.query(
    `UPDATE courier_accounts
        SET portal_email  = $3,
            portal_secret = COALESCE($4, portal_secret),
            merchant_id   = COALESCE($5, merchant_id)
      WHERE realm_id = $1 AND id = $2`,
    [realmId, id, email || null, secret || null, merchantId || null]
  );
}

export async function clearPortalLogin(realmId, id) {
  await pool.query(
    `UPDATE courier_accounts
        SET portal_email = NULL, portal_secret = NULL
      WHERE realm_id = $1 AND id = $2`,
    [realmId, id]
  );
}

// Taking an account off takes its work with it.
//
// It used to delete the one row and leave every order it had ever pulled
// behind, with an account_id pointing at nothing - which is what happened when
// a PostEx account was attached to the wrong company and taken off again: the
// orders stayed in that company's database, reachable from no screen and
// deletable from none either. Removing an account means the account and what
// it brought in, in one transaction, and the count is handed back so the page
// can say what went.
export async function removeAccount(realmId, id) {
  const n = Number(id);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orders = await client.query(
      `DELETE FROM courier_orders WHERE realm_id = $1 AND account_id = $2`, [realmId, n]);
    const cprs = await client.query(
      `DELETE FROM courier_cprs WHERE realm_id = $1 AND account_id = $2`, [realmId, n]);

    let hooks = { rowCount: 0 };
    try {
      hooks = await client.query(
        `DELETE FROM courier_hook_log WHERE realm_id = $1 AND account_id = $2`, [realmId, n]);
    } catch (e) { /* the log table arrives with initHooks */ }

    await client.query(
      `DELETE FROM courier_accounts WHERE realm_id = $1 AND id = $2`, [realmId, n]);

    await client.query('COMMIT');
    return { ok: true, orders: orders.rowCount, cprs: cprs.rowCount, hooks: hooks.rowCount };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function markSync(realmId, id, error) {
  await pool.query(
    `UPDATE courier_accounts
        SET last_sync = NOW(), last_error = $3
      WHERE realm_id = $1 AND id = $2`,
    [realmId, id, error || null]
  );
}

// an order seen again is updated, never duplicated
export async function saveOrders(realmId, accountId, courier, rows) {
  if (!rows.length) return 0;

  // one round trip per hundred orders instead of one per order
  const CHUNK = 100;
  let saved = 0;

  for (let start = 0; start < rows.length; start += CHUNK) {
    const slice = rows.slice(start, start + CHUNK).filter(o => o.tracking);
    if (!slice.length) continue;

    const values = [];
    const params = [];
    let n = 1;

    slice.forEach(o => {
      values.push(
        `($${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},` +
        `$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++}, NOW())`
      );
      params.push(
        realmId, accountId, courier, o.tracking, o.orderRef || null,
        o.status || null, o.statusGroup || null,
        o.amount || 0, o.fee || 0, o.tax || 0, o.city || null,
        o.bookedOn || null, o.pickedOn || null, o.deliveredOn || null,
        JSON.stringify(o.raw || {})
      );
    });

    await pool.query(
      `INSERT INTO courier_orders
         (realm_id, account_id, courier, tracking, order_ref, status, status_group,
          amount, fee, tax, city, booked_on, picked_on, delivered_on, raw, seen_at)
       VALUES ${values.join(',')}
       ON CONFLICT (realm_id, account_id, tracking) DO UPDATE SET
         status       = EXCLUDED.status,
         status_group = EXCLUDED.status_group,
         amount       = EXCLUDED.amount,
         fee          = EXCLUDED.fee,
         tax          = EXCLUDED.tax,
         city         = EXCLUDED.city,
         picked_on    = EXCLUDED.picked_on,
         delivered_on = EXCLUDED.delivered_on,
         raw          = EXCLUDED.raw,
         seen_at      = NOW()`,
      params
    );

    saved += slice.length;
  }

  return saved;
}
// The courier sends about sixty fields per parcel and we read a dozen. The
// rest is kept as `raw` only so someone can look at what actually arrived
// when a field seems wrong - which is only ever useful for something recent.
// Left alone it is 2.2 KB a parcel against the 250 bytes the columns need,
// and ten accounts would put gigabytes a year into the database for nothing.
// The parcels themselves stay; only the untouched copy is let go.
export async function trimRaw(days) {
  const r = await pool.query(
    `UPDATE courier_orders
        SET raw = '{}'::jsonb
      WHERE seen_at < NOW() - ($1 || ' days')::interval
        AND raw IS NOT NULL
        AND raw <> '{}'::jsonb`,
    [String(Number(days) || 7)]
  );
  return r.rowCount;
}

// The parcels still on their way, for a courier that cannot be asked for a
// span of days and has to be asked parcel by parcel - Trax is one. A parcel
// that has arrived, gone back or been cancelled is finished with, so it is not
// asked about again; everything else, newest first, is.
export async function movingTrackings(realmId, accountId, limit) {
  const r = await pool.query(
    `SELECT tracking FROM courier_orders
      WHERE realm_id = $1 AND account_id = $2
        AND (status_group IS NULL
             OR status_group NOT IN ('delivered','returned','cancelled','expired','lost','damaged')
             OR (status_group = 'delivered' AND settled IS NOT TRUE))
      ORDER BY COALESCE(booked_on, CURRENT_DATE) DESC, id DESC
      LIMIT $3`,
    [realmId, Number(accountId), Math.max(1, Number(limit) || 60)]
  );
  return r.rows.map(x => x.tracking);
}

// which delivered orders we have not asked about yet
// Of these tracking numbers, which are already rows here. Asked before a
// payment's parcels are looked up one at a time, so only the ones this app has
// never heard of cost a call.
export async function haveTrackings(realmId, accountId, list) {
  const want = (list || []).map(t => String(t).trim()).filter(Boolean);
  if (!want.length) return new Set();

  const r = await pool.query(
    `SELECT tracking FROM courier_orders
      WHERE realm_id = $1 AND account_id = $2 AND tracking = ANY($3::text[])`,
    [realmId, accountId, want]
  );
  return new Set(r.rows.map(x => String(x.tracking)));
}

export async function needCpr(realmId, accountId, limit) {
  const r = await pool.query(
    `SELECT tracking FROM courier_orders
      WHERE realm_id = $1 AND account_id = $2
        AND status_group = 'delivered'
        AND cpr_number IS NULL
        AND settled IS DISTINCT FROM FALSE
      ORDER BY delivered_on DESC NULLS LAST
      LIMIT $3`,
    [realmId, accountId, limit || 60]
  );
  return r.rows.map(x => x.tracking);
}

// What the courier said about these parcels' money, written in one query.
//
// It was one UPDATE per parcel in a loop. For a backlog of five thousand
// delivered parcels that is five thousand round trips to Neon, which is slow
// enough that the catching-up never finished and dear enough that it is a
// charge on the month's compute every time it runs.
export async function savePayments(realmId, accountId, rows) {
  const good = (rows || []).filter(p => p && p.tracking);
  if (!good.length) return 0;

  // The fee and tax come with the receipt and are written where they are
  // given - a NULL leaves whatever the parcel already had, so a payment call
  // that says nothing about charges cannot wipe them.
  await pool.query(
    `UPDATE courier_orders o
        SET settled    = v.settled,
            settled_on = v.settled_on,
            cpr_number = v.cpr_number,
            fee        = COALESCE(v.fee, o.fee),
            tax        = COALESCE(v.tax, o.tax)
       FROM (SELECT * FROM unnest(
               $3::text[], $4::boolean[], $5::date[], $6::text[],
               $7::numeric[], $8::numeric[]
             ) AS t(tracking, settled, settled_on, cpr_number, fee, tax)) v
      WHERE o.realm_id = $1 AND o.account_id = $2 AND o.tracking = v.tracking`,
    [realmId, accountId,
     good.map(p => p.tracking),
     good.map(p => p.settled === true),
     good.map(p => p.settledOn || null),
     good.map(p => p.cprNumber || null),
     good.map(p => (p.fee === undefined || p.fee === null) ? null : Number(p.fee)),
     good.map(p => (p.tax === undefined || p.tax === null) ? null : Number(p.tax))]
  );
  return good.length;
}

// A screen that says a parcel has been paid for but does not say which payment
// paid it.
//
// Trax's portal is one: its Summary report carries a payment status per parcel
// and no payment id anywhere on it. savePayments() above is the wrong door for
// that - it writes `cpr_number` from what it was handed, so a row with no id
// would wipe the receipt number the payment webhook had already written down.
//
// This one only ever marks a parcel **paid**, and touches nothing else. A
// parcel the screen said nothing about keeps whatever it had: "this report did
// not mention it" is not "the courier has not paid for it".
export async function markPaid(realmId, accountId, rows) {
  const good = (rows || []).filter(p => p && p.tracking && p.settled === true);
  if (!good.length) return 0;

  const r = await pool.query(
    `UPDATE courier_orders o
        SET settled    = TRUE,
            settled_on = COALESCE(o.settled_on, v.settled_on)
       FROM (SELECT * FROM unnest($3::text[], $4::date[])
                      AS t(tracking, settled_on)) v
      WHERE o.realm_id = $1 AND o.account_id = $2 AND o.tracking = v.tracking
        AND o.settled IS DISTINCT FROM TRUE`,
    [realmId, accountId,
     good.map(p => p.tracking),
     good.map(p => p.settledOn || null)]
  );
  return r.rowCount;
}

// Which receipts have not had their parcels read in yet.
//
// A CPR names every parcel it paid for, and PostEx hands that list over in one
// call. Asking parcel by parcel - five thousand calls for five thousand
// parcels - was the long way round to the same answer: "postex ko khud btna
// chahiy total itny paracels hn or itni payment h". Twenty receipts is twenty
// calls, and they carry the charges and the settlement date with them.
//
// A receipt is read again when the courier has touched it since (approved
// becoming closed is the one that matters), and otherwise never twice.
export async function cprsToLink(realmId, accountId, limit) {
  const r = await pool.query(
    `SELECT cpr_number, remote_id, created_on, status
       FROM courier_cprs
      WHERE realm_id = $1 AND account_id = $2
        AND remote_id IS NOT NULL
        AND (linked_at IS NULL OR linked_at < seen_at)
      ORDER BY created_on DESC NULLS LAST
      LIMIT $3`,
    [realmId, Number(accountId), Number(limit) || 25]
  );
  return r.rows.map(x => ({
    cpr: x.cpr_number,
    remoteId: x.remote_id,
    createdOn: x.created_on,
    status: x.status
  }));
}

export async function markCprLinked(realmId, accountId, cprNumber) {
  await pool.query(
    `UPDATE courier_cprs SET linked_at = NOW()
      WHERE realm_id = $1 AND account_id = $2 AND cpr_number = $3`,
    [realmId, Number(accountId), String(cprNumber)]);
}

// the receipts themselves, built from the orders that carry their number
export async function listCprs(realmId, opts) {
  const where = [`o.realm_id = $1`, `o.cpr_number IS NOT NULL`, `o.cpr_number <> ''`];
  const args = [realmId];

  if (opts && opts.account) {
    args.push(Number(opts.account));
    where.push(`o.account_id = $${args.length}`);
  }
  if (opts && opts.from) {
    args.push(opts.from);
    where.push(`o.settled_on >= $${args.length}`);
  }
  if (opts && opts.to) {
    args.push(opts.to);
    where.push(`o.settled_on <= $${args.length}`);
  }

  const r = await pool.query(
    `SELECT o.cpr_number, o.account_id, a.label,
            MIN(o.settled_on) AS settled_on,
            COUNT(*) AS orders,
            COALESCE(SUM(o.amount),0) AS amount,
            COALESCE(SUM(o.fee),0) AS fee,
            COALESCE(SUM(o.tax),0) AS tax
       FROM courier_orders o
       JOIN courier_accounts a ON a.id = o.account_id
      WHERE ${where.join(' AND ')}
      GROUP BY o.cpr_number, o.account_id, a.label
      ORDER BY MIN(o.settled_on) DESC NULLS LAST`,
    args
  );

  return r.rows.map(x => ({
    cpr: x.cpr_number,
    accountId: x.account_id,
    account: x.label,
    settledOn: x.settled_on ? new Date(x.settled_on).toISOString().slice(0, 10) : null,
    orders: Number(x.orders),
    amount: Math.round(Number(x.amount) * 100) / 100,
    fee: Math.round(Number(x.fee) * 100) / 100,
    tax: Math.round(Number(x.tax) * 100) / 100
  }));
}

// everything inside one receipt
export async function cprOrders(realmId, cpr) {
  const r = await pool.query(
    `SELECT o.tracking, o.order_ref, o.amount, o.fee, o.tax, o.city,
            o.booked_on, o.delivered_on, o.settled_on, a.label
       FROM courier_orders o
       JOIN courier_accounts a ON a.id = o.account_id
      WHERE o.realm_id = $1 AND o.cpr_number = $2
      ORDER BY o.delivered_on DESC NULLS LAST`,
    [realmId, cpr]
  );

  const d = v => v ? new Date(v).toISOString().slice(0, 10) : null;
  const n = v => Math.round(Number(v || 0) * 100) / 100;

  return r.rows.map(x => ({
    account: x.label,
    tracking: x.tracking,
    orderRef: x.order_ref,
    amount: n(x.amount),
    fee: n(x.fee),
    tax: n(x.tax),
    city: x.city,
    bookedOn: d(x.booked_on),
    deliveredOn: d(x.delivered_on),
    settledOn: d(x.settled_on)
  }));
}

// how much is still unknown, so the page can show progress
export async function cprProgress(realmId, accountId) {
  const r = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE status_group = 'delivered') AS delivered,
        COUNT(*) FILTER (WHERE status_group = 'delivered' AND cpr_number IS NOT NULL) AS known,
        COUNT(*) FILTER (WHERE status_group = 'delivered' AND settled = FALSE) AS unsettled
       FROM courier_orders
      WHERE realm_id = $1 ${accountId ? 'AND account_id = $2' : ''}`,
    accountId ? [realmId, Number(accountId)] : [realmId]
  );

  const x = r.rows[0] || {};
  return {
    delivered: Number(x.delivered || 0),
    known: Number(x.known || 0),
    unsettled: Number(x.unsettled || 0),
    left: Number(x.delivered || 0) - Number(x.known || 0) - Number(x.unsettled || 0)
  };
}
