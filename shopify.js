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

import { pool } from './db.js';
import { encrypt, decrypt } from './secrets.js';

// Shopify dates a version every quarter and supports each for a year. Pinned
// rather than "latest" so a release cannot change what the app reads underneath
// it; SHOPIFY_API_VERSION on the server moves it on.
export const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-01';

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
}

/* ==================== the shops ==================== */

// A shop domain is typed by a person, so it arrives in every shape there is -
// with https, with a trailing slash, with the admin path still on it.
export function cleanDomain(raw) {
  let s = String(raw || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\s+/g, '');
  if (!s) throw new Error('Type your shop address, like your-shop.myshopify.com');
  if (s.indexOf('.') < 0) s += '.myshopify.com';
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) {
    throw new Error('That is not a myshopify.com address. Use the one in Shopify > Settings > Domains, ending .myshopify.com');
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
        }
      }
    }
  }
}`;

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

function addressOf(o) {
  const a = o.shippingAddress || o.billingAddress;
  if (!a) return [];
  return [
    a.name,
    a.address1,
    a.address2,
    [a.city, a.province].filter(Boolean).join(', '),
    [a.country, a.phone].filter(Boolean).join(' · ')
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
    const d = await ask(shop.domain, token, ORDERS_QUERY, { q, cursor });
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
    return {
      sku: String(L.sku || '').trim(),
      title: String(L.title || '').trim(),
      qty,
      rate,
      amt: money(rate * qty)
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
       JOIN shopify_shops s ON s.id = o.shop_id
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
    lines.push({
      item,
      desc: o.keepTitles === false ? '' : (L.title || ''),
      qty: L.qty,
      rate: L.rate,
      amt: L.amt
    });
  });

  // Delivery charged to the buyer is money taken, so it belongs on the invoice -
  // but only once somebody has said which QuickBooks item it is. Left unsaid it
  // is dropped rather than guessed at.
  const ship = money(order.shipping);
  if (ship > 0 && o.shippingItem) {
    lines.push({ item: o.shippingItem, desc: 'Delivery', qty: 1, rate: ship, amt: ship });
  }

  if (missing.length) return { skip: 'unmatched', missing, order };
  if (!lines.length)  return { skip: 'empty', order };

  return {
    invoice: {
      docNumber: (o.prefix || '') + (order.number || String(order.name || '').replace(/[^0-9]/g, '')),
      customer: customerName(o.customer, order.placed_at),
      txnDate: date,
      dueDate: date,
      terms: o.terms || '',
      memo: [order.name, order.city].filter(Boolean).join(' · '),
      billTo: Array.isArray(order.bill_to) ? order.bill_to : [],
      discount: money(order.discount),
      lines
    },
    gid: order.order_gid
  };
}
