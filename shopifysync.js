// Orders going into the books by themselves.
//
// The page where you pick dates and press a button stays - it is how a month
// that was missed gets filled, and how anything that slipped through is caught.
// This is the other half: an order placed on Shopify at nine in the evening is
// an invoice in QuickBooks at nine in the evening, with nobody there.
//
// Three rules it is built on, and each of them is the answer to a way these
// things normally go wrong:
//
//  1. A webhook is a nudge, never a source. Shopify's call says "order 123
//     moved"; the order is then read back from Shopify's own API, and that is
//     what we act on. So a forged call can at worst make us re-read a real
//     order, the body's shape never has to be understood, and an order that
//     changed three times in a minute is written once, correctly.
//
//  2. One bad order never holds up a good one. Each order is its own attempt.
//     Something QuickBooks refused is put back in the queue and tried again on
//     a doubling wait; something a person has to decide is held and said so.
//     The rest go through.
//
//  3. Nothing is silent. Every invoice written, every item made, every refusal
//     and every price that moved is a row in shopify_events - which is what the
//     report page reads. "Is it working" should be a page, not a feeling.

import { pool } from './db.js';
import { getSetting, setSetting } from './settings.js';
import { getMappings, saveMapping } from './mappings.js';
import {
  fetchOne, fetchProduct, saveOne, dueOrders,
  setDone, setHeld, setFailed, setOff, releaseHeld, note, toInvoice, ask
} from './shopify.js';
import { decrypt } from './secrets.js';
import {
  getAccessToken, qbQuery, loadItems, loadTerms, getOrCreateCustomer,
  postInvoice, createItem, isRetryable
} from './qb.js';

const KEY = 'shopify';

// How often the queue is looked at, and how many are taken each time. A webhook
// pushes its own order through at once, so this sweep is mostly for what failed
// and is due again - it does not need to be fast, it needs to be certain.
const EVERY = Math.max(20, Number(process.env.SHOPIFY_SWEEP_SECONDS) || 60) * 1000;
const BATCH = Math.max(1, Number(process.env.SHOPIFY_BATCH) || 20);

export const DEFAULTS = {
  // Off until somebody turns it on. These are real books: a switch that starts
  // on would have written every order already sitting in the table the moment
  // this shipped, which is not a thing to do to somebody's accounts without
  // their say-so. The report page says plainly that it is off.
  on: false,
  customer: 'Shopify Sale - {mon}{yy}',
  prefix: '',
  terms: '',
  shippingItem: '',
  keepTitles: true,
  makeItems: true,                         // make the item if the books lack it
  itemType: 'NonInventory',                // or Inventory, or Service
  incomeAccount: '',
  cogsAccount: '',
  assetAccount: ''
};

export async function settingsOf(realmId) {
  const kept = await getSetting(realmId, KEY, null);
  return Object.assign({}, DEFAULTS, kept || {});
}

export async function saveSettings(realmId, patch) {
  const now = await settingsOf(realmId);
  const next = Object.assign({}, now);
  Object.keys(DEFAULTS).forEach(k => {
    if (patch[k] !== undefined) next[k] = patch[k];
  });
  await setSetting(realmId, KEY, next);
  return next;
}

// Can an item be made at all? Inventory needs three accounts; the other kinds
// need one. Said in words rather than left to QuickBooks to refuse, because
// "ValidationFault 2030" is not something anybody should have to read.
export function itemsPossible(s) {
  if (!s.makeItems) return { can: false, why: 'making items is switched off' };
  if (!s.incomeAccount) return { can: false, why: 'no income account chosen in Shopify settings' };
  if (s.itemType === 'Inventory' && (!s.assetAccount || !s.cogsAccount)) {
    return { can: false, why: 'inventory items need an asset and a cost-of-sales account' };
  }
  return { can: true };
}

/* ==================== the books, held open for one pass ==================== */

// Everything a pass needs from QuickBooks, read once. A hundred orders should
// not be a hundred readings of the item list.
async function openBooks(realmId) {
  const token = await getAccessToken(realmId);
  return {
    realmId,
    token,
    items: await loadItems(realmId, token),      // name -> id
    terms: await loadTerms(realmId, token),
    customers: {},
    skus: await skuIndex(realmId, token),        // sku -> name
    saved: await getMappings(realmId),
    made: 0
  };
}

async function skuIndex(realmId, token) {
  const out = new Map();
  let start = 1;
  while (true) {
    const q = await qbQuery(realmId, token,
      'SELECT Id, Name, Sku, Active FROM Item STARTPOSITION ' + start + ' MAXRESULTS 1000');
    const arr = q.Item || [];
    arr.forEach(i => {
      if (!i.Sku) return;
      const k = String(i.Sku).toLowerCase().trim();
      if (!out.has(k) || i.Active !== false) out.set(k, i.Name);
    });
    if (arr.length < 1000) break;
    start += 1000;
    if (start > 9000) break;
  }
  return out;
}

// What a product is in the books, and if it is nothing yet, making it.
//
// The looking-up order is the same one the by-hand page uses, and it matters:
// what somebody said beats what was guessed, and a SKU beats a name. Only after
// all three have missed is anything created - a new item in real books is not a
// thing to do lightly, and an item made because a name was spelled differently
// is a duplicate somebody has to merge later.
async function itemFor(books, line, s, ctx) {
  const key = String(line.sku || line.title || '').toLowerCase().trim();

  const hand = books.saved[key];
  if (hand && hand.skip) return { skip: true };
  if (hand && hand.qbItem && books.items[hand.qbItem.toLowerCase()]) {
    return { name: hand.qbItem };
  }

  const sku = String(line.sku || '').toLowerCase().trim();
  if (sku && books.skus.has(sku)) return { name: books.skus.get(sku) };

  const title = String(line.title || '').trim();
  if (title && books.items[title.toLowerCase()]) return { name: title };

  const can = itemsPossible(s);
  if (!can.can) return { missing: line.sku || line.title, why: can.why };

  const name = title || line.sku;
  if (!name) return { missing: '(a line with no name)', why: 'the line has neither a SKU nor a title' };

  const made = await createItem(books.realmId, books.token, {
    name,
    sku: line.sku || '',
    type: s.itemType,
    price: line.rate,
    incomeAccount: s.incomeAccount,
    cogsAccount: s.cogsAccount,
    assetAccount: s.assetAccount
  });

  if (made.ok) {
    books.items[String(made.name).toLowerCase()] = made.id;
    if (made.sku) books.skus.set(String(made.sku).toLowerCase(), made.name);
    books.made++;
    // remembered, so the by-hand page shows the same answer and nothing is made twice
    await saveMapping(books.realmId, key, line.sku || null, line.title || null, made.name, false);
    books.saved[key] = { qbItem: made.name, skip: false };
    await note(books.realmId, 'item', {
      shopId: ctx.shopId, sku: line.sku, title: line.title,
      note: 'made "' + made.name + '" in QuickBooks as ' + s.itemType,
      detail: { id: made.id, price: line.rate }
    });
    return { name: made.name };
  }

  // Already there under that name - which happens when the name matches but the
  // case or the spacing did not. Found rather than made, and remembered.
  if (/duplicate name/i.test(made.error || '')) {
    const safe = String(name).replace(/'/g, "''");
    const q = await qbQuery(books.realmId, books.token,
      `SELECT Id, Name FROM Item WHERE Name = '${safe}' MAXRESULTS 1`);
    const found = (q.Item || [])[0];
    if (found) {
      books.items[String(found.Name).toLowerCase()] = found.Id;
      await saveMapping(books.realmId, key, line.sku || null, line.title || null, found.Name, false);
      books.saved[key] = { qbItem: found.Name, skip: false };
      return { name: found.Name };
    }
  }

  await note(books.realmId, 'error', {
    shopId: ctx.shopId, ok: false, sku: line.sku, title: line.title,
    note: 'QuickBooks would not make the item: ' + made.error,
    detail: { status: made.status, tid: made.tid }
  });
  return { missing: line.sku || line.title, why: 'QuickBooks refused to make the item' };
}

/* ==================== one order ==================== */

function payloadOf(inv, customerId, items, terms) {
  const lines = inv.lines.map(L => {
    const id = items[String(L.item).toLowerCase()];
    if (!id) throw new Error('Item vanished from QuickBooks: "' + L.item + '"');
    const line = {
      DetailType: 'SalesItemLineDetail',
      Amount: L.amt,
      SalesItemLineDetail: { ItemRef: { value: id }, Qty: L.qty, UnitPrice: L.rate }
    };
    if (L.desc) line.Description = L.desc;
    return line;
  });

  const disc = Math.round(Number(inv.discount || 0) * 100) / 100;
  if (disc > 0) {
    lines.push({
      DetailType: 'DiscountLineDetail',
      Amount: disc,
      DiscountLineDetail: { PercentBased: false }
    });
  }

  const p = { DocNumber: inv.docNumber, CustomerRef: { value: customerId }, Line: lines };
  if (inv.txnDate) p.TxnDate = inv.txnDate;
  if (inv.dueDate) p.DueDate = inv.dueDate;
  if (inv.memo) p.CustomerMemo = { value: inv.memo };

  if (Array.isArray(inv.billTo) && inv.billTo.length) {
    p.BillAddr = {};
    ['Line1','Line2','Line3','Line4','Line5'].forEach((k, i) => {
      if (inv.billTo[i]) p.BillAddr[k] = String(inv.billTo[i]).slice(0, 500);
    });
  }

  const t = terms[String(inv.terms || '').toLowerCase()];
  if (t) p.SalesTermRef = { value: t };

  return p;
}

// Write one order into the books. Everything it can decide for itself it
// decides; everything it cannot it says plainly and leaves alone.
export async function writeOne(books, row, s) {
  const realmId = books.realmId;
  const ctx = { shopId: row.shop_id };

  if (row.cancelled) {
    await setOff(realmId, row.order_gid, 'cancelled in Shopify');
    await note(realmId, 'cancelled', {
      shopId: row.shop_id, orderName: row.name, gid: row.order_gid,
      note: 'called off in Shopify, so no invoice was written'
    });
    return 'off';
  }

  // what each line is in the books, making what is missing if that is allowed
  const lines = [];
  const missing = [];
  for (const L of (row.lines || [])) {
    if (!L.qty) continue;
    const got = await itemFor(books, L, s, ctx);
    if (got.skip) continue;
    if (got.missing) { missing.push({ what: got.missing, why: got.why }); continue; }
    lines.push({ item: got.name, desc: s.keepTitles === false ? '' : (L.title || ''),
                 qty: L.qty, rate: L.rate, amt: L.amt });
  }

  if (missing.length) {
    const why = missing[0].why + ': ' + missing.map(m => m.what).slice(0, 5).join(', ');
    await setHeld(realmId, row.order_gid, why);
    await note(realmId, 'held', {
      shopId: row.shop_id, orderName: row.name, gid: row.order_gid, ok: false,
      note: why, detail: { missing }
    });
    return 'held';
  }

  // the invoice itself, in the shape the by-hand path builds too, so the two
  // can never put a different invoice into the books for the same order
  // only for the header - number, customer, dates, address, discount. The lines
  // were worked out above, and delivery is added below, so neither is asked for
  // here or it would go on twice.
  const built = toInvoice(Object.assign({}, row, { lines: row.lines }), {
    match: () => 'placeholder',
    customer: s.customer, prefix: s.prefix, terms: s.terms,
    keepTitles: s.keepTitles
  });
  if (built.skip === 'empty') {
    await setOff(realmId, row.order_gid, 'nothing to bill on it');
    return 'off';
  }
  const inv = built.invoice;
  inv.lines = lines;
  if (Number(row.shipping) > 0 && s.shippingItem) {
    inv.lines.push({ item: s.shippingItem, desc: 'Delivery',
                     qty: 1, rate: Number(row.shipping), amt: Number(row.shipping) });
  }
  if (!inv.lines.length) {
    await setOff(realmId, row.order_gid, 'every line was set aside');
    return 'off';
  }

  // The books may already hold it - this app wrote it last week, or somebody
  // typed it. Found rather than written again, and written down as done.
  const safe = String(inv.docNumber).replace(/'/g, "''");
  try {
    const q = await qbQuery(realmId, books.token,
      `SELECT Id, DocNumber FROM Invoice WHERE DocNumber = '${safe}' MAXRESULTS 1`);
    const found = (q.Invoice || [])[0];
    if (found) {
      await setDone(realmId, row.order_gid, found.Id, found.DocNumber);
      await note(realmId, 'invoice', {
        shopId: row.shop_id, orderName: row.name, gid: row.order_gid,
        note: 'already in QuickBooks as ' + found.DocNumber + ', left alone',
        detail: { id: found.Id, existing: true }
      });
      return 'done';
    }
  } catch (e) { /* a books that will not answer is handled by the post below */ }

  let customerId;
  try {
    customerId = await getOrCreateCustomer(realmId, books.token, inv.customer, books.customers);
  } catch (e) {
    await setFailed(realmId, row.order_gid, e.message);
    await note(realmId, 'error', {
      shopId: row.shop_id, orderName: row.name, gid: row.order_gid, ok: false,
      note: 'could not find or make the customer "' + inv.customer + '": ' + e.message
    });
    return 'failed';
  }

  let out;
  try {
    out = await postInvoice(realmId, books.token, payloadOf(inv, customerId, books.items, books.terms));
  } catch (e) {
    out = { ok: false, error: e.message };
  }

  if (out.ok) {
    await setDone(realmId, row.order_gid, out.id, inv.docNumber);
    await note(realmId, 'invoice', {
      shopId: row.shop_id, orderName: row.name, gid: row.order_gid,
      note: 'written as invoice ' + inv.docNumber + ' for ' + inv.customer,
      detail: { id: out.id, lines: inv.lines.length, total: row.total }
    });
    return 'done';
  }

  // Duplicate document number is not a failure to retry - the books have it.
  if (/duplicate document number/i.test(out.error || '')) {
    await setDone(realmId, row.order_gid, null, inv.docNumber);
    await note(realmId, 'invoice', {
      shopId: row.shop_id, orderName: row.name, gid: row.order_gid,
      note: 'QuickBooks already had invoice ' + inv.docNumber, detail: { existing: true }
    });
    return 'done';
  }

  const retry = isRetryable(out.error, out.status);
  if (retry) {
    await setFailed(realmId, row.order_gid, out.error);
  } else {
    await setHeld(realmId, row.order_gid, 'QuickBooks refused it');
  }
  await note(realmId, 'error', {
    shopId: row.shop_id, orderName: row.name, gid: row.order_gid, ok: false,
    note: out.error,
    detail: { status: out.status, tid: out.tid, willRetry: !!retry }
  });
  return retry ? 'failed' : 'held';
}

/* ==================== the sweep ==================== */

const state = { running: false, lastAt: null, lastDid: null, note: '' };
export function syncState() { return Object.assign({}, state); }

export async function sweep() {
  if (state.running) return;
  state.running = true;
  const did = { done: 0, held: 0, failed: 0, off: 0, items: 0 };

  try {
    const rows = await dueOrders(BATCH);
    const byRealm = new Map();
    rows.forEach(r => {
      if (!byRealm.has(r.realm_id)) byRealm.set(r.realm_id, []);
      byRealm.get(r.realm_id).push(r);
    });

    for (const [realmId, list] of byRealm) {
      const s = await settingsOf(realmId);
      if (!s.on) continue;

      let books;
      try {
        books = await openBooks(realmId);
      } catch (e) {
        // no QuickBooks on this company yet, or it is down. Every one of its
        // orders is put back rather than marked wrong.
        for (const r of list) await setFailed(realmId, r.order_gid, e.message);
        continue;
      }

      for (const r of list) {
        try {
          const how = await writeOne(books, r, s);
          did[how] = (did[how] || 0) + 1;
        } catch (e) {
          await setFailed(realmId, r.order_gid, e.message);
          did.failed++;
        }
      }
      did.items += books.made;
    }
  } catch (e) {
    state.note = e.message;
  }

  state.running = false;
  state.lastAt = new Date().toISOString();
  state.lastDid = did;
  return did;
}

export function startShopifySync() {
  sweep().catch(e => console.error('shopify sweep:', e.message));
  const t = setInterval(() => {
    sweep().catch(e => console.error('shopify sweep:', e.message));
  }, EVERY);
  t.unref();
}

/* ==================== the nudge ==================== */

// Shopify called. Read the order back from Shopify, save it, and put it in the
// queue - then push it through at once rather than waiting for the sweep, which
// is the whole point of a webhook.
export async function nudgeOrder(realmId, shop, gid, topic) {
  const fresh = await fetchOne(shop, gid);
  if (!fresh) {
    await note(realmId, 'error', {
      shopId: shop.id, gid, ok: false,
      note: 'Shopify said order ' + gid + ' changed, but would not hand it back'
    });
    return 'gone';
  }

  const before = await pool.query(
    `SELECT state, total, financial, qb_doc_number FROM shopify_orders
      WHERE realm_id = $1 AND shop_id = $2 AND order_gid = $3`,
    [realmId, shop.id, gid]
  );
  const was = before.rows[0] || null;
  const row = await saveOne(realmId, shop.id, fresh);
  if (!row) return 'lost';

  // What kind of change this was, said in the log in the words somebody would
  // use about it. The invoice is not quietly rewritten when an order changes
  // after it was written - the books hold a number already, and that is a
  // decision for whoever keeps them.
  const already = was && was.state === 'done';
  if (topic === 'orders/cancelled' || fresh.cancelledAt) {
    await note(realmId, 'cancelled', {
      shopId: shop.id, orderName: row.name, gid, ok: !already,
      note: already
        ? 'cancelled in Shopify after invoice ' + was.qb_doc_number + ' was written - it needs voiding'
        : 'cancelled in Shopify before anything was written'
    });
    if (already) return 'needs-you';
    await setOff(realmId, gid, 'cancelled in Shopify');
    return 'off';
  }

  if (topic === 'refunds/create') {
    await note(realmId, 'refund', {
      shopId: shop.id, orderName: row.name, gid, ok: false,
      note: 'refunded in Shopify' + (already ? ' against invoice ' + was.qb_doc_number : ''),
      detail: { total: row.total }
    });
    return 'needs-you';
  }

  if (topic === 'orders/paid') {
    await note(realmId, 'paid', {
      shopId: shop.id, orderName: row.name, gid,
      note: 'marked paid in Shopify' + (already ? ' · invoice ' + was.qb_doc_number : ''),
      detail: { total: row.total, financial: row.financial }
    });
  }

  if (already) {
    const moved = was && Number(was.total) !== Number(row.total);
    if (moved) {
      await note(realmId, 'edited', {
        shopId: shop.id, orderName: row.name, gid, ok: false,
        note: 'changed after invoice ' + was.qb_doc_number + ' was written: ' +
              was.total + ' became ' + row.total,
        detail: { was: was.total, now: row.total }
      });
      return 'needs-you';
    }
    return 'done';
  }

  // not written yet: push it through now
  const s = await settingsOf(realmId);
  if (!s.on) return 'waiting';

  try {
    const books = await openBooks(realmId);
    return await writeOne(books, row, s);
  } catch (e) {
    await setFailed(realmId, gid, e.message);
    return 'failed';
  }
}

// A product changed. Nothing is written into the books for it on its own -
// an item is made when an order needs it, not when a product is drafted - but
// a price moving is worth saying, and a new product is worth knowing about
// before its first order arrives.
export async function nudgeProduct(realmId, shop, gid, topic) {
  const p = await fetchProduct(shop, gid);
  if (!p) return 'gone';

  const vs = (p.variants && p.variants.nodes) || [];
  const kept = await getSetting(realmId, 'shopify:prices', {}) || {};
  let moved = 0;

  for (const v of vs) {
    const key = v.sku || v.id;
    const price = Number(v.price) || 0;
    const cost = Number(v.inventoryItem && v.inventoryItem.unitCost &&
                        v.inventoryItem.unitCost.amount) || 0;
    const was = kept[key];

    if (!was) {
      if (topic === 'products/create') {
        await note(realmId, 'item', {
          shopId: shop.id, sku: v.sku, title: p.title + (v.title && v.title !== 'Default Title' ? ' · ' + v.title : ''),
          note: 'new on Shopify at ' + price + (cost ? ', cost ' + cost : ''),
          detail: { price, cost, status: p.status }
        });
      }
    } else if (was.price !== price || was.cost !== cost) {
      moved++;
      await note(realmId, 'price', {
        shopId: shop.id, sku: v.sku, title: p.title,
        note: (was.price !== price ? 'price ' + was.price + ' → ' + price : '') +
              (was.price !== price && was.cost !== cost ? ' · ' : '') +
              (was.cost !== cost ? 'cost ' + was.cost + ' → ' + cost : ''),
        detail: { wasPrice: was.price, price, wasCost: was.cost, cost }
      });
    }
    kept[key] = { price, cost };
  }

  await setSetting(realmId, 'shopify:prices', kept);
  return moved ? 'moved' : 'seen';
}

/* ==================== asking Shopify to call us ==================== */

const TOPICS = [
  'ORDERS_CREATE', 'ORDERS_UPDATED', 'ORDERS_PAID', 'ORDERS_CANCELLED',
  'REFUNDS_CREATE', 'PRODUCTS_CREATE', 'PRODUCTS_UPDATE'
];

const SUB = `
mutation FusionHook($topic: WebhookSubscriptionTopic!, $url: URL!) {
  webhookSubscriptionCreate(
    topic: $topic,
    webhookSubscription: { callbackUrl: $url, format: JSON }
  ) {
    webhookSubscription { id topic }
    userErrors { field message }
  }
}`;

const LIST = `{
  webhookSubscriptions(first: 50) {
    nodes { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } }
  }
}`;

// Registered with Shopify by us, not pasted by a person - Shopify is the one
// courier here that lets us set our own hooks up, so nobody should have to.
export async function wireHooks(realmId, shop, baseUrl) {
  const url = baseUrl.replace(/\/+$/, '') + '/hooks/shopify/' + shop.hook_key;
  const token = decrypt(shop.token);

  const now = await ask(shop.domain, token, LIST);
  const have = new Set(
    ((now && now.webhookSubscriptions && now.webhookSubscriptions.nodes) || [])
      .filter(n => n.endpoint && n.endpoint.callbackUrl === url)
      .map(n => n.topic)
  );

  const done = [], failed = [];
  for (const topic of TOPICS) {
    if (have.has(topic)) { done.push(topic); continue; }
    const r = await ask(shop.domain, token, SUB, { topic, url });
    const out = r && r.webhookSubscriptionCreate;
    const errs = (out && out.userErrors) || [];
    if (errs.length) {
      // already there on this address is not a failure
      if (/already|taken/i.test(errs[0].message || '')) { done.push(topic); continue; }
      failed.push(topic + ': ' + errs[0].message);
    } else {
      done.push(topic);
    }
  }

  await pool.query(
    'UPDATE shopify_shops SET hooks_at = NOW(), hooks = $2 WHERE id = $1',
    [shop.id, JSON.stringify({ url, done, failed })]
  );

  return { url, done, failed };
}

export { releaseHeld };
