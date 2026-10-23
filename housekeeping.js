// What the database is allowed to keep, and the sweep that holds it to it.
//
// Three different reasons the room was going:
//
// **Rows nobody can reach.** A courier account attached to the wrong company
// and taken off again left every order it had pulled behind it: `removeAccount`
// deleted the account row and nothing else, so the orders sat there with an
// `account_id` pointing at a row that no longer exists. Invisible on every
// screen, counted by nothing, and still taking the room. `orphans()` is the
// only thing that can find them now, and it is why it runs on every start.
//
// **The courier's own JSON.** Every order kept a copy of the whole answer the
// courier sent - a couple of kilobytes each, for a field we read once. Worth
// having for a few days while a mapping is being checked; not worth having for
// a year.
//
// **Shopify.** Only the invoice matters: that an order became one, and which
// one. The order's own line items are what the invoice is built from, so they
// are needed right up to the moment it is written and for a short while after
// in case it has to be undone - and after that they are a copy of somebody
// else's records. The small row stays for ever, because it is what stops the
// same order being invoiced twice; the heavy part goes.
//
// Nothing here deletes anything a person could still be waiting for: an order
// that has not been invoiced keeps everything, however old it is.

import { pool } from './db.js';

const DAY = 24 * 3600 * 1000;

// how long the courier's own JSON is worth keeping
const RAW_DAYS = Math.max(1, Number(process.env.COURIER_RAW_DAYS) || 3);
// how long a written-up Shopify order keeps its line items, for undo
const LINES_DAYS = Math.max(1, Number(process.env.SHOPIFY_LINES_DAYS) || 10);
// How long the Shopify log is kept.
//
// Three days, not three weeks. It is a log of what happened, watched while
// it happens and read the morning after - nobody opens it to look at the
// 14th of last month, and the thing that actually has to last is on the
// order row itself (`qb_doc_number`, `synced_at`), which is never trimmed.
// A log that keeps three weeks of five hundred orders a day is most of what
// this database is, for no reading anybody does.
const EVENT_DAYS = Math.max(1, Number(process.env.SHOPIFY_EVENT_DAYS) || 3);

async function bytes() {
  const r = await pool.query('SELECT pg_database_size(current_database())::bigint AS b');
  return Number(r.rows[0].b);
}

async function count(sql, args) {
  const r = await pool.query(sql, args || []);
  return r.rowCount;
}

/* ---------- rows nobody can reach ---------- */

// Every courier table scoped by account, cleared of rows whose account is
// gone. This is what takes away the data of an account added to the wrong
// company and removed again - there is no screen it could be reached from, so
// there is no screen it could be deleted from either.
export async function orphans() {
  const out = { orders: 0, cprs: 0, hooks: 0 };

  out.orders = await count(
    `DELETE FROM courier_orders
      WHERE account_id NOT IN (SELECT id FROM courier_accounts)`);

  out.cprs = await count(
    `DELETE FROM courier_cprs
      WHERE account_id NOT IN (SELECT id FROM courier_accounts)`);

  try {
    out.hooks = await count(
      `DELETE FROM courier_hook_log
        WHERE account_id NOT IN (SELECT id FROM courier_accounts)`);
  } catch (e) { /* the table arrives with initHooks */ }

  // cpr_runs is scoped by company and by CPR number, not by account, so there
  // is nothing orphaned to find in it.

  return out;
}

/* ---------- the heavy parts of what we keep ---------- */

export async function trimCourierRaw(days) {
  return count(
    `UPDATE courier_orders
        SET raw = '{}'::jsonb
      WHERE seen_at < NOW() - ($1 || ' days')::interval
        AND raw IS NOT NULL AND raw <> '{}'::jsonb`,
    [String(Number(days) || RAW_DAYS)]);
}

// An order that is in the books keeps its row - the row is the record that it
// was - but not the shop's own line items. An order still waiting or held
// keeps everything: that is the one the lines are still needed for.
export async function trimShopifyLines(days) {
  try {
    return await count(
      `UPDATE shopify_orders
          SET lines = '[]'::jsonb, bill_to = NULL
        WHERE state IN ('done', 'off')
          AND COALESCE(synced_at, seen_at) < NOW() - ($1 || ' days')::interval
          AND (lines IS NOT NULL AND lines <> '[]'::jsonb
               OR bill_to IS NOT NULL)`,
      [String(Number(days) || LINES_DAYS)]);
  } catch (e) {
    return 0;
  }
}

export async function trimShopifyEvents(days) {
  try {
    return await count(
      `DELETE FROM shopify_events
        WHERE at < NOW() - ($1 || ' days')::interval`,
      [String(Number(days) || EVENT_DAYS)]);
  } catch (e) {
    return 0;
  }
}

// Logs of uploads keep their message for ever; a year of them is a year of
// messages nobody will read again.
export async function trimUploadLogs(days) {
  try {
    return await count(
      `DELETE FROM upload_logs
        WHERE created_at < NOW() - ($1 || ' days')::interval`,
      [String(Math.max(30, Number(days) || 120))]);
  } catch (e) {
    return 0;
  }
}

/* ---------- the sweep ---------- */

// `vacuum` is only ever passed by a person pressing the button. Deleting rows
// in Postgres frees them for re-use but does not give the room back to the
// disk, so a database that was 47 MB stays 47 MB and simply stops growing.
// VACUUM FULL does give it back, and takes a lock on each table while it does
// - a second or two at this size, which is fine when somebody asked for it and
// would not be fine in the middle of the night.
export async function cleanUp(opts) {
  const o = opts || {};
  const before = await bytes();

  const gone = await orphans();
  const raw = await trimCourierRaw(o.rawDays);
  const lines = await trimShopifyLines(o.linesDays);
  const events = await trimShopifyEvents(o.eventDays);
  const uploads = await trimUploadLogs(o.uploadDays);

  if (o.vacuum) {
    for (const t of ['courier_orders', 'courier_cprs', 'courier_hook_log',
                     'shopify_orders', 'shopify_events', 'upload_logs',
                     'cache_blobs']) {
      try { await pool.query('VACUUM FULL ' + t); }
      catch (e) { /* a table this database has not got, or is busy */ }
    }
  } else {
    // the gentle one: no lock, and it is what lets the next rows go in the
    // room the deleted ones left
    for (const t of ['courier_orders', 'shopify_orders', 'shopify_events']) {
      try { await pool.query('VACUUM (ANALYZE) ' + t); }
      catch (e) { /* not worth a word */ }
    }
  }

  const after = await bytes();

  return {
    at: new Date().toISOString(),
    before, after,
    freed: Math.max(0, before - after),
    vacuumed: !!o.vacuum,
    orphanOrders: gone.orders,
    orphanCprs: gone.cprs,
    orphanHooks: gone.hooks,
    rawCleared: raw,
    shopifyLinesCleared: lines,
    shopifyEventsDeleted: events,
    uploadLogsDeleted: uploads,
    kept: {
      courierRawDays: Number(o.rawDays) || RAW_DAYS,
      shopifyLinesDays: Number(o.linesDays) || LINES_DAYS,
      shopifyEventDays: Number(o.eventDays) || EVENT_DAYS
    }
  };
}

let last = null;
export function lastClean() { return last; }

// On the way up - which is when the orphans of whatever happened yesterday get
// taken away - and once a day after. Unref'd, so it never holds the process
// open, and it piggybacks on a database that the start-up has just woken
// anyway, so the first one costs nothing.
export function startHousekeeping() {
  const run = () => cleanUp({})
    .then(r => {
      last = r;
      const said = [];
      if (r.orphanOrders) said.push(r.orphanOrders + ' orders of a removed account');
      if (r.orphanCprs) said.push(r.orphanCprs + ' receipts of a removed account');
      if (r.rawCleared) said.push(r.rawCleared + " couriers' raw answers");
      if (r.shopifyLinesCleared) said.push(r.shopifyLinesCleared + ' invoiced Shopify orders stripped');
      if (r.shopifyEventsDeleted) said.push(r.shopifyEventsDeleted + ' old Shopify log lines');
      if (said.length) console.log('housekeeping:', said.join(', '));
    })
    .catch(e => console.error('housekeeping failed:', e.message));

  setTimeout(run, 20000);
  const t = setInterval(run, DAY);
  if (t.unref) t.unref();
}
