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
// How long a WRITTEN-UP Shopify order keeps its line items.
//
// Ten days while the connector is still settling in, asked for by the owner
// in as many words: "ek din wala data abhi filhaal 10 din ki range par le
// jayen jab tak system theek na ban jaye."
//
// The one-day argument is still right about a finished order - the invoice is
// in the books and the order is still in Shopify, so a second copy of the
// lines here is a copy nobody reads. But it is only right once the writing
// can be trusted, and until then ten days is what makes **Check the
// invoices** able to look back over a fortnight's work, and what makes
// **Put it back** able to write an order again after its invoice has been
// deleted. Both of those read the lines kept here and nothing else.
//
// It is a dial, not a decision: `SHOPIFY_LINES_DAYS` moves it without a
// deploy, and it comes back down to 1 when she says the system is right.
//
// Two things this number can never reach, whatever it is set to:
//
//   - an order still `waiting` or `held` keeps its lines for ever. A held
//     order is a question waiting on a person, and the lines are the question.
//     See trimShopifyLines below.
//   - the order's own row. That row is its Shopify id, its number, the
//     invoice number and the day it went in - a couple of hundred bytes
//     against a couple of kilobytes of lines, and the only thing that cannot
//     be got back from anywhere else.
const LINES_DAYS = Math.max(1, Number(process.env.SHOPIFY_LINES_DAYS) || 10);
// How long the Shopify log is kept.
//
// Ten days, not three weeks and not one day. One day is the right length for
// a log of a connector that is working - it is watched while it happens and
// read the morning after, and the thing that has to last is on the order row
// itself (`qb_doc_number`, `synced_at`), which is never trimmed. It is the
// wrong length for a connector still being argued with: "why was this one
// held on Tuesday" is a question that gets asked on Friday, and the answer
// has to still be there.
//
// Ten days of it, while the system settles. `SHOPIFY_EVENT_DAYS` moves it.
const EVENT_DAYS = Math.max(1, Number(process.env.SHOPIFY_EVENT_DAYS) || 10);

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
// was - but not the shop's own line items. The lines go, the row stays.
//
// **An order still `waiting` or `held` keeps everything, for ever, however
// old it is.** That is not a side effect of the days above, it is the rule:
// a held order is a question waiting on a person - this SKU is on no item,
// turn the discount box on - and the order's lines ARE the question. Throw
// them away and **Needs you** loses the thing it is asking about, and an
// order the owner was about to sort out is gone. She asked for this in as
// many words: "jo invoices Needs you mein pending hain, woh pending us time
// tak rahein jab tak main sort out na kar loon."
//
// Which is why the `state IN ('done', 'off')` below is the whole of the
// safety, and why nothing may be added to that list that is not finished
// with: 'done' is in QuickBooks, 'off' was set aside on purpose. Any other
// state is somebody's open question.
//
// The row is what stops an order being invoiced twice. Shopify goes on
// sending webhooks about an order for weeks - updated, paid, fulfilled - and
// each one asks "has this been written?". The answer is that row, and it is
// the only copy of the answer we have: Shopify does not know our invoice
// number, and QuickBooks does not know Shopify's order id.
//
// Without it the connector would have to ask QuickBooks, by invoice number,
// on every webhook - which works right up until somebody changes what the
// number looks like, and then writes a second invoice for an order that was
// already in the books. A couple of hundred bytes an order is the cheapest
// insurance in this app.
export async function trimShopifyLines(days) {
  try {
    return await count(
      `UPDATE shopify_orders
          SET lines = '[]'::jsonb, bill_to = NULL
        WHERE state IN ('done', 'off')   -- never 'waiting', never 'held'
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

// A product request that has been answered.
//
// A row still waiting (`state = 'new'`) is a question on a screen and is kept
// for ever, the same rule held orders get. One already answered - made in
// QuickBooks, or said no to - is a note about a decision, and a month of those
// is plenty: the product itself is in QuickBooks, and Shopify still has its
// own. Said no to and trimmed simply means it can be offered again if Shopify
// mentions the variant once more, which is the right outcome anyway.
export async function trimNewItems(days) {
  try {
    return await count(
      `DELETE FROM shopify_new_items
        WHERE state IN ('done', 'off')
          AND COALESCE(decided_at, seen_at) < NOW() - ($1 || ' days')::interval`,
      [String(Math.max(7, Number(days) || 30))]);
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
  const asked = await trimNewItems(o.askDays);
  const uploads = await trimUploadLogs(o.uploadDays);

  if (o.vacuum) {
    for (const t of ['courier_orders', 'courier_cprs', 'courier_hook_log',
                     'shopify_orders', 'shopify_events', 'shopify_new_items',
                     'upload_logs', 'cache_blobs']) {
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
    newItemsDeleted: asked,
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
      if (r.newItemsDeleted) said.push(r.newItemsDeleted + ' answered product requests');
      if (said.length) console.log('housekeeping:', said.join(', '));
    })
    .catch(e => console.error('housekeeping failed:', e.message));

  setTimeout(run, 20000);
  const t = setInterval(run, DAY);
  if (t.unref) t.unref();
}
