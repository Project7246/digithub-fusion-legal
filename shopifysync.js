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
import { getMappings } from './mappings.js';
import {
  fetchOne, fetchProduct, saveOne, dueOrders,
  setDone, setHeld, setFailed, setOff, failAll, releaseHeld, note, toInvoice, ask
} from './shopify.js';
import { decrypt } from './secrets.js';
import {
  getAccessToken, qbQuery, loadTerms, getOrCreateCustomer,
  postInvoice, listAccounts, salesPrefs, isRetryable
} from './qb.js';

const KEY = 'shopify';

// A new order does not wait for this sweep at all - Shopify calls us and it is
// written there and then. So the sweep is only for what is left over: a backlog
// being worked through, and anything that failed and is due to be tried again.
//
// Which means asking every minute for ever is wasted breath. It asks every
// minute while there is work, and every ten minutes once there is none - and
// anything that puts work back in the queue wakes it immediately rather than
// letting it sleep out its ten minutes.
const BUSY_EVERY = Math.max(20, Number(process.env.SHOPIFY_SWEEP_SECONDS) || 60) * 1000;
const IDLE_EVERY = Math.max(BUSY_EVERY,
  (Number(process.env.SHOPIFY_IDLE_SECONDS) || 600) * 1000);
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
  // Nothing here makes an item, renames one, or puts a SKU on one. The books
  // are read and invoices are written, and that is the whole of what this
  // touches - the same deal the file upload has always had.
  //
  // There used to be a `makeItems` switch, default on, and it did real damage
  // before it was taken out: items created under Shopify's names beside the
  // real ones, SKUs written onto items night after night. Anything a SKU
  // cannot be matched to waits, by name, and somebody fixes it in QuickBooks.
  incomeAccount: '',
  cogsAccount: '',
  assetAccount: '',

  // Which orders are the books' business at all.
  //
  // startFrom is the line in the sand: turning the writing on should not go
  // back and write every order ever pulled. Nothing placed before this day is
  // written, and it says so rather than going quiet.
  startFrom: '',
  // An order that has not shipped is money not yet earned, and in cash on
  // delivery it may never be. Off by default, because it is a decision about
  // how these books are kept, not a thing to assume.
  onlyFulfilled: false,
  // Refunded in full, or voided in Shopify. Cancelled is never written at all -
  // an invoice for an order that was called off is simply wrong.
  skipRefunded: true
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

// The accounts QuickBooks will want, found in the company's own chart rather
// than asked for. These are the accounts QuickBooks itself makes when a company
// is set up, so in almost every book they are already there under these names;
// anything chosen by hand in the settings wins over what is found.
export function standingAccounts(all, s) {
  const bySub  = want => (all.find(a => a.sub === want) || {}).id;
  const byType = want => (all.find(a => a.type === want) || {}).id;
  const byName = re   => (all.find(a => re.test(a.name)) || {}).id;

  return {
    income: s.incomeAccount || bySub('SalesOfProductIncome') ||
            byName(/sales of product/i) || byType('Income'),
    asset:  s.assetAccount  || bySub('Inventory') ||
            byName(/inventory asset/i) || byType('Other Current Asset'),
    cogs:   s.cogsAccount   || byType('Cost of Goods Sold') ||
            byName(/cost of goods|cost of sales/i)
  };
}

// Can an item be made at all? Said in words rather than left to QuickBooks to
// refuse, because "ValidationFault 2030" is not something anybody should read.
// Nothing is ever made in the books from here. Kept because the settings
// screen still asks, and the honest answer is no rather than silence.
export function itemsPossible() {
  return { can: false, inventory: false,
           why: 'Fusion never makes a product in QuickBooks. A SKU it cannot ' +
                'match waits, by name, and you put it right in QuickBooks.' };
}

/* ==================== the books, held open for one pass ==================== */

// Everything a pass needs from QuickBooks, read once. A hundred orders should
// not be a hundred readings of the item list.
// What the last read of QuickBooks' product list actually contained.
//
// One line, and this whole business would have been over in a minute:
// "QuickBooks handed back 30 products, 0 of them with a SKU" says at a glance
// that the read is broken, where five hundred orders each naming a SKU that
// is sitting in the books says the opposite of what is true. Kept in memory,
// so the screen can show it without asking the database or QuickBooks again.
const lastShelf = { at: null, items: 0, withSku: 0, why: '' };
export function shelfSeen() { return Object.assign({}, lastShelf); }

export async function openBooks(realmId, s) {
  const token = await getAccessToken(realmId);
  const settings = s || await settingsOf(realmId);

  let shelf;
  try {
    shelf = await itemShelf(realmId, token);
  } catch (e) {
    lastShelf.at = new Date().toISOString();
    lastShelf.why = e.message;
    throw e;
  }
  lastShelf.at = new Date().toISOString();
  lastShelf.items = shelf.seen || 0;
  lastShelf.withSku = shelf.skus.size;
  lastShelf.why = '';
  return {
    realmId,
    token,
    items: shelf.ids,                            // name -> id
    desc: shelf.desc,                            // name -> QuickBooks' own words
    asleep: shelf.asleep,                        // sku -> name, switched off
    terms: await loadTerms(realmId, token),
    customers: {},
    skus: shelf.skus,                            // sku -> name
    saved: await getMappings(realmId),
    accounts: standingAccounts(await listAccounts(realmId, token), settings),
    prefs: await salesPrefs(realmId, token),
    made: 0
  };
}

// The item list, read once, three ways round.
//
// It used to be two scans - one for name-to-id, one for sku-to-name - and now
// it is one, because a third thing is wanted from the same rows: the item's own
// sales description. QuickBooks holds the words that belong on an invoice line;
// Shopify's product title is a shop-front name and is not those words. So the
// description comes from here, and the Shopify title is not consulted at all.
//
// PurchaseDesc and PurchaseCost are deliberately not read. They belong on bills
// and purchase orders, and the cost lands in QuickBooks when a PO is entered -
// nothing on an invoice has any business touching either.
async function itemShelf(realmId, token) {
  const ids = {}, desc = {}, skus = new Map(), asleep = new Map();
  let start = 1;
  let seen = 0;
  while (true) {
    // The same read the product pages have always used - readItems() in
    // products.js, the one that reads six thousand items for the big company
    // and matches every SKU without being handed a file.
    //
    // This one used to ask for `Id, Name, Sku, Description, Active` instead,
    // and **the Sku never came back**. Every pass therefore believed that not
    // one product in the books had a SKU. That is the whole of the bug: the
    // log reading "QuickBooks already had Anti Acne Cleanser without a SKU -
    // put SP-21-100 on it" night after night for the same four products, and
    // then, once that behaviour was removed, every order held for a SKU that
    // was sitting in QuickBooks.
    //
    // Two paths asking QuickBooks the same question two different ways is how
    // one of them is wrong for weeks. They ask it the same way now.
    //
    // `Active IN (true, false)` because QuickBooks hands back only the live
    // ones unless both are asked for - and an item somebody switched off is
    // exactly what has to be seen here, so the order can be told that is what
    // happened rather than that its SKU does not exist.
    const q = await qbQuery(realmId, token,
      'SELECT * FROM Item WHERE Active IN (true, false) STARTPOSITION ' +
      start + ' MAXRESULTS 1000');
    const arr = q.Item || [];
    seen += arr.length;
    arr.forEach(i => {
      const key = String(i.Name || '').toLowerCase();
      if (!key) return;
      ids[key] = i.Id;
      desc[key] = String(i.Description || '');
      if (!i.Sku) return;

      const k = String(i.Sku).toLowerCase().trim();
      // An active item always wins. QuickBooks will not put a switched-off
      // item on an invoice, so one is no use here except to explain itself.
      if (i.Active === false) {
        if (!asleep.has(k)) asleep.set(k, i.Name);
      } else {
        skus.set(k, i.Name);
      }
    });
    if (arr.length < 1000) break;
    start += 1000;
    if (start > 9000) break;
  }

  // An empty shelf is a read that failed, not a company with nothing in it.
  // Even a set of books nobody has touched has Services and Hours on it, and
  // a shop writing invoices certainly has items. Believed, this is the worst
  // kind of wrong: every order in the batch gets held, each one naming a SKU
  // that is sitting in QuickBooks, and the merchant goes looking for a
  // problem that is not there. Thrown, openBooks fails, the orders go back in
  // the queue untouched and the reason is on the screen.
  if (!seen) {
    throw new Error('QuickBooks handed back no products at all. Nothing can be ' +
      'matched against an empty list, so no order has been touched. This is ' +
      'almost always the connection rather than the books - try again, and if ' +
      'it lasts, reconnect QuickBooks on the Finance page.');
  }

  // Products came back and not one of them had a SKU. Matching is done on the
  // SKU and nothing else, so every order would be held, each naming a SKU
  // that is sitting in QuickBooks - which is exactly what happened, and it
  // sends somebody looking for a problem that is not in their books. Said
  // once, plainly, instead of five hundred times in the wrong words.
  if (!skus.size) {
    throw new Error('QuickBooks handed back ' + seen + ' products and not one ' +
      'of them carried a SKU. Orders are matched on the SKU and nothing else, ' +
      'so nothing has been touched. If your products do have SKUs, this is the ' +
      'read and not the books.');
  }

  return { ids, desc, skus, asleep, seen };
}

// The item list, read again, once.
//
// A shelf is a photograph taken at the start of a pass: a SKU put on an item
// five minutes ago is not in it. Before an order is held for a SKU nobody can
// find, the list is read once more and the order tried against that.
//
// It is the whole list and not `WHERE Sku = '...'`. That was tried and
// QuickBooks refused it - Sku is not something their query language will
// filter on - and the refusal came back as "QuickBooks would not say whether
// this SKU is there", which is a true sentence and a useless one. A company's
// item list is small; reading it twice in a pass costs almost nothing and
// cannot be refused.
async function freshShelf(books) {
  if (books._reread) return books._reread;

  books._reread = (async () => {
    try {
      const shelf = await itemShelf(books.realmId, books.token);
      books.items = shelf.ids;
      books.desc = shelf.desc;
      books.skus = shelf.skus;
      books.asleep = shelf.asleep;
      return true;
    } catch (e) {
      // Could not be read. That is not proof the SKU is missing, and the
      // order must not be written down as though it were.
      books._rereadWhy = e.message;
      return false;
    }
  })();

  return books._reread;
}

// What QuickBooks itself says this item is. Blank where it says nothing, which
// is exactly what QuickBooks does when somebody picks that item by hand.
export function descOf(books, name) {
  return (books.desc && books.desc[String(name || '').toLowerCase()]) || '';
}

// What a product is in the books, and if it is nothing yet, making it.
//
// The SKU, and only the SKU.
//
// It used to try the name as well when the SKU missed. That is the one thing
// here that could quietly put the wrong product on a real invoice: two products
// called "Serum 30ml" in a shop of four thousand is not unusual, and nobody
// would ever see it happen. The same SKU is used on both sides, so the SKU is
// the answer; anything it does not find is not in the books yet, and is made.
//
// A product with no SKU at all does not go into the books.
//
// It could be matched on its name, and that was what it used to do. But a name
// is not an identity: two products called the same thing become one item, one
// product renamed becomes two, and nobody ever sees either happen. The cure
// takes ten seconds - give it a SKU in Shopify - so the order waits and says
// exactly that, by name, instead of guessing on real books.
async function itemFor(books, line, s, ctx) {
  const sku = String(line.sku || '').toLowerCase().trim();
  const title = String(line.title || '').trim();

  // Somebody said by hand, on the orders page, that this one is something else.
  // Only ever consulted, never required.
  const hand = books.saved[sku || title.toLowerCase()];
  if (hand && hand.skip) return { skip: true };
  if (hand && hand.qbItem && books.items[hand.qbItem.toLowerCase()]) {
    return { name: hand.qbItem };
  }

  if (!sku) {
    return { missing: title || '(a line with no name)', why: 'no SKU in Shopify' };
  }

  // The SKU, and nothing else, decides. Whatever QuickBooks calls that item is
  // what goes on the invoice: the two sides are allowed to call a thing by
  // different names, and the SKU is what says they are the same thing.
  if (books.skus.has(sku)) return { name: books.skus.get(sku) };

  // Not on the shelf. Read the list once more before holding the order: the
  // shelf was taken at the start of the pass, and a SKU put on an item since
  // then is not in it.
  const ok = await freshShelf(books);
  if (ok && books.skus.has(sku)) return { name: books.skus.get(sku) };

  if (!ok) {
    // The list could not be read at all. That is not the same as the SKU
    // being missing, and must not be written down as if it were.
    return {
      missing: line.sku + (title ? ' (' + title + ')' : ''),
      why: 'QuickBooks would not hand over the product list, so this could ' +
           'not be checked',
      unsure: true
    };
  }

  // The SKU is in QuickBooks, on an item that has been switched off. An
  // invoice cannot carry one, and "not on any item" would send somebody
  // looking for something they would never find.
  const off = books.asleep && books.asleep.get(sku);
  if (off) {
    return {
      missing: line.sku + ' (on "' + off + '", which is switched off in QuickBooks)',
      why: 'the item carrying this SKU is inactive in QuickBooks'
    };
  }

  // And where the SKU is on nothing in QuickBooks, we stop.
  //
  // This used to make the item instead. That is how a shop which had renamed a
  // product ended up with two items in the books carrying one SKU: the old one
  // under its old name, and a new one made under the Shopify name - and then
  // the sales went to the new one. Nothing is worth doing that to a real chart
  // of accounts. The order waits, says which SKU it could not find, and goes
  // through the moment that SKU is on the right item in QuickBooks.
  return {
    missing: line.sku + (title ? ' (' + title + ')' : ''),
    why: 'SKU not on any item in QuickBooks'
  };
}

export { itemFor };

/* ==================== is this order the books' business ==================== */

// Pakistan is five hours ahead of the server's clock; an order placed at half
// past nine at night belongs to that day.
function dayOf(ts) {
  if (!ts) return null;
  return new Date(new Date(ts).getTime() + 5 * 3600 * 1000).toISOString().slice(0, 10);
}

// Null means write it. Otherwise: `how` is 'off' when nothing will change that -
// a cancelled order stays cancelled - and 'held' when it might, so it is looked
// at again when the order next moves.
export function whyNot(row, s) {
  if (row.cancelled) return { how: 'off', why: 'cancelled in Shopify' };

  if (s.startFrom) {
    const d = dayOf(row.placed_at);
    if (d && d < s.startFrom) {
      return { how: 'off', why: 'placed before ' + s.startFrom };
    }
  }

  const money = String(row.financial || '').toUpperCase();
  if (s.skipRefunded !== false && (money === 'REFUNDED' || money === 'VOIDED')) {
    return { how: 'off', why: money === 'VOIDED' ? 'voided in Shopify' : 'refunded in full' };
  }

  if (s.onlyFulfilled) {
    const sent = String(row.fulfillment || '').toUpperCase();
    if (sent !== 'FULFILLED') {
      return { how: 'held', why: 'not shipped yet (' + (sent.toLowerCase() || 'unfulfilled') + ')' };
    }
  }

  return null;
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
// One order is written once at a time.
//
// Shopify sends several webhooks for one order within seconds - created,
// updated, paid, fulfilled - and each one calls nudgeOrder, while the sweep
// may have picked the same order up a moment earlier. Nothing stopped them
// running over each other, and the log showed it plainly: the same order
// held three times in the same second, a FAIL with no reason beside an OK for
// the same number, and "written as invoice" followed by "already in
// QuickBooks" one second later. Two passes both found no invoice, both posted
// one, and one of them lost.
//
// The second caller is turned away rather than queued. Whatever it was going
// to do, the one already inside is doing - and the sweep comes round again
// anyway.
const BUSY = new Set();

export async function writeOne(books, row, s) {
  const lock = String(row.realm_id || books.realmId) + ':' + row.order_gid;
  if (BUSY.has(lock)) return 'busy';
  BUSY.add(lock);
  try {
    return await writeOneNow(books, row, s);
  } finally {
    BUSY.delete(lock);
  }
}

async function writeOneNow(books, row, s) {
  const realmId = books.realmId;
  const ctx = { shopId: row.shop_id };

  const no = whyNot(row, s);
  if (no) {
    if (no.how === 'off') {
      await setOff(realmId, row.order_gid, no.why);
      if (row.cancelled) {
        await note(realmId, 'cancelled', {
          shopId: row.shop_id, orderName: row.name, gid: row.order_gid,
          note: 'called off in Shopify, so no invoice was written'
        });
      }
    } else {
      // held, not off: shipping it, or paying for it, will change the answer,
      // and the next webhook about this order asks again
      await setHeld(realmId, row.order_gid, no.why);
    }
    return no.how;
  }

  // what each line is in the books, making what is missing if that is allowed
  const lines = [];
  const missing = [];
  for (const L of (row.lines || [])) {
    if (!L.qty) continue;
    const got = await itemFor(books, L, s, ctx);
    if (got.skip) continue;
    if (got.missing) { missing.push({ what: got.missing, why: got.why }); continue; }
    // the name and the words are QuickBooks'; only the price is Shopify's,
    // because what the buyer was charged is a fact of the sale
    lines.push({ item: got.name, desc: descOf(books, got.name),
                 qty: L.qty, rate: L.rate, amt: L.amt });
  }

  if (missing.length) {
    // Each reason gets its own clause. It used to put every name under the
    // first reason's heading, so an order with one line missing a SKU in
    // Shopify and another whose SKU is not in QuickBooks read as "no SKU in
    // Shopify: A, B, SP-21-100 (Anti Acne Cleanser)" - naming a SKU under the
    // words "no SKU", which sends somebody looking in the wrong place.
    const byWhy = new Map();
    missing.forEach(m => {
      if (!byWhy.has(m.why)) byWhy.set(m.why, []);
      byWhy.get(m.why).push(m.what);
    });

    const why = [...byWhy.entries()].map(([reason, names]) =>
      reason + ': ' + names.slice(0, 5).join(', ') +
      (names.length > 5 ? ' and ' + (names.length - 5) + ' more' : '')
    ).join(' \u00b7 ');

    // A line we could not get an answer about is not a line we know is wrong,
    // so the order is put back in the queue rather than held against somebody.
    const unsure = missing.some(m => m.unsure);
    if (unsure) {
      await setFailed(realmId, row.order_gid, why);
    } else {
      await setHeld(realmId, row.order_gid, why);
    }

    await note(realmId, 'held', {
      shopId: row.shop_id, orderName: row.name, gid: row.order_gid, ok: false,
      note: why, detail: { missing }
    });
    return unsure ? 'failed' : 'held';
  }

  // the invoice itself, in the shape the by-hand path builds too, so the two
  // can never put a different invoice into the books for the same order
  // only for the header - number, customer, dates, address, discount. The lines
  // were worked out above, and delivery is added below, so neither is asked for
  // here or it would go on twice.
  const built = toInvoice(Object.assign({}, row, { lines: row.lines }), {
    match: () => 'placeholder',
    customer: s.customer, prefix: s.prefix, terms: s.terms
  });
  if (built.skip === 'empty') {
    await setOff(realmId, row.order_gid, 'nothing to bill on it');
    return 'off';
  }
  const inv = built.invoice;
  inv.lines = lines;

  if (Number(inv.discount) > 0 && books.prefs && books.prefs.discount === false) {
    await setHeld(realmId, row.order_gid,
      'turn Discount on in QuickBooks: Settings → Account and settings → ' +
      'Sales → Sales form content → Discount');
    await note(realmId, 'held', {
      shopId: row.shop_id, orderName: row.name, gid: row.order_gid, ok: false,
      note: 'it carries a discount of ' + inv.discount + ' and these books have ' +
            'the discount box switched off, so QuickBooks would refuse it'
    });
    return 'held';
  }

  // Nothing left to bill. Asked before delivery is added, or an order whose
  // every product was set aside would go in as an invoice carrying nothing
  // but a free-delivery line at nought.
  if (!inv.lines.length) {
    await setOff(realmId, row.order_gid, 'every line was set aside');
    return 'off';
  }

  // Delivery goes on the invoice whatever it came to, nought included.
  //
  // It used to be `if (ship > 0)`, so an order with free delivery had no
  // delivery line at all and the invoice simply did not mention it. Free
  // delivery is a thing that was promised and given; it belongs on the
  // invoice at 0, the same as it does on the Shopify order, so the two read
  // the same line for line and nobody has to work out which is which.
  //
  // The money case still stops the order: if there is delivery to charge and
  // nothing in QuickBooks to put it on, an invoice that quietly leaves money
  // off is worse than one not yet written. Nought has nothing to lose, so a
  // missing item there is simply no line.
  const ship = Number(row.shipping) || 0;
  {
    const item = await shippingItemFor(books, s, ctx);
    if (!item && ship > 0) {
      await setHeld(realmId, row.order_gid, 'no item in QuickBooks for delivery charges');
      await note(realmId, 'held', {
        shopId: row.shop_id, orderName: row.name, gid: row.order_gid, ok: false,
        note: 'it carries ' + ship + ' of delivery and there is nothing to put it on'
      });
      return 'held';
    }
    if (item) {
      inv.lines.push({
        item,
        desc: ship > 0 ? descOf(books, item) : FREE_DELIVERY,
        qty: 1, rate: ship, amt: ship
      });
    }
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

  // A failure with nothing written against it is not a record of anything.
  // The log had rows reading only "FAIL #9324023" with an empty message, and
  // no way to find out from here what had happened.
  const said = String(out.error || '').trim() ||
    ('QuickBooks refused it and gave no reason' +
     (out.status ? ' (' + out.status + ')' : '') +
     (out.tid ? ', tid=' + out.tid : ''));

  const retry = isRetryable(out.error, out.status);
  if (retry) {
    await setFailed(realmId, row.order_gid, said);
  } else {
    await setHeld(realmId, row.order_gid, said);
  }
  await note(realmId, 'error', {
    shopId: row.shop_id, orderName: row.name, gid: row.order_gid, ok: false,
    note: said,
    detail: { status: out.status, tid: out.tid, willRetry: !!retry }
  });
  return retry ? 'failed' : 'held';
}

// What a delivery line that cost nothing says.
//
// The one line of text Fusion is asked to write for itself, and it is asked
// for on purpose: the item in QuickBooks is called "Default Shipping Product"
// whether the buyer paid for delivery or not, so a free delivery read the
// same as a charged one at a glance. Everything else on an invoice line is
// still QuickBooks' own words.
//
// Only when it came to nothing. A delivery that was charged keeps the
// description QuickBooks holds against the item.
export const FREE_DELIVERY = 'Free Shipping';

/* ==================== the sweep ==================== */

const state = {
  running: false, startedAt: 0, lastAt: null, lastDid: null, note: '',
  everyMs: BUSY_EVERY,
  // Where this pass has got to. "Working through them now" is not an answer
  // to "what is it doing": five hundred orders take half an hour at twenty a
  // minute, and for all of that the only word on the screen was "working".
  // This is the order it is on and how far through the batch it is, kept in
  // memory, so reading it costs no query at all.
  doing: null,
  batch: BATCH
};

// If a pass ever dies in a way that leaves `running` true, every pass after it
// returns at the first line and the writing stops for good - silently, and
// until somebody redeploys. Ten minutes is far longer than any honest pass, so
// past that the flag is treated as wreckage and stepped over.
const STUCK_AFTER = 10 * 60 * 1000;
export function syncState() { return Object.assign({}, state); }

export async function sweep() {
  if (state.running && (Date.now() - state.startedAt) < STUCK_AFTER) return;
  state.running = true;
  state.startedAt = Date.now();
  state.doing = { step: 'looking', total: 0, done: 0, order: '' };
  const did = { done: 0, held: 0, failed: 0, off: 0, items: 0, looked: 0, busy: 0 };

  try {
    const rows = await dueOrders(BATCH);
    did.looked = rows.length;
    state.doing = { step: 'writing', total: rows.length, done: 0, order: '' };
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
        books = await openBooks(realmId, s);
      } catch (e) {
        // The books themselves would not open - signed out, not connected, or
        // QuickBooks is down. Every one of this company's orders goes back in
        // the queue rather than being marked wrong.
        //
        // This used to be the quietest failure in the app: the orders were put
        // back and nothing was counted, so the page said "nothing waiting" over
        // five hundred that were waiting, and no page anywhere said why. It is
        // counted, said once in the log, and carried on the pulse now.
        await failAll(realmId, list.map(r => r.order_gid), e.message);
        did.failed += list.length;
        state.note = e.message;
        if (sayOnce('books:' + realmId + ':' + e.message.slice(0, 60))) {
          await note(realmId, 'error', {
            ok: false,
            note: 'nothing can be written for this company at the moment: ' + e.message
          });
        }
        continue;
      }

      for (const r of list) {
        // named before the attempt, not after: the point is to say which one
        // it is on while it is on it
        if (state.doing) state.doing.order = r.name || r.order_gid || '';
        try {
          const how = await writeOne(books, r, s);
          did[how] = (did[how] || 0) + 1;
        } catch (e) {
          await setFailed(realmId, r.order_gid, e.message);
          did.failed++;
        }
        if (state.doing) state.doing.done++;
      }
      did.items += books.made;
    }
  } catch (e) {
    state.note = e.message;
  } finally {
    // whatever happened in there, this comes off - otherwise the next pass and
    // every pass after it turns round at the door
    state.running = false;
    state.doing = null;
    state.lastAt = new Date().toISOString();
    state.lastDid = did;
  }

  if (!did.failed && !state.note) state.note = '';
  return did;
}

let timer = null;

function schedule(ms) {
  if (timer) clearTimeout(timer);
  state.everyMs = ms;
  timer = setTimeout(tick, ms);
  if (timer.unref) timer.unref();
}

async function tick() {
  let did = null;
  try {
    did = await sweep();
  } catch (e) {
    console.error('shopify sweep:', e.message);
  } finally {
    // the next one is booked whatever just happened. Once this is switched on
    // it does not stop for a failure, a deploy, a page being closed or anything
    // else - only for somebody switching it off.
    const busy = did && (did.done || did.held || did.failed || did.off);
    schedule(busy ? BUSY_EVERY : IDLE_EVERY);
  }
}

// Something has just been put back in the queue - a webhook that could not be
// written, a held order released. Waiting out the idle ten minutes for it would
// be the one time this pacing costs anybody anything.
export function wakeSoon() {
  schedule(3000);
}

export function startShopifySync() {
  tick();
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
  if (!s.on) return 'waiting';   // kept for whenever it is turned on

  try {
    const books = await openBooks(realmId);
    return await writeOne(books, row, s);
  } catch (e) {
    await setFailed(realmId, gid, e.message);
    wakeSoon();
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

// The same rule as itemFor, asked without doing anything about it - what the
// orders page shows before a single invoice is written, so "what will happen"
// and "what happened" can never be two different answers.
export function previewItem(books, line, s) {
  const sku = String(line.sku || '').toLowerCase().trim();
  const title = String(line.title || '').trim();

  const hand = books.saved[sku || title.toLowerCase()];
  if (hand && hand.skip) return { how: 'set aside', item: null, skip: true };
  if (hand && hand.qbItem && books.items[hand.qbItem.toLowerCase()]) {
    return { how: 'matched by hand', item: hand.qbItem };
  }
  if (!sku) return { how: '', item: null, why: 'no SKU in Shopify' };
  if (books.skus.has(sku)) return { how: 'SKU', item: books.skus.get(sku) };

  // the same sentence writeOne would use - the comment above says these two
  // must never be different answers, and a switched-off item is one of them
  const off = books.asleep && books.asleep.get(sku);
  if (off) {
    return { how: '', item: null,
             why: 'the item carrying this SKU, "' + off + '", is switched off ' +
                  'in QuickBooks' };
  }

  return { how: '', item: null, why: 'SKU not on any item in QuickBooks' };
}

// Delivery charged to the buyer is money taken, so it belongs on the invoice.
//
// It used to be left off unless somebody had gone and picked an item for it,
// which meant four invoices went into real books short of their delivery and
// nothing said so. Being quiet about money is the one thing this must not do.
//
// So it is worked out rather than asked for: whatever was chosen, else an item
// the books already have under one of the names everybody uses, else a Service
// item called Shipping, made once and used from then on.
// What has already been said this time round, so the same sentence is not
// written into the log on every single run.
const said = new Set();
function sayOnce(key) {
  if (said.has(key)) return false;
  if (said.size > 5000) said.clear();
  said.add(key);
  return true;
}

const SHIP_NAMES = [
  'Shipping', 'Delivery', 'Shipping Charges', 'Delivery Charges',
  'Shipping Fee', 'Delivery Fee', 'Freight'
];

export async function shippingItemFor(books, s, ctx) {
  if (s.shippingItem && books.items[String(s.shippingItem).toLowerCase()]) {
    return s.shippingItem;
  }
  for (const name of SHIP_NAMES) {
    if (books.items[name.toLowerCase()]) return name;
  }
  // Nothing is invented in these books any more, delivery included. If there is
  // no item for it, the order waits and the item is chosen on the orders page.
  return null;
}
