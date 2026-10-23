// Shopify, as a door the app can open by itself.
//
// Until now Shopify came in as a file: the merchant exported orders and the
// Convert page read the export. That works, but it is a person doing by hand
// what a key could do - and it means the books are only ever as current as the
// last export somebody remembered to take.
//
// A shop is connected the same way a courier account is: one row per shop, the
// token kept encrypted, and the shop checked before it is saved. Orders are
// pulled into `shopify_orders` and turned into QuickBooks invoices by the same
// upload engine the Convert page already hands its work to, so Stop, Resume and
// the log are not written twice.
//
// Shopify's REST admin endpoints are the old way; everything here goes through
// the GraphQL Admin API, which is the one Shopify still adds to.

import crypto from 'crypto';
import { pool } from './db.js';
import { encrypt, decrypt } from './secrets.js';
import { getSetting, setSetting } from './settings.js';

// Shopify dates a version every quarter and supports each for a year. Pinned
// rather than "latest" so a release cannot change what the app reads underneath
// it; SHOPIFY_API_VERSION on the server moves it on.
//
// It matches the Webhooks API version shown when the app is made, on purpose:
// the version we ask questions in and the version Shopify calls us back in
// should be the same one, or a field can mean two things on the same day.
export const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';

export async function initShopify() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shopify_shops (
      id          SERIAL PRIMARY KEY,
      realm_id    TEXT NOT NULL,
      domain      TEXT NOT NULL,          -- something.myshopify.com
      label       TEXT NOT NULL,
      token       TEXT NOT NULL,          -- encrypted, never readable from a backup alone
      active      BOOLEAN DEFAULT TRUE,
      last_sync   TIMESTAMPTZ,
      last_error  TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS shopify_shops_key
      ON shopify_shops (realm_id, domain)
  `);

  // One row per order. What the courier tables learned: keep the dozen fields
  // that are worked with and let the rest go, so a year of orders is megabytes
  // rather than gigabytes. The line items are kept because an invoice is built
  // out of them, and they are the shop's own words - the QuickBooks item they
  // become is worked out at the moment of building, so re-matching a SKU does
  // not mean pulling every order again.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shopify_orders (
      id            SERIAL PRIMARY KEY,
      realm_id      TEXT NOT NULL,
      shop_id       INTEGER NOT NULL,
      order_gid     TEXT NOT NULL,
      name          TEXT,                 -- #1001
      number        TEXT,                 -- 1001
      placed_at     TIMESTAMPTZ,
      customer      TEXT,
      city          TEXT,
      phone         TEXT,
      bill_to       JSONB,
      subtotal      NUMERIC(14,2) DEFAULT 0,
      discount      NUMERIC(14,2) DEFAULT 0,
      shipping      NUMERIC(14,2) DEFAULT 0,
      tax           NUMERIC(14,2) DEFAULT 0,
      total         NUMERIC(14,2) DEFAULT 0,
      financial     TEXT,
      fulfillment   TEXT,
      cancelled     BOOLEAN DEFAULT FALSE,
      lines         JSONB,
      qb_doc_number TEXT,
      synced_at     TIMESTAMPTZ,
      sync_error    TEXT,
      seen_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS shopify_orders_key
      ON shopify_orders (realm_id, shop_id, order_gid)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS shopify_orders_dates
      ON shopify_orders (realm_id, placed_at)
  `);

  // Where an order has got to on its way into the books, and why it has not
  // got further. `state` is the whole of it:
  //
  //   waiting  nothing has been tried yet, or a try failed and it is due again
  //   held     something a person has to decide - a product with no item, say
  //   done     QuickBooks holds the invoice, and said so
  //   off      deliberately left out (cancelled in Shopify, or nothing to bill)
  //
  // `next_try` is what makes a failure retry itself instead of waiting for
  // somebody to notice: a run that fails backs off and comes round again.
  await pool.query(`
    ALTER TABLE shopify_orders
      ADD COLUMN IF NOT EXISTS state      TEXT DEFAULT 'waiting',
      ADD COLUMN IF NOT EXISTS tries      INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS next_try   TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS held_why   TEXT,
      ADD COLUMN IF NOT EXISTS qb_id      TEXT
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS shopify_orders_due
      ON shopify_orders (state, next_try)
  `);

  // Anything QuickBooks was already told about is done, not waiting. Without
  // this the first sweep after the columns appeared would look at every order
  // ever pulled and call it unwritten.
  await pool.query(`
    UPDATE shopify_orders SET state = 'done'
      WHERE synced_at IS NOT NULL AND state = 'waiting'
  `);
  await pool.query(`
    UPDATE shopify_orders SET state = 'off', held_why = 'cancelled in Shopify'
      WHERE cancelled = TRUE AND state = 'waiting'
  `);

  // Everything that happened, in words, so "is it working" is a page rather
  // than a feeling. One row per thing: an invoice written, an item made, a
  // refund seen, a price moved, QuickBooks refusing something.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shopify_events (
      id         SERIAL PRIMARY KEY,
      realm_id   TEXT NOT NULL,
      shop_id    INTEGER,
      at         TIMESTAMPTZ DEFAULT NOW(),
      kind       TEXT NOT NULL,
      ok         BOOLEAN DEFAULT TRUE,
      order_name TEXT,
      order_gid  TEXT,
      sku        TEXT,
      title      TEXT,
      note       TEXT,
      detail     JSONB
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS shopify_events_look
      ON shopify_events (realm_id, kind, id DESC)
  `);

  // Which webhooks are registered with which shop, so they are not registered
  // twice and can be taken off again.
  await pool.query(`
    ALTER TABLE shopify_shops
      ADD COLUMN IF NOT EXISTS hook_key  TEXT,
      ADD COLUMN IF NOT EXISTS hooks_at  TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS hooks     JSONB
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS shopify_shops_hook
      ON shopify_shops (hook_key) WHERE hook_key IS NOT NULL
  `);

  // A product new in Shopify, waiting to be allowed into QuickBooks.
  //
  // This is the one place a product is ever made in the books, and it is made
  // because a person pressed a button on this row - never by the sweep, never
  // by a webhook, never because an order needed it. The writer still matches
  // on the SKU and nothing else and still creates nothing: that is what
  // stopped SP-21 going onto SP-21-50's item, and it does not change.
  //
  // Two sides to every row, which is the whole point of it:
  //
  //   shop_*   what Shopify says. Refreshed whenever Shopify calls again, so
  //            a price corrected five minutes later is the price on the card.
  //   qb_*     what will be typed into QuickBooks. Filled in from the Shopify
  //            side the first time, and then it is hers: whatever is in these
  //            columns when she presses Sync now is exactly what is created,
  //            and a Shopify update never writes over her edit.
  //
  // `state` is new (waiting on her) / done (in QuickBooks) / off (she said no).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shopify_new_items (
      id          SERIAL PRIMARY KEY,
      realm_id    TEXT NOT NULL,
      shop_id     INTEGER,
      product_gid TEXT NOT NULL,
      variant_gid TEXT NOT NULL,
      sku         TEXT,
      shop_title  TEXT,
      shop_price  NUMERIC(14,2) DEFAULT 0,
      shop_cost   NUMERIC(14,2) DEFAULT 0,
      tracked     BOOLEAN DEFAULT FALSE,
      qb_name     TEXT,
      qb_desc     TEXT,
      qb_type     TEXT DEFAULT 'NonInventory',
      qb_price    NUMERIC(14,2) DEFAULT 0,
      qb_cost     NUMERIC(14,2) DEFAULT 0,
      qb_track    BOOLEAN DEFAULT FALSE,
      qb_qty      NUMERIC(14,2) DEFAULT 0,
      qb_start    DATE,
      state       TEXT DEFAULT 'new',
      why         TEXT,
      qb_item_id  TEXT,
      decided_at  TIMESTAMPTZ,
      seen_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS shopify_new_items_key
      ON shopify_new_items (realm_id, variant_gid)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS shopify_new_items_look
      ON shopify_new_items (realm_id, state, id DESC)
  `);
}

/* ==================== what happened, in words ==================== */

// How many are kept. A log that grows for ever becomes the database's problem;
// one swept too hard stops answering "what happened last Tuesday". Eight
// hundred lines and three weeks (housekeeping.js sweeps by age as well) is
// both - four thousand was a tenth of the free plan's whole allowance of room
// for one shop's log.
const KEEP_EVENTS = Math.max(100, Number(process.env.SHOPIFY_KEEP_EVENTS) || 800);

export const EVENT_KINDS = [
  'invoice',      // an invoice written into QuickBooks
  'held',         // waiting on a person - a product with no item, mostly
  'error',        // QuickBooks or Shopify refused something
  'item',         // an item made in QuickBooks for a new product
  'price',        // a product's price moved
  'paid',         // money taken against an order
  'refund',       // money given back
  'cancelled',    // the order called off
  'edited'        // the order changed after it was placed
];

export async function note(realmId, kind, row) {
  // The detail is kept for something that went wrong and thrown away for
  // something that went right. A failure needs its whole answer to be worked
  // out from; an invoice that was written needs the line that says so, and the
  // invoice itself is in QuickBooks. That one rule is most of this table's
  // weight, because the happy lines are the many.
  const keepDetail = row.ok === false || kind === 'error' || kind === 'held';
  const detail = keepDetail ? JSON.stringify(row.detail || {}) : '{}';

  await pool.query(
    `INSERT INTO shopify_events
       (realm_id, shop_id, kind, ok, order_name, order_gid, sku, title, note, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [realmId, row.shopId || null, kind, row.ok !== false,
     row.orderName || null, row.gid || null, row.sku || null, row.title || null,
     row.note || null, detail]
  );

  // swept now and then rather than on every row - a delete per event would
  // cost more than the events do
  if (Math.random() < 0.02) {
    await pool.query(
      `DELETE FROM shopify_events
        WHERE realm_id = $1
          AND id <= (SELECT id FROM shopify_events WHERE realm_id = $1
                      ORDER BY id DESC OFFSET $2 LIMIT 1)`,
      [realmId, KEEP_EVENTS]
    ).catch(() => {});
  }
}

export async function events(realmId, { kind, limit, since, open }) {
  const where = ['e.realm_id = $1'];
  const args = [realmId];
  if (kind && kind !== 'all') { args.push(kind); where.push(`e.kind = $${args.length}`); }
  if (since) { args.push(since); where.push(`e.at >= $${args.length}`); }

  // `open` means: only what is still a problem.
  //
  // "QuickBooks said no" was a list of every refusal there had ever been, so
  // an order refused at four in the morning and written at noon stayed on it
  // for ever, under a heading that says something is wrong. A refusal is
  // worth keeping as history and worth showing only while it is still true.
  const join = open
    ? `LEFT JOIN shopify_orders o
              ON o.realm_id = e.realm_id AND o.order_gid = e.order_gid`
    : '';
  if (open) {
    where.push(`(e.order_gid IS NULL OR o.state IS DISTINCT FROM 'done')`);
  }

  args.push(Math.min(Number(limit) || 200, 1000));

  const r = await pool.query(
    `SELECT e.at, e.kind, e.ok, e.order_name, e.order_gid, e.sku, e.title,
            e.note, e.detail
       FROM shopify_events e ${join}
      WHERE ${where.join(' AND ')}
      ORDER BY e.id DESC LIMIT $${args.length}`,
    args
  );
  return r.rows;
}

// Rub out a list. Ours, not QuickBooks' - these are the lines this app wrote
// about what it did, and when what it did was wrong and has been undone, the
// lines describing it are wrong too. Nothing in the books is touched.
export async function forgetEvents(realmId, kind) {
  if (!kind) return 0;
  const r = await pool.query(
    'DELETE FROM shopify_events WHERE realm_id = $1 AND kind = $2',
    [realmId, String(kind)]
  );
  return r.rowCount;
}

// The headline numbers, counted rather than guessed at.
//
// Seven counts, asked together rather than one after another. They used to be
// seven awaits in a row, which is seven round trips to Neon for one page -
// slow enough on a cold compute to look like a hang, and seven chances for
// one of them to be the thing the whole screen waits behind.
export async function tally(realmId) {
  const one = [realmId];

  const [byState, byKind, held, due, soon, sore, stuck, openErrors, newItems] =
    await Promise.all([
    pool.query(
      `SELECT state, COUNT(*)::int AS n FROM shopify_orders
        WHERE realm_id = $1 GROUP BY state`, one),

    pool.query(
      `SELECT kind, COUNT(*)::int AS n FROM shopify_events
        WHERE realm_id = $1 AND at > NOW() - INTERVAL '30 days'
        GROUP BY kind`, one),

    pool.query(
      `SELECT held_why, COUNT(*)::int AS n FROM shopify_orders
        WHERE realm_id = $1 AND state IN ('held','waiting') AND held_why IS NOT NULL
        GROUP BY held_why ORDER BY COUNT(*) DESC LIMIT 20`, one),

    // "Waiting" and "waiting on something that has not come round yet" are two
    // different things, and saying only the first is how five hundred orders
    // sit under the words "nothing waiting". How many are due now, when the
    // next one comes round, and what went wrong last time.
    pool.query(
      `SELECT COUNT(*)::int AS n FROM shopify_orders
        WHERE realm_id = $1 AND state = 'waiting' AND cancelled = FALSE
          AND (next_try IS NULL OR next_try <= NOW())`, one),

    pool.query(
      `SELECT MIN(next_try) AS at FROM shopify_orders
        WHERE realm_id = $1 AND state = 'waiting' AND next_try > NOW()`, one),

    pool.query(
      `SELECT sync_error, COUNT(*)::int AS n FROM shopify_orders
        WHERE realm_id = $1 AND state = 'waiting' AND sync_error IS NOT NULL
        GROUP BY sync_error ORDER BY COUNT(*) DESC LIMIT 1`, one),

    // the whole of the queue, by the thing that is stopping each part of it
    pool.query(
      `SELECT COALESCE(held_why, sync_error, 'no reason recorded') AS why,
              COUNT(*)::int AS n
         FROM shopify_orders
        WHERE realm_id = $1 AND state IN ('held','waiting')
          AND (held_why IS NOT NULL OR sync_error IS NOT NULL)
        GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 6`, one),

    // refusals that are still true - the tab shows these, so the number on
    // the tab has to count the same thing
    pool.query(
      `SELECT COUNT(*)::int AS n
         FROM shopify_events e
         LEFT JOIN shopify_orders o
                ON o.realm_id = e.realm_id AND o.order_gid = e.order_gid
        WHERE e.realm_id = $1 AND e.kind = 'error'
          AND (e.order_gid IS NULL OR o.state IS DISTINCT FROM 'done')`, one),

    // Products new in Shopify waiting to be allowed into QuickBooks. It is on
    // the headline because a product nobody notices is an order held next
    // week: the whole arrangement only works if the waiting list is seen.
    pool.query(
      `SELECT COUNT(*)::int AS n FROM shopify_new_items
        WHERE realm_id = $1 AND state = 'new'`, one)
  ]);

  const out = {
    states: {}, kinds: {}, why: held.rows, stuck: stuck.rows,
    due: due.rows[0].n,
    nextTry: soon.rows[0].at || null,
    lastError: sore.rows[0] ? sore.rows[0].sync_error : null,
    lastErrorCount: sore.rows[0] ? sore.rows[0].n : 0
  };
  byState.rows.forEach(r => { out.states[r.state || 'waiting'] = r.n; });
  byKind.rows.forEach(r => { out.kinds[r.kind] = r.n; });
  // the refusals still standing, which is what the tab lists
  out.kinds.error = openErrors.rows[0].n;
  out.newItems = newItems.rows[0].n;
  return out;
}

// Stop waiting and try now. Everything held goes back in the queue and
// everything backing off has its wait cleared - which is what somebody means
// when they have fixed the thing and do not want to sit through an hour of
// doubling to find out.
//
// **This is a button, and only ever a button.** It wipes `held_why` on every
// held order, so the whole of Needs you empties in one call - which is right
// when a person has just pressed "Try all of them again now" and wrong
// absolutely everywhere else. Anything that happens as a side effect of
// something else wants `wakeWaiting` below.
export async function wakeAll(realmId) {
  const r = await pool.query(
    `UPDATE shopify_orders
        SET state = 'waiting', next_try = NULL, tries = 0,
            held_why = NULL, sync_error = NULL
      WHERE realm_id = $1 AND state IN ('held', 'waiting') AND cancelled = FALSE`,
    [realmId]
  );
  return r.rowCount;
}

// The same thing for what is only sitting out a doubling wait: a `waiting`
// order whose `next_try` is an hour away is tried now instead.
//
// This is the one to call when waking the queue is a side effect rather than
// the thing somebody asked for - "read these days and run a pass" being the
// case that caught us out. That route called `wakeAll`, which released every
// held order and wiped its reason, so pressing Sync emptied Needs you: the
// orders went to the back of a five-hundred-order queue and the questions
// waiting on a person simply were not on the screen any more. Nothing was
// lost, but a list that is the whole point of the page went blank for hours
// and nothing said why.
//
// A held order is not waiting on time, so time passing is no reason to touch
// it. It stays held, with its reason, until it is answered.
export async function wakeWaiting(realmId) {
  const r = await pool.query(
    `UPDATE shopify_orders
        SET next_try = NULL, tries = 0
      WHERE realm_id = $1 AND state = 'waiting' AND cancelled = FALSE
        AND (next_try IS NOT NULL OR COALESCE(tries, 0) > 0)`,
    [realmId]
  );
  return r.rowCount;
}


/* ==================== products waiting to be allowed in ==================== */

// A variant that is new on Shopify, offered rather than made.
//
// Called from the product webhook, so it happens the moment a product is
// saved in Shopify - the same immediacy an order has. The difference is the
// last step: an order writes itself, a product waits on her.
//
// Two things it is careful about:
//
//  - **It never writes over her edits.** On a second call only the Shopify
//    side is refreshed. If she has retyped the name or the price that is what
//    stays, because that is the version she is about to approve.
//  - **It never re-opens something decided.** A product she said no to, or
//    one already in QuickBooks, is not put back on the list by Shopify
//    saving the product again. `state` is only ever moved by a person.
export async function offerNewItem(realmId, shopId, p, v) {
  const vTitle = String((v && v.title) || '').trim();
  const title = String((p && p.title) || '').trim() +
    (vTitle && vTitle !== 'Default Title' ? ' - ' + vTitle : '');

  const price = Number(v.price) || 0;
  const cost = Number(v.inventoryItem && v.inventoryItem.unitCost &&
                      v.inventoryItem.unitCost.amount) || 0;
  // Shopify's own answer to "do you count this one", which is what decides the
  // kind of item QuickBooks is asked for.
  const tracked = !!(v.inventoryItem && v.inventoryItem.tracked);

  const r = await pool.query(
    `INSERT INTO shopify_new_items
       (realm_id, shop_id, product_gid, variant_gid, sku, shop_title,
        shop_price, shop_cost, tracked,
        qb_name, qb_desc, qb_type, qb_price, qb_cost, qb_track, qb_qty)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$6,$6,$10,$7,$8,FALSE,0)
     ON CONFLICT (realm_id, variant_gid) DO UPDATE SET
       sku        = EXCLUDED.sku,
       shop_title = EXCLUDED.shop_title,
       shop_price = EXCLUDED.shop_price,
       shop_cost  = EXCLUDED.shop_cost,
       tracked    = EXCLUDED.tracked,
       seen_at    = NOW()
     RETURNING (xmax = 0) AS fresh, state`,
    [realmId, shopId, p.id, v.id, String(v.sku || '').trim(), title,
     price, cost, tracked,
     // The kind QuickBooks is asked for follows Shopify: a variant Shopify
     // counts is Inventory, one it does not is Non-inventory. Hers to change
     // on the card - and see makeNewItems for what QuickBooks will actually
     // accept, which is not the same question.
     tracked ? 'Inventory' : 'NonInventory']
  );

  const row = r.rows[0] || {};
  return { fresh: !!row.fresh, state: row.state || 'new' };
}

export async function newItemList(realmId, opts) {
  const o = opts || {};
  const args = [realmId];
  let where = 'realm_id = $1';
  if (o.state) { args.push(String(o.state)); where += ' AND state = $' + args.length; }
  args.push(Math.min(Math.max(Number(o.limit) || 200, 1), 500));
  const r = await pool.query(
    `SELECT * FROM shopify_new_items
      WHERE ${where} ORDER BY id DESC LIMIT $${args.length}`, args);
  return r.rows;
}

export async function newItemTally(realmId) {
  const r = await pool.query(
    `SELECT state, COUNT(*)::int AS n FROM shopify_new_items
      WHERE realm_id = $1 GROUP BY state`, [realmId]);
  const out = { new: 0, done: 0, off: 0 };
  r.rows.forEach(x => { out[x.state] = x.n; });
  return out;
}

// What she typed on the card. Only the QuickBooks side can be edited, and only
// while the row is still waiting: an item already in the books is not changed
// from here, because changing it here would say something about QuickBooks that
// is not true.
const MINE = {
  qb_name: 'text', qb_desc: 'text', qb_type: 'kind', qb_price: 'num',
  qb_cost: 'num', qb_track: 'bool', qb_qty: 'num', qb_start: 'date',
  sku: 'text'
};

export async function editNewItem(realmId, id, patch) {
  const sets = [];
  const args = [realmId, Number(id)];
  Object.keys(patch || {}).forEach(k => {
    const how = MINE[k];
    if (!how) return;
    let v = patch[k];
    if (how === 'num') v = Number(v) || 0;
    else if (how === 'bool') v = !!v;
    else if (how === 'kind') {
      v = ['Inventory', 'NonInventory', 'Service'].indexOf(String(v)) >= 0
        ? String(v) : 'NonInventory';
    } else if (how === 'date') v = v ? String(v).slice(0, 10) : null;
    else v = String(v == null ? '' : v).slice(0, 4000);
    args.push(v);
    sets.push(k + ' = $' + args.length);
  });
  if (!sets.length) return 0;
  const r = await pool.query(
    `UPDATE shopify_new_items SET ${sets.join(', ')}, why = NULL
      WHERE realm_id = $1 AND id = $2 AND state = 'new'`, args);
  return r.rowCount;
}

// "No thanks" - and it stays no. Nothing in QuickBooks is touched: this row
// was only ever a question.
export async function dropNewItem(realmId, ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean);
  if (!list.length) return 0;
  const r = await pool.query(
    `UPDATE shopify_new_items
        SET state = 'off', why = 'you said no', decided_at = NOW()
      WHERE realm_id = $1 AND id = ANY($2::int[]) AND state = 'new'`,
    [realmId, list]);
  return r.rowCount;
}

export async function reopenNewItem(realmId, ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean);
  if (!list.length) return 0;
  const r = await pool.query(
    `UPDATE shopify_new_items
        SET state = 'new', why = NULL, decided_at = NULL
      WHERE realm_id = $1 AND id = ANY($2::int[]) AND state = 'off'`,
    [realmId, list]);
  return r.rowCount;
}

// The rows a Sync now is about. Named ids, or everything still waiting - and
// `state = 'new'` is in the query, so a row decided a second ago by another
// tab cannot be made twice.
export async function newItemsToMake(realmId, ids) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean);
  if (list.length) {
    const r = await pool.query(
      `SELECT * FROM shopify_new_items
        WHERE realm_id = $1 AND id = ANY($2::int[]) AND state = 'new'
        ORDER BY id`, [realmId, list]);
    return r.rows;
  }
  const r = await pool.query(
    `SELECT * FROM shopify_new_items
      WHERE realm_id = $1 AND state = 'new' ORDER BY id`, [realmId]);
  return r.rows;
}

export async function newItemDone(realmId, id, qbItemId, why) {
  await pool.query(
    `UPDATE shopify_new_items
        SET state = 'done', qb_item_id = $3, why = $4, decided_at = NOW()
      WHERE realm_id = $1 AND id = $2`,
    [realmId, Number(id), String(qbItemId || ''), why || null]);
}

// QuickBooks refused it, so it stays on the list with the refusal on it. Not
// 'off': she did not say no, QuickBooks did, and that is a thing to fix and
// press again rather than a decision.
export async function newItemStuck(realmId, id, why) {
  await pool.query(
    `UPDATE shopify_new_items SET why = $3 WHERE realm_id = $1 AND id = $2`,
    [realmId, Number(id), String(why || '').slice(0, 600)]);
}

/* ==================== the shops ==================== */

// A shop domain is typed by a person, so it arrives in every shape there is.
//
// The one that matters most: what somebody copies out of the address bar is the
// admin address, https://admin.shopify.com/store/pureclans - and the shop's own
// name, pureclans.myshopify.com, is nowhere on their screen. Refusing that and
// telling them to go and find the right one is making them do work we can do
// ourselves: the name is sitting right there in the path.
export function cleanDomain(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) throw new Error('Type your shop address, like your-shop.myshopify.com');

  s = s.replace(/^https?:\/\//, '').replace(/\s+/g, '');

  // admin.shopify.com/store/<name>  ->  <name>.myshopify.com
  const admin = s.match(/^admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/);
  if (admin) return admin[1] + '.myshopify.com';

  // anything else: the host, without whatever path came with it
  s = s.replace(/\/.*$/, '');

  // a bare name is the usual way somebody types it
  if (s.indexOf('.') < 0) s += '.myshopify.com';

  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) {
    throw new Error(
      'That is not the shop’s own address. Use the one ending .myshopify.com - ' +
      'it is in Shopify under Settings > Domains, and it is also the name in your ' +
      'admin address: admin.shopify.com/store/THIS-BIT');
  }
  return s;
}

export async function listShops(realmId) {
  const r = await pool.query(
    `SELECT id, domain, label, active, last_sync, last_error, created_at
       FROM shopify_shops WHERE realm_id = $1 ORDER BY id`,
    [realmId]
  );
  return r.rows;
}

export async function getShop(realmId, id) {
  const r = await pool.query(
    'SELECT * FROM shopify_shops WHERE realm_id = $1 AND id = $2',
    [realmId, Number(id)]
  );
  return r.rows[0] || null;
}

export async function saveShop(realmId, { domain, token, label }) {
  const d = cleanDomain(domain);
  const t = String(token || '').trim();
  if (!t) throw new Error('Paste the Admin API access token');

  const r = await pool.query(
    `INSERT INTO shopify_shops (realm_id, domain, label, token)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (realm_id, domain)
     DO UPDATE SET token = $4, label = $3, active = TRUE, last_error = NULL
     RETURNING id, domain, label`,
    [realmId, d, String(label || d).trim().slice(0, 120), encrypt(t)]
  );
  return r.rows[0];
}

export async function removeShop(realmId, id) {
  // the orders go with the shop: they are that shop's, and nothing else reads them
  await pool.query('DELETE FROM shopify_orders WHERE realm_id = $1 AND shop_id = $2',
    [realmId, Number(id)]);
  await pool.query('DELETE FROM shopify_shops WHERE realm_id = $1 AND id = $2',
    [realmId, Number(id)]);
}

/* ==================== talking to Shopify ==================== */

// One way in and out. Shopify answers 200 with an `errors` block for a bad
// query, so a plain `res.ok` is not enough to know it worked.
export async function ask(domain, token, query, variables) {
  let r;
  try {
    r = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ query, variables: variables || {} })
    });
  } catch (e) {
    throw new Error('Could not reach ' + domain + ' - ' + e.message);
  }

  if (r.status === 401 || r.status === 403) {
    throw new Error('Shopify refused the token. Check it is this shop’s Admin API access token and that the app has read_orders.');
  }
  if (r.status === 404) {
    throw new Error('Shopify does not know API version ' + API_VERSION + ' at ' + domain + '. Set SHOPIFY_API_VERSION on the server.');
  }
  if (r.status === 429) {
    throw new Error('Shopify is asking us to slow down. Try again in a minute.');
  }

  const text = await r.text();
  let body;
  try { body = JSON.parse(text); }
  catch (e) { throw new Error('Shopify answered with something that is not JSON (' + r.status + ')'); }

  if (body.errors && body.errors.length) {
    const first = body.errors[0];
    const msg = (first && (first.message || first.code)) || 'Shopify refused the question';
    // the one that is always worth saying in words
    if (/access denied|read_orders|scope/i.test(msg)) {
      throw new Error('The app is not allowed to read orders. In Shopify, give it read_orders (and read_all_orders for anything over 60 days old), then make a new token.');
    }
    throw new Error('Shopify: ' + msg);
  }
  if (!r.ok) throw new Error('Shopify answered ' + r.status);

  return body.data;
}

// Is this token this shop's, and may it read orders? Asked before anything is
// saved, so a wrong paste is caught at the moment it is made rather than at the
// first pull three days later.
export async function checkShop(domain, token) {
  const d = await ask(domain, token, `{
    shop { name myshopifyDomain currencyCode ianaTimezone email }
    orders(first: 1) { nodes { id } }
  }`);
  return {
    name: d.shop.name,
    domain: d.shop.myshopifyDomain,
    currency: d.shop.currencyCode,
    timezone: d.shop.ianaTimezone,
    email: d.shop.email || '',
    sawOrders: !!(d.orders && d.orders.nodes && d.orders.nodes.length)
  };
}

const ORDERS_QUERY = `
query FusionOrders($q: String!, $cursor: String) {
  orders(first: 50, after: $cursor, query: $q, sortKey: CREATED_AT, reverse: false) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt processedAt cancelledAt
      displayFinancialStatus displayFulfillmentStatus
      currentSubtotalPriceSet { shopMoney { amount } }
      totalDiscountsSet       { shopMoney { amount } }
      totalShippingPriceSet   { shopMoney { amount } }
      totalTaxSet             { shopMoney { amount } }
      currentTotalPriceSet    { shopMoney { amount } }
      customer { firstName lastName }
      billingAddress  { name address1 address2 city province country phone }
      shippingAddress { name address1 address2 city province country phone }
      lineItems(first: 100) {
        nodes {
          sku title quantity
          originalUnitPriceSet { shopMoney { amount } }
          discountedTotalSet   { shopMoney { amount } }
          variant { id inventoryItem { tracked unitCost { amount } } }
        }
      }
    }
  }
}`;

// Asking for what the variant tracks and what it cost needs read_inventory.
// Shopify refuses the *whole* query when a field is out of scope, not just that
// field - so a shop whose app was made without it would lose its orders along
// with its costs. The rich question is asked once; if that is the answer, the
// shop is remembered as a plain one and asked the plain question from then on.
const plainOnly = new Set();
const NL = String.fromCharCode(10);

function withoutVariant(q) {
  // the variant block is one line in both questions, so taking the line
  // out is enough - and leaves nothing to get wrong in a regular
  // expression spanning newlines
  return q.split(NL).filter(l => l.indexOf('variant {') < 0).join(NL);
}

function outOfScope(msg) {
  return /access denied|read_inventory|not approved to access|requires merchant approval/i
    .test(String(msg || ''));
}

// Ask the rich question, and fall back to the plain one for this shop if the
// app was never given the scope for it.
async function askOrders(domain, token, query, vars) {
  if (!plainOnly.has(domain)) {
    try {
      return await ask(domain, token, query, vars);
    } catch (e) {
      if (!outOfScope(e.message)) throw e;
      plainOnly.add(domain);
    }
  }
  return ask(domain, token, withoutVariant(query), vars);
}

export function shopIsPlain(domain) { return plainOnly.has(domain); }

const money = v => {
  const n = Number(v);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
};
const amt = set => money(set && set.shopMoney && set.shopMoney.amount);

function personOf(o) {
  const a = o.shippingAddress || o.billingAddress || null;
  if (a && a.name) return String(a.name).trim();
  const c = o.customer || {};
  const n = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return n || '';
}

// The billing block on the invoice: who it is and where they are, and nothing
// else. A phone number and a country on an invoice are clutter - the phone is
// the courier's business and the country is the same one every time.
function addressOf(o) {
  const a = o.shippingAddress || o.billingAddress;
  if (!a) return [];
  return [
    a.name,
    a.address1,
    a.address2,
    [a.city, a.province].filter(Boolean).join(', ')
  ].filter(Boolean).map(String);
}

// Pull a date range in, page by page. `onPage` is called after each page so a
// long pull can say where it has got to instead of going quiet for a minute.
export async function pullOrders(realmId, shop, { from, to, onPage }) {
  const token = decrypt(shop.token);
  // Shopify reads its own search syntax; the dates are the shop's own day
  const q = `created_at:>=${from} created_at:<=${to}T23:59:59 status:any`;

  let cursor = null, pages = 0, saved = 0, seen = 0;

  while (true) {
    const d = await askOrders(shop.domain, token, ORDERS_QUERY, { q, cursor });
    const page = (d && d.orders) || { nodes: [], pageInfo: {} };
    const rows = page.nodes || [];
    seen += rows.length;

    for (const o of rows) {
      saved += await saveOrder(realmId, shop.id, o);
    }

    pages++;
    if (onPage) onPage({ pages, seen, saved });

    if (!page.pageInfo || !page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
    if (pages > 400) break;             // 20,000 orders in one ask is a mistake
  }

  await pool.query(
    'UPDATE shopify_shops SET last_sync = NOW(), last_error = NULL WHERE id = $1',
    [shop.id]
  );

  return { seen, saved, pages };
}

async function saveOrder(realmId, shopId, o) {
  const lines = ((o.lineItems && o.lineItems.nodes) || []).map(L => {
    const rate = amt(L.originalUnitPriceSet);
    const qty = Number(L.quantity) || 0;
    const inv = (L.variant && L.variant.inventoryItem) || null;
    return {
      sku: String(L.sku || '').trim(),
      title: String(L.title || '').trim(),
      qty,
      rate,
      amt: money(rate * qty),
      // what the shop says this product is. An item made in QuickBooks from it
      // is made as the same kind of thing, rather than as whatever was ticked
      // in a settings box months ago.
      tracked: inv ? inv.tracked !== false : false,
      cost: inv && inv.unitCost ? money(inv.unitCost.amount) : 0
    };
  });

  const a = o.shippingAddress || o.billingAddress || {};
  const r = await pool.query(
    `INSERT INTO shopify_orders
       (realm_id, shop_id, order_gid, name, number, placed_at, customer, city, phone,
        bill_to, subtotal, discount, shipping, tax, total, financial, fulfillment,
        cancelled, lines, seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
     ON CONFLICT (realm_id, shop_id, order_gid) DO UPDATE SET
       financial   = EXCLUDED.financial,
       fulfillment = EXCLUDED.fulfillment,
       cancelled   = EXCLUDED.cancelled,
       subtotal    = EXCLUDED.subtotal,
       discount    = EXCLUDED.discount,
       shipping    = EXCLUDED.shipping,
       tax         = EXCLUDED.tax,
       total       = EXCLUDED.total,
       lines       = EXCLUDED.lines,
       customer    = EXCLUDED.customer,
       city        = EXCLUDED.city,
       phone       = EXCLUDED.phone,
       bill_to     = EXCLUDED.bill_to,
       seen_at     = NOW()
     RETURNING (xmax = 0) AS fresh`,
    [
      realmId, shopId, o.id,
      o.name || '',
      String(o.name || '').replace(/[^0-9]/g, ''),
      o.processedAt || o.createdAt || null,
      personOf(o),
      String(a.city || ''),
      String(a.phone || ''),
      JSON.stringify(addressOf(o)),
      amt(o.currentSubtotalPriceSet),
      amt(o.totalDiscountsSet),
      amt(o.totalShippingPriceSet),
      amt(o.totalTaxSet),
      amt(o.currentTotalPriceSet),
      o.displayFinancialStatus || '',
      o.displayFulfillmentStatus || '',
      !!o.cancelledAt,
      JSON.stringify(lines)
    ]
  );
  return r.rows[0] && r.rows[0].fresh ? 1 : 0;
}

/* ==================== reading them back ==================== */

export async function listOrders(realmId, { from, to, shop, state, limit }) {
  const where = ['o.realm_id = $1'];
  const args = [realmId];

  if (from) { args.push(from); where.push(`o.placed_at >= $${args.length}::date`); }
  if (to)   { args.push(to);   where.push(`o.placed_at < ($${args.length}::date + 1)`); }
  if (shop) { args.push(Number(shop)); where.push(`o.shop_id = $${args.length}`); }

  if (state === 'done')    where.push('o.synced_at IS NOT NULL');
  if (state === 'waiting') where.push('o.synced_at IS NULL AND o.cancelled = FALSE');

  args.push(Math.min(Number(limit) || 2000, 5000));

  const r = await pool.query(
    `SELECT o.*, s.label AS shop_label, s.domain AS shop_domain
       FROM shopify_orders o
       LEFT JOIN shopify_shops s ON s.id = o.shop_id
      WHERE ${where.join(' AND ')}
      ORDER BY o.placed_at DESC NULLS LAST
      LIMIT $${args.length}`,
    args
  );
  return r.rows;
}

// Every SKU and product name in a range, with how many orders carry it - what
// the matching step needs to show what is still unmatched.
export async function productsSeen(realmId, { from, to, shop }) {
  const rows = await listOrders(realmId, { from, to, shop });
  const seen = new Map();
  rows.forEach(o => {
    (o.lines || []).forEach(L => {
      const key = (L.sku || L.title || '').toLowerCase();
      if (!key) return;
      if (!seen.has(key)) seen.set(key, { sku: L.sku || '', title: L.title || '', lines: 0, qty: 0 });
      const s = seen.get(key);
      s.lines++;
      s.qty += Number(L.qty) || 0;
    });
  });
  return [...seen.values()].sort((a, b) => b.lines - a.lines);
}

export async function markSynced(realmId, pairs) {
  // pairs: [{ gid, docNumber }]
  for (const p of pairs) {
    await pool.query(
      `UPDATE shopify_orders SET synced_at = NOW(), qb_doc_number = $3, sync_error = NULL
        WHERE realm_id = $1 AND order_gid = $2`,
      [realmId, p.gid, String(p.docNumber || '')]
    );
  }
  return pairs.length;
}

export async function unmark(realmId, gids) {
  await pool.query(
    `UPDATE shopify_orders SET synced_at = NULL, qb_doc_number = NULL
      WHERE realm_id = $1 AND order_gid = ANY($2::text[])`,
    [realmId, gids]
  );
}

/* ==================== becoming an invoice ==================== */

// The customer name an invoice is made out to. A shop's orders are usually
// booked against one monthly customer rather than ten thousand buyers, which is
// what the Convert page has always done, so the same tokens work here.
export function customerName(template, iso) {
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = iso ? new Date(iso) : new Date();
  const s = String(template || 'Shopify Sale - {mon}{yy}');
  return s
    .replace(/\{mon\}/gi, MON[d.getUTCMonth()])
    .replace(/\{month\}/gi, MON[d.getUTCMonth()])
    .replace(/\{yy\}/gi, String(d.getUTCFullYear()).slice(2))
    .replace(/\{yyyy\}/gi, String(d.getUTCFullYear()))
    .trim();
}

// Pakistan is five hours ahead of the server's clock, and an order placed at
// half past nine at night belongs to that day's books, not the next one's.
function localDay(ts) {
  if (!ts) return null;
  const d = new Date(new Date(ts).getTime() + 5 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

// One order -> one invoice in the shape the upload engine already takes.
// `match(sku, title)` hands back the QuickBooks item name, or null if there is
// none yet - an order with any unmatched line is not built, because half an
// invoice in real books is worse than no invoice.
// The invoice number is Shopify's order name. That is the whole rule.
//
//   Shopify says  1001        QuickBooks is told  1001
//   Shopify says  #8766878    QuickBooks is told  #8766878
//   Shopify says  wt65689     QuickBooks is told  wt65689
//
// Nothing is added, nothing is taken off, nothing is tidied. The point of
// the number is that one search finds the same thing on both sides, and the
// only way to be sure of that is to change nothing.
//
// It used to be built - strip the name to its digits, then put a `prefix`
// setting back on the front - which came out right for a shop whose orders
// are called #9323516 and wrong for everyone else: PC-1001 became 1001 and
// then #1001, and a shop numbering plainly at 1001 got #1001 for no reason
// anybody asked for. The setting is gone rather than defaulted empty,
// because a box that can put a character in front of an invoice number is a
// box that will one day be filled in.
export function docNumberOf(order) {
  const name = String(order.name || '').trim();
  return name || String(order.number || '').trim();
}

export function toInvoice(order, opts) {
  const o = opts || {};
  const date = localDay(order.placed_at);
  const lines = [];
  const missing = [];

  (order.lines || []).forEach(L => {
    if (!L.qty) return;
    const item = o.match ? o.match(L.sku, L.title) : null;
    if (item === 'skip') return;
    if (!item) { missing.push(L.sku || L.title); return; }
    // Not the Shopify title. The words on an invoice line are the ones
    // QuickBooks holds against that item, and only the caller has the item
    // list to read them from - so it hands a descOf in, or the line goes
    // without, the way QuickBooks leaves it when the item says nothing.
    lines.push({
      item,
      desc: o.descOf ? o.descOf(item) : '',
      qty: L.qty,
      rate: L.rate,
      amt: L.amt
    });
  });

  // Delivery belongs on the invoice whatever it came to, nought included -
  // free delivery was promised and given, and an invoice that does not
  // mention it does not match the order it was made from. Only once somebody
  // has said which QuickBooks item it is; left unsaid it is dropped rather
  // than guessed at.
  const ship = money(order.shipping);
  if (o.shippingItem) {
    // The one description Fusion writes for itself, and only where delivery
    // came to nothing - the QuickBooks item is called the same thing whether
    // the buyer paid for delivery or not. o.freeText is handed in by the
    // caller so this path and the writer cannot drift apart.
    lines.push({ item: o.shippingItem, qty: 1, rate: ship, amt: ship,
                 desc: ship > 0
                   ? (o.descOf ? o.descOf(o.shippingItem) : '')
                   : (o.freeText || '') });
  }

  if (missing.length) return { skip: 'unmatched', missing, order };
  if (!lines.length)  return { skip: 'empty', order };

  return {
    invoice: {
      docNumber: docNumberOf(order),
      customer: customerName(o.customer, order.placed_at),
      txnDate: date,
      dueDate: date,
      terms: o.terms || '',
      // nothing in the memo: the order number is already the invoice number and
      // the address is already in the billing block, so a memo only repeats
      memo: '',
      billTo: Array.isArray(order.bill_to) ? order.bill_to : [],
      discount: money(order.discount),
      lines
    },
    gid: order.order_gid
  };
}

/* ==================== one order, read back from the shop ==================== */

// A webhook is a nudge, never a source. Shopify's call says "order 123 moved";
// this is what actually says what order 123 now is. Reading it back means a
// forged call can at worst make us re-read a real order, and it means the shape
// of the webhook body - which Shopify may change, and which differs per topic -
// never has to be understood at all.
const ONE_ORDER = `
query FusionOrder($id: ID!) {
  order(id: $id) {
    id name createdAt processedAt cancelledAt
    displayFinancialStatus displayFulfillmentStatus
    currentSubtotalPriceSet { shopMoney { amount } }
    totalDiscountsSet       { shopMoney { amount } }
    totalShippingPriceSet   { shopMoney { amount } }
    totalTaxSet             { shopMoney { amount } }
    currentTotalPriceSet    { shopMoney { amount } }
    totalRefundedSet        { shopMoney { amount } }
    customer { firstName lastName }
    billingAddress  { name address1 address2 city province country phone }
    shippingAddress { name address1 address2 city province country phone }
    lineItems(first: 100) {
      nodes {
        sku title quantity
        originalUnitPriceSet { shopMoney { amount } }
        discountedTotalSet   { shopMoney { amount } }
        variant { id inventoryItem { tracked unitCost { amount } } }
      }
    }
  }
}`;

export async function fetchOne(shop, gid) {
  const token = decrypt(shop.token);
  const d = await askOrders(shop.domain, token, ONE_ORDER, { id: gid });
  return (d && d.order) || null;
}

// Save one order the way a pull does, and hand back the row as it now stands.
export async function saveOne(realmId, shopId, order) {
  await saveOrder(realmId, shopId, order);
  const r = await pool.query(
    `SELECT * FROM shopify_orders WHERE realm_id = $1 AND shop_id = $2 AND order_gid = $3`,
    [realmId, shopId, order.id]
  );
  return r.rows[0] || null;
}

// One product, read back the same way, for the product webhooks.
const ONE_PRODUCT = `
query FusionProduct($id: ID!) {
  product(id: $id) {
    id title status
    variants(first: 100) {
      nodes {
        id sku title price compareAtPrice
        inventoryItem { tracked unitCost { amount } }
      }
    }
  }
}`;

export async function fetchProduct(shop, gid) {
  const token = decrypt(shop.token);
  const d = await ask(shop.domain, token, ONE_PRODUCT, { id: gid });
  return (d && d.product) || null;
}

/* ==================== the queue ==================== */

// What is due to be tried. Ordered oldest first so a backlog is cleared in the
// order it happened, which is the order the books want it in.
// What to write next, and whose.
//
// This used to take the oldest N waiting orders **across every company in
// Fusion**, and the sweep then threw away the ones whose company had sync
// switched off. One company with older orders and its switch off therefore
// filled the whole batch, every pass, for ever - the sweep looked, did
// nothing, saw it had done nothing, and went back to sleep for ten minutes.
// Another company could sit on five hundred ready-to-go orders and never get
// a turn, while brand new ones still went in because a webhook writes those
// itself and never comes through here. Which is exactly how it looked:
// today's orders in the books, August's untouched.
//
// Two things fix it, and both belong in the query rather than after it:
//
//   - **only companies whose sync is on.** A company with no settings row at
//     all is off (DEFAULTS.on is false), so an inner join is the whole test.
//   - **a batch each, not a batch between them.** ROW_NUMBER per company
//     means one company's backlog cannot starve another's, however old it is.
export async function dueOrders(perCompany) {
  const n = Math.min(Math.max(Number(perCompany) || 20, 1), 200);
  const r = await pool.query(
    `WITH live AS (
       SELECT realm_id FROM app_settings
        WHERE key = 'shopify'
          AND COALESCE((value->>'on')::boolean, FALSE) = TRUE
     ),
     ranked AS (
       SELECT o.*, s.label AS shop_label, s.domain AS shop_domain,
              ROW_NUMBER() OVER (PARTITION BY o.realm_id
                                 ORDER BY o.placed_at ASC NULLS LAST) AS rn
         FROM shopify_orders o
         JOIN live l ON l.realm_id = o.realm_id
         LEFT JOIN shopify_shops s ON s.id = o.shop_id
        WHERE o.state = 'waiting'
          AND o.cancelled = FALSE
          AND (o.next_try IS NULL OR o.next_try <= NOW())
     )
     SELECT * FROM ranked WHERE rn <= $1 ORDER BY realm_id, rn`,
    [n]
  );
  return r.rows;
}

// Is anything older than this still waiting to be written?
//
// The one question that decides whether a brand new order goes in now or
// takes its place in the queue.
//
// `waiting` only, and that matters: a **held** order is waiting on a person,
// not on its turn, and the sweep never picks one up on its own. Counting
// those would mean one order stuck on a missing SKU in August stops every
// order after it, for ever - the queue would never move again.
export async function olderWaiting(realmId, placedAt) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n, MIN(placed_at) AS oldest
       FROM shopify_orders
      WHERE realm_id = $1
        AND state = 'waiting'
        AND cancelled = FALSE
        AND placed_at IS NOT NULL
        AND placed_at < $2`,
    [realmId, placedAt]
  );
  return { n: r.rows[0].n, oldest: r.rows[0].oldest || null };
}

export async function setDone(realmId, gid, qbId, docNumber) {
  await pool.query(
    `UPDATE shopify_orders
        SET state = 'done', qb_id = $3, qb_doc_number = $4,
            synced_at = NOW(), sync_error = NULL, held_why = NULL
      WHERE realm_id = $1 AND order_gid = $2`,
    [realmId, gid, qbId || null, String(docNumber || '')]
  );
}

// Held is a person's to clear: a product with no item, an order with nothing on
// it. It is not retried on a timer, because time will not fix it - but the
// moment the thing it was waiting for is done, releaseHeld puts it back in the
// queue, which is what makes "match the SKU" enough on its own.
export async function setHeld(realmId, gid, why) {
  await pool.query(
    `UPDATE shopify_orders
        SET state = 'held', held_why = $3, sync_error = NULL, next_try = NULL
      WHERE realm_id = $1 AND order_gid = $2`,
    [realmId, gid, String(why || '').slice(0, 300)]
  );
}

// A failure retries itself. The wait doubles each time and stops doubling at an
// hour: long enough that books which are down all afternoon are not hammered,
// short enough that nothing is still sitting there in the morning. Postgres
// reads the old `tries` on the right-hand side, so the first failure waits a
// minute, the second two, the third four.
export async function setFailed(realmId, gid, err) {
  await pool.query(
    `UPDATE shopify_orders
        SET state      = 'waiting',
            tries      = COALESCE(tries, 0) + 1,
            sync_error = $3,
            next_try   = NOW() + make_interval(
                           mins => LEAST(60, POWER(2, GREATEST(0, COALESCE(tries, 0))))::int)
      WHERE realm_id = $1 AND order_gid = $2`,
    [realmId, gid, String(err || '').slice(0, 500)]
  );
}

export async function setOff(realmId, gid, why) {
  await pool.query(
    `UPDATE shopify_orders SET state = 'off', held_why = $3, next_try = NULL
      WHERE realm_id = $1 AND order_gid = $2`,
    [realmId, gid, String(why || '').slice(0, 300)]
  );
}

// Everything that was held goes back in the queue. Called when a mapping is
// saved or an item is made, because that is exactly the thing most of them were
// held on - and called by hand from the page, for anything else.
export async function releaseHeld(realmId, why) {
  const args = [realmId];
  let where = `realm_id = $1 AND state = 'held'`;
  if (why) { args.push(why); where += ` AND held_why = $2`; }
  const r = await pool.query(
    `UPDATE shopify_orders
        SET state = 'waiting', next_try = NULL, tries = 0, held_why = NULL
      WHERE ${where}`, args);
  return r.rowCount;
}

// An order that changed after it was written is not quietly rewritten - the
// books already hold an invoice with that number. It is noted and shown, and
// whoever keeps the books decides.
export async function heldList(realmId, limit) {
  const r = await pool.query(
    `SELECT o.order_gid, o.name, o.placed_at, o.total, o.held_why, o.sync_error,
            o.tries, o.next_try, o.state, o.shop_id, o.lines,
            s.label AS shop_label
       FROM shopify_orders o
       LEFT JOIN shopify_shops s ON s.id = o.shop_id
      WHERE o.realm_id = $1 AND o.state IN ('held','waiting')
        AND (o.held_why IS NOT NULL OR o.sync_error IS NOT NULL)
      ORDER BY o.placed_at DESC NULLS LAST
      LIMIT $2`,
    [realmId, Math.min(Number(limit) || 200, 1000)]
  );
  return r.rows;
}

// The address Shopify will call us on. Made once per shop and kept, because it
// is registered with Shopify and must not move underneath them.
// What was left out, and why it was.
//
// "6 left out" was a number on a card with nothing behind it - no tab, no
// list, and nothing happened when it was clicked. A figure nobody can open
// is a figure nobody believes, and this one is about orders that will never
// be invoiced unless somebody changes their mind about them.
export async function offList(realmId, limit) {
  const r = await pool.query(
    `SELECT o.order_gid, o.name, o.placed_at, o.total, o.held_why, o.cancelled,
            s.label AS shop_label
       FROM shopify_orders o
       LEFT JOIN shopify_shops s ON s.id = o.shop_id
      WHERE o.realm_id = $1 AND o.state = 'off'
      ORDER BY o.placed_at DESC NULLS LAST
      LIMIT $2`,
    [realmId, Math.min(Number(limit) || 300, 1000)]
  );
  return r.rows;
}

export async function shopHookKey(realmId, shopId) {
  const r = await pool.query(
    'SELECT hook_key FROM shopify_shops WHERE realm_id = $1 AND id = $2',
    [realmId, Number(shopId)]
  );
  if (!r.rows[0]) throw new Error('No such shop');
  if (r.rows[0].hook_key) return r.rows[0].hook_key;

  const key = crypto.randomBytes(16).toString('hex');
  await pool.query('UPDATE shopify_shops SET hook_key = $2 WHERE id = $1', [Number(shopId), key]);
  return key;
}

export async function shopByHookKey(key) {
  if (!key || !/^[a-f0-9]{8,64}$/.test(String(key))) return null;
  const r = await pool.query('SELECT * FROM shopify_shops WHERE hook_key = $1', [String(key)]);
  return r.rows[0] || null;
}

/* ==================== connecting a shop properly ==================== */

// The Dev Dashboard hands out a client id and a client secret, not a token.
// That is the app; a token belongs to one shop and is what the shop gives back
// when it is asked to let this app in. So the token is never typed by anybody -
// the merchant presses a button, approves on Shopify's own screen, and Shopify
// sends us the token itself.
//
// Which is also the safer shape: a token pasted into a form has been in a
// clipboard, probably in a chat, and lives as long as nobody remembers to
// revoke it. One that arrives this way has been nowhere.

export const SCOPES = (process.env.SHOPIFY_SCOPES ||
  'read_orders,read_products,read_inventory,read_customers')
  .split(',').map(s => s.trim()).filter(Boolean).join(',');

// The keys belong to a company, not to the server.
//
// Shopify will only let an app be installed on one named shop unless it has
// been through the app store, so a consultancy running five clients runs five
// Shopify apps - one made inside each client's own Shopify. One pair of keys on
// the server would therefore have worked for exactly one client and then stuck.
//
// The server's own SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET stay as a fallback
// for a single-client install, so nothing that already works stops working.
export async function appKeysFor(realmId) {
  let kept = null;
  try { kept = await getSetting(realmId, 'shopify:app', null); } catch (e) { kept = null; }

  if (kept && kept.id && kept.secret) {
    let secret = '';
    try { secret = decrypt(kept.secret); } catch (e) { secret = ''; }
    if (secret) return { id: kept.id, secret, ready: true, from: 'company' };
  }

  const id = process.env.SHOPIFY_CLIENT_ID || '';
  const secret = process.env.SHOPIFY_CLIENT_SECRET || '';
  return { id, secret, ready: !!(id && secret), from: id ? 'server' : 'nowhere' };
}

export async function saveAppKeys(realmId, id, secret) {
  const clean = String(id || '').trim();
  const sec = String(secret || '').trim();
  if (!clean || !sec) throw new Error('Both the Client ID and the Client secret are needed');
  await setSetting(realmId, 'shopify:app', { id: clean, secret: encrypt(sec) });
  return { id: clean, ready: true };
}

export async function forgetAppKeys(realmId) {
  await setSetting(realmId, 'shopify:app', null);
}

export function installUrl(domain, redirectUri, state, clientId) {
  const u = new URL('https://' + domain + '/admin/oauth/authorize');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  return u.toString();
}

// Shopify signs what it sends back. Checking it is what stops somebody simply
// calling our callback with a shop of their choosing.
export function callbackIsReal(query, secret) {
  const given = String(query.hmac || '');
  if (!given) return false;

  const text = Object.keys(query)
    .filter(k => k !== 'hmac' && k !== 'signature')
    .sort()
    .map(k => encodeURIComponent(k).replace(/%20/g, '+') + '=' +
              encodeURIComponent(query[k]).replace(/%20/g, '+'))
    .join('&');

  const mine = crypto.createHmac('sha256', secret).update(text).digest('hex');
  const a = Buffer.from(mine, 'utf8');
  const b = Buffer.from(given, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// The code Shopify handed back, turned into the token that lasts.
export async function exchangeCode(domain, code, keys) {
  const { id, secret } = keys;
  const r = await fetch('https://' + domain + '/admin/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ client_id: id, client_secret: secret, code })
  });

  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch (e) { body = null; }

  if (!r.ok || !body || !body.access_token) {
    const why = (body && (body.error_description || body.error)) || text.slice(0, 200);
    throw new Error('Shopify would not give a token: ' + why);
  }
  return { token: body.access_token, scopes: body.scope || '' };
}

// A whole company's worth at once, when what failed was not the order but the
// books themselves - one statement instead of five hundred.
export async function failAll(realmId, gids, err) {
  if (!gids.length) return 0;
  const r = await pool.query(
    `UPDATE shopify_orders
        SET state      = 'waiting',
            tries      = COALESCE(tries, 0) + 1,
            sync_error = $3,
            next_try   = NOW() + make_interval(
                           mins => LEAST(60, POWER(2, GREATEST(0, COALESCE(tries, 0))))::int)
      WHERE realm_id = $1 AND order_gid = ANY($2::text[])`,
    [realmId, gids, String(err || '').slice(0, 500)]
  );
  return r.rowCount;
}

/* ==================== what Fusion itself did ==================== */

// Not "everything made since Tuesday" - exactly what this app made, because
// this app wrote down every one of them at the moment it did it. Anything
// somebody made by hand in QuickBooks is no business of an undo button.

export async function madeItems(realmId, since) {
  const args = [realmId];
  let when = '';
  if (since) { args.push(since); when = ' AND at >= $2'; }
  const r = await pool.query(
    `SELECT at, sku, title, note, detail
       FROM shopify_events
      WHERE realm_id = $1 AND kind = 'item'${when}
      ORDER BY id DESC LIMIT 500`, args);

  // one row per item, newest first, and only the ones that were actually made
  const seen = new Set(), out = [];
  r.rows.forEach(e => {
    const id = e.detail && e.detail.id;
    if (!id || seen.has(id)) return;
    if (!/^made "/.test(String(e.note || ''))) return;   // not "already had"
    seen.add(id);
    out.push({
      qbId: String(id), at: e.at, sku: e.sku || '', title: e.title || '',
      note: e.note || ''
    });
  });
  return out;
}

export async function madeInvoices(realmId, since) {
  const args = [realmId];
  let when = '';
  if (since) { args.push(since); when = ' AND at >= $2'; }
  const r = await pool.query(
    `SELECT at, order_name, order_gid, note, detail
       FROM shopify_events
      WHERE realm_id = $1 AND kind = 'invoice'${when}
      ORDER BY id DESC LIMIT 2000`, args);

  const seen = new Set(), out = [];
  r.rows.forEach(e => {
    const d = e.detail || {};
    if (d.existing) return;                 // it was already there; not ours
    if (!d.id || seen.has(d.id)) return;
    seen.add(d.id);
    out.push({
      qbId: String(d.id), at: e.at, name: e.order_name || '', gid: e.order_gid || '',
      total: d.total || 0, lines: d.lines || 0, note: e.note || ''
    });
  });
  return out;
}

// An order whose invoice has been deleted is not written any more, so it goes
// back in the queue as if it never had been - which is what makes "delete them
// and I will upload again" actually work.
export async function unsync(realmId, gids) {
  if (!gids.length) return 0;
  const r = await pool.query(
    `UPDATE shopify_orders
        SET state = 'waiting', synced_at = NULL, qb_doc_number = NULL, qb_id = NULL,
            next_try = NULL, tries = 0, sync_error = NULL, held_why = NULL
      WHERE realm_id = $1 AND order_gid = ANY($2::text[])`,
    [realmId, gids]
  );
  return r.rowCount;
}

// Every item in the books, for choosing what to merge into.
