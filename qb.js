import { getCompany, saveQbTokens, markQbBroken } from './db.js';

const API = 'https://quickbooks.api.intuit.com';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

/* ==================== signing in to the books ==================== */
//
// Intuit hands out a NEW refresh token every time one is used, and kills the
// one before it. So two refreshes running at the same moment is not a slow
// path - it is how a company gets signed out of its own books: the second one
// finishes with a token Intuit has already superseded, and from then on every
// call says "invalid_grant".
//
// Which is exactly what will happen the moment a background sweep runs beside
// somebody working: both reach for a token, both refresh, one of them wins.
//
// Three things stop it:
//
//  1. The access token is kept - in this process and in the companies row - and
//     handed out until it is nearly an hour old. A hundred jobs in a minute are
//     one sign-in, not a hundred.
//  2. Only one refresh per company can be in flight. Everybody else waits on
//     the same promise and gets the same answer.
//  3. When Intuit does refuse, it is written down and left alone for a while.
//     Nothing here can mend a dead refresh token - somebody has to connect the
//     books again - so hammering it every minute only fills the log.

const live = new Map();      // realmId -> { token, until }
const inFlight = new Map();  // realmId -> Promise
const broken = new Map();    // realmId -> { until, why }

// An hour is what Intuit gives; five minutes of it are left spare so a long
// run that started on a good token does not end on a dead one.
const SPARE = 5 * 60 * 1000;
const REST_AFTER_REFUSAL = 10 * 60 * 1000;

const SIGNED_OUT =
  'QuickBooks has signed this company out. Open Finance and press ' +
  '"Connect to QuickBooks" to sign in again - nothing is lost, and ' +
  'everything waiting will go through once it is back.';

export function forgetToken(realmId) {
  live.delete(realmId);
  broken.delete(realmId);
}

export async function getAccessToken(realmId, force) {
  const now = Date.now();

  if (!force) {
    const have = live.get(realmId);
    if (have && have.until > now) return have.token;
  }

  const sore = broken.get(realmId);
  if (sore && sore.until > now) throw new Error(SIGNED_OUT);

  const going = inFlight.get(realmId);
  if (going) return going;

  const p = signIn(realmId, force).finally(() => inFlight.delete(realmId));
  inFlight.set(realmId, p);
  return p;
}

async function signIn(realmId, force) {
  const company = await getCompany(realmId);
  if (!company) throw new Error('Company not connected');

  // A company made at sign-up has everything but books. Asking QuickBooks about
  // it is not an error in the run that got here - it is a thing that has not been
  // set up yet - so it says so in the words the person needs to act on.
  if (!company.refresh_token) {
    throw new Error('QuickBooks is not connected to this company yet. ' +
      'Open Finance and connect it, then run this again.');
  }

  // Somebody else - another process, or this one before a restart - may have
  // signed in minutes ago. Theirs is as good as ours.
  if (!force && company.access_token && company.access_expires) {
    const until = new Date(company.access_expires).getTime() - SPARE;
    if (until > Date.now()) {
      live.set(realmId, { token: company.access_token, until });
      return company.access_token;
    }
  }

  const basic = Buffer.from(
    `${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + basic,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: company.refresh_token
    })
  });

  const data = await res.json().catch(() => ({}));

  if (!data.access_token) {
    const why = String(data.error || '') + ' ' + String(data.error_description || '');
    // invalid_grant is the one that cannot be waited out
    if (/invalid_grant/i.test(why)) {
      broken.set(realmId, { until: Date.now() + REST_AFTER_REFUSAL, why });
      live.delete(realmId);
      try { await markQbBroken(realmId, why.trim()); } catch (e) { /* saying so is enough */ }
      throw new Error(SIGNED_OUT);
    }
    throw new Error('QuickBooks would not sign us in: ' + why.trim());
  }

  // Both at once, in one write: the new refresh token Intuit just handed us
  // (losing it is the other way a company gets signed out) and the access token
  // so nobody has to ask again for an hour.
  const life = (Number(data.expires_in) || 3600) * 1000;
  const expires = new Date(Date.now() + life);
  try {
    await saveQbTokens(realmId, {
      access: data.access_token,
      expires,
      refresh: data.refresh_token && data.refresh_token !== company.refresh_token
        ? data.refresh_token : null
    });
  } catch (e) {
    // the token is good even if writing it down failed; the next restart will
    // simply sign in again
  }

  broken.delete(realmId);
  live.set(realmId, { token: data.access_token, until: Date.now() + life - SPARE });
  return data.access_token;
}

function tidOf(res) {
  return res.headers.get('intuit_tid') || '';
}

async function qbFetch(url, token, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
}

export async function qbQuery(realmId, token, sql) {
  const url = `${API}/v3/company/${realmId}/query?query=${encodeURIComponent(sql)}&minorversion=70`;
  const res = await qbFetch(url, token);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Query failed (${res.status}) tid=${tidOf(res)}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.QueryResponse || {};
}

export async function getCompanyInfo(realmId, token) {
  const url = `${API}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=70`;
  const res = await qbFetch(url, token);
  if (!res.ok) throw new Error('CompanyInfo failed: ' + res.status);
  const json = await res.json();
  return json.CompanyInfo;
}

export async function loadItems(realmId, token) {
  const map = {};
  let start = 1;
  while (true) {
    const q = await qbQuery(realmId, token,
      `SELECT Id, Name FROM Item STARTPOSITION ${start} MAXRESULTS 1000`);
    const arr = q.Item || [];
    arr.forEach(i => { map[i.Name.toLowerCase()] = i.Id; });
    if (arr.length < 1000) break;
    start += 1000;
  }
  return map;
}

export async function loadTerms(realmId, token) {
  const map = {};
  const q = await qbQuery(realmId, token, 'SELECT Id, Name FROM Term MAXRESULTS 200');
  (q.Term || []).forEach(t => { map[t.Name.toLowerCase()] = t.Id; });
  return map;
}

export async function getOrCreateCustomer(realmId, token, name, cache) {
  const key = name.toLowerCase();
  if (cache[key]) return cache[key];

  const esc = name.replace(/'/g, "\\'");
  const q = await qbQuery(realmId, token,
    `SELECT Id, DisplayName FROM Customer WHERE DisplayName = '${esc}'`);

  if (q.Customer && q.Customer.length) {
    cache[key] = q.Customer[0].Id;
    return cache[key];
  }

  const res = await qbFetch(
    `${API}/v3/company/${realmId}/customer?minorversion=70`,
    token,
    { method: 'POST', body: JSON.stringify({ DisplayName: name }) }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Customer create failed tid=${tidOf(res)}: ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  cache[key] = json.Customer.Id;
  return cache[key];
}

export async function postInvoice(realmId, token, payload) {
  const res = await qbFetch(
    `${API}/v3/company/${realmId}/invoice?minorversion=70`,
    token,
    { method: 'POST', body: JSON.stringify(payload) }
  );

  const tid = tidOf(res);

  if (res.ok) {
    const json = await res.json();
    return { ok: true, id: json.Invoice.Id, tid };
  }

  const text = await res.text();
  let msg = text.slice(0, 400);
  try {
    const fault = JSON.parse(text).Fault;
    if (fault && fault.Error && fault.Error.length) {
      msg = `${fault.Error[0].Message} | ${fault.Error[0].Detail || ''}`;
    }
  } catch (e) { /* keep raw */ }

  return {
    ok: false,
    status: res.status,
    msg,
    tid,
    retryable: isRetryable(msg, res.status)
  };
}

export function isRetryable(msg, status) {
  if (status === 429 || status >= 500) return true;
  return /another user was creating|try again|deadlock|timeout|throttl/i.test(msg);
}
// Send up to 30 invoices in one request. QuickBooks still writes them one
// after another, but the network trip happens once instead of thirty times.
export async function postInvoiceBatch(realmId, token, payloads) {
  const body = {
    BatchItemRequest: payloads.map((p, i) => ({
      bId: String(i),
      operation: 'create',
      Invoice: p
    }))
  };

  const res = await qbFetch(
    `${API}/v3/company/${realmId}/batch?minorversion=70`,
    token,
    { method: 'POST', body: JSON.stringify(body) }
  );

  const tid = tidOf(res);

  // the whole batch was refused - hand the same verdict back for every line
  if (!res.ok) {
    const text = await res.text();
    let msg = text.slice(0, 300);
    try {
      const f = JSON.parse(text).Fault;
      if (f && f.Error && f.Error.length) {
        msg = `${f.Error[0].Message} | ${f.Error[0].Detail || ''}`;
      }
    } catch (e) {}
    return payloads.map((p, i) => ({
      index: i,
      ok: false,
      status: res.status,
      msg,
      tid,
      retryable: isRetryable(msg, res.status)
    }));
  }

  const json = await res.json();
  const list = json.BatchItemResponse || [];
  const out = payloads.map((p, i) => ({
    index: i,
    ok: false,
    status: 0,
    msg: 'QuickBooks sent no answer for this invoice',
    tid,
    retryable: true
  }));

  list.forEach(item => {
    const i = Number(item.bId);
    if (isNaN(i) || i < 0 || i >= out.length) return;

    if (item.Invoice && item.Invoice.Id) {
      out[i] = { index: i, ok: true, id: item.Invoice.Id, tid };
      return;
    }

    let msg = 'Unknown error';
    let status = 400;
    if (item.Fault && item.Fault.Error && item.Fault.Error.length) {
      const e = item.Fault.Error[0];
      msg = `${e.Message || ''} | ${e.Detail || ''}`.trim();
      if (e.code) status = Number(e.code) || 400;
    }

    out[i] = {
      index: i,
      ok: false,
      status,
      msg,
      tid,
      retryable: isRetryable(msg, status)
    };
  });

  return out;
}

// QuickBooks' own reports, read as they come. The books hold things a query
// cannot reach - what a sale cost, what stock is worth - and those only come out
// of a report. Read-only: a report is asked for, nothing is written.
export async function qbReport(realmId, token, name, params = {}) {
  const q = new URLSearchParams({ minorversion: '70' });
  Object.keys(params).forEach(k => {
    if (params[k] !== undefined && params[k] !== null && params[k] !== '') q.set(k, params[k]);
  });

  const url = `${API}/v3/company/${realmId}/reports/${name}?${q}`;
  const res = await qbFetch(url, token);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Report ${name} failed (${res.status}) tid=${tidOf(res)}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Report ${name} came back unreadable: ${text.slice(0, 200)}`);
  }
}

// The same query, for the reads where an empty answer has to mean empty.
//
// QuickBooks does not always fail with a failing status. Throttled, or asked
// something it will not answer, it can come back 200 with a Fault in the body and
// no QueryResponse at all - and qbQuery hands that on as an empty list. For a
// scan of the books that is the worst answer there is: "0 transactions read" in
// green, over seventeen months, with the real reason thrown away. This says the
// reason instead. qbQuery itself is left as it is, because every other page in
// the app already leans on how it behaves.
export async function qbQueryStrict(realmId, token, sql) {
  const url = `${API}/v3/company/${realmId}/query?query=${encodeURIComponent(sql)}&minorversion=70`;
  const res = await qbFetch(url, token);
  const text = await res.text();

  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* said below */ }

  const fault = json && json.Fault && ((json.Fault.Error || [])[0] || {});
  if (!res.ok || fault || !json) {
    const why = fault
      ? (fault.Message || 'QuickBooks refused the read') + (fault.Detail ? ' - ' + fault.Detail : '')
      : text.slice(0, 300);
    throw new Error(`Query failed (${res.status}) tid=${tidOf(res)}: ${why}`);
  }

  if (!json.QueryResponse) {
    throw new Error(`QuickBooks answered without a result (${res.status}) tid=${tidOf(res)}`);
  }
  return json.QueryResponse;
}

/* ==================== accounts and items ==================== */
// Needed by anything that has to make an item rather than only find one. A
// product that turned up on Shopify this morning has no item in the books yet,
// and an invoice cannot name what does not exist.

export async function listAccounts(realmId, token) {
  const out = [];
  let start = 1;
  while (true) {
    const q = await qbQuery(realmId, token,
      'SELECT Id, Name, AccountType, AccountSubType, Classification, Active ' +
      'FROM Account STARTPOSITION ' + start + ' MAXRESULTS 1000');
    const arr = q.Account || [];
    arr.forEach(a => {
      if (a.Active === false) return;
      out.push({
        id: a.Id, name: a.Name, type: a.AccountType,
        sub: a.AccountSubType || '', group: a.Classification || ''
      });
    });
    if (arr.length < 1000) break;
    start += 1000;
    if (start > 9000) break;
  }
  return out;
}

// One item, made the way QuickBooks wants it for its kind. Inventory needs
// three accounts and a date it started being counted; the other two kinds need
// only where the money lands. Getting that wrong is the usual reason a created
// item is refused.
export async function createItem(realmId, token, item) {
  const kind = String(item.type || 'NonInventory');
  const body = {
    Name: String(item.name || '').slice(0, 100),
    Type: kind,
    IncomeAccountRef: { value: String(item.incomeAccount) }
  };
  if (item.sku) body.Sku = String(item.sku).slice(0, 100);
  if (item.description) body.Description = String(item.description).slice(0, 4000);
  if (item.price != null) body.UnitPrice = Number(item.price) || 0;
  // What it cost, when the shop knows - so the first sale does not work its
  // cost of sales out of nothing.
  if (item.cost) body.PurchaseCost = Number(item.cost) || 0;

  if (kind === 'Inventory') {
    body.TrackQtyOnHand = true;
    body.QtyOnHand = Number(item.qty) || 0;
    body.InvStartDate = item.startDate || new Date().toISOString().slice(0, 10);
    body.AssetAccountRef = { value: String(item.assetAccount) };
    body.ExpenseAccountRef = { value: String(item.cogsAccount) };
  }

  const res = await qbFetch(
    `${API}/v3/company/${realmId}/item?minorversion=70`,
    token,
    { method: 'POST', body: JSON.stringify(body) }
  );

  if (res.ok) {
    const json = await res.json();
    return { ok: true, id: json.Item.Id, name: json.Item.Name, sku: json.Item.Sku || '' };
  }

  const text = await res.text();
  let msg = text.slice(0, 400);
  try {
    const fault = JSON.parse(text).Fault;
    if (fault && fault.Error && fault.Error.length) {
      msg = `${fault.Error[0].Message} | ${fault.Error[0].Detail || ''}`;
    }
  } catch (e) { /* keep raw */ }

  return { ok: false, error: msg, status: res.status, tid: tidOf(res) };
}

// The one order the webhook nudged us about, read back from Shopify's own API
// rather than believed out of the call's body - see hooks in shopifysync.js.
export async function findInvoiceByNumber(realmId, token, docNumber) {
  const safe = String(docNumber).replace(/'/g, "''");
  const q = await qbQuery(realmId, token,
    `SELECT Id, DocNumber, TxnDate, TotalAmt, SyncToken FROM Invoice ` +
    `WHERE DocNumber = '${safe}' MAXRESULTS 5`);
  const arr = q.Invoice || [];
  return arr.length ? arr[0] : null;
}

// Put a SKU on an item that has none.
//
// Not a sparse update. QuickBooks accepts a sparse Item update carrying only a
// SKU and then does nothing with it - the field never lands, nothing complains,
// and the next run finds the item unchanged and tries again, for ever. So the
// whole item is read back and written whole, with the SKU added.
export async function setItemSku(realmId, token, item, sku) {
  const q = await qbQuery(realmId, token,
    "SELECT * FROM Item WHERE Id = '" + String(item.Id).replace(/'/g, "''") + "'");
  const full = (q.Item || [])[0];
  if (!full) return { ok: false, error: 'that item is no longer in QuickBooks' };
  if (full.Sku) return { ok: true, already: true };

  const body = Object.assign({}, full, { Sku: String(sku).slice(0, 100) });
  delete body.MetaData;

  const res = await qbFetch(
    `${API}/v3/company/${realmId}/item?minorversion=70`,
    token,
    { method: 'POST', body: JSON.stringify(body) }
  );

  if (res.ok) {
    const back = await res.json().catch(() => null);
    // believed only if QuickBooks hands it back on the item
    if (back && back.Item && back.Item.Sku) return { ok: true };
    return { ok: false, error: 'QuickBooks took the update but did not keep the SKU' };
  }

  const text = await res.text();
  let msg = text.slice(0, 300);
  try {
    const f = JSON.parse(text).Fault;
    if (f && f.Error && f.Error.length) msg = `${f.Error[0].Message} | ${f.Error[0].Detail || ''}`;
  } catch (e) { /* keep raw */ }
  return { ok: false, error: msg };
}

// Whether these books allow a discount under the subtotal at all.
//
// It is off until somebody turns it on in Settings, and with it off QuickBooks
// refuses any invoice carrying a discount line - so an order with a discount on
// it would fail, over and over, with a message about preferences that nobody
// would connect to a Shopify order. Asked once per run instead.
export async function salesPrefs(realmId, token) {
  try {
    const q = await qbQuery(realmId, token, 'SELECT * FROM Preferences');
    const p = (q.Preferences || [])[0] || {};
    const sales = p.SalesFormsPrefs || {};
    return {
      discount: sales.AllowDiscount === true,
      shipping: sales.AllowShipping === true,
      deposit: sales.AllowDeposit === true
    };
  } catch (e) {
    // not knowing is not a reason to stop; QuickBooks will say so if it minds
    return { discount: true, shipping: true, deposit: true, unknown: true };
  }
}

/* ==================== putting things back ==================== */

// Delete an invoice outright. QuickBooks wants the SyncToken with it, so the
// invoice is read first - and if it is already gone, that is not a failure,
// it is the thing we were trying to achieve.
export async function deleteInvoice(realmId, token, id) {
  const q = await qbQuery(realmId, token,
    "SELECT Id, SyncToken, DocNumber FROM Invoice WHERE Id = '" +
    String(id).replace(/'/g, "''") + "'");
  const inv = (q.Invoice || [])[0];
  if (!inv) return { ok: true, gone: true };

  const res = await qbFetch(
    `${API}/v3/company/${realmId}/invoice?operation=delete&minorversion=70`,
    token,
    { method: 'POST', body: JSON.stringify({ Id: inv.Id, SyncToken: inv.SyncToken }) }
  );
  if (res.ok) return { ok: true, docNumber: inv.DocNumber };

  const text = await res.text();
  let msg = text.slice(0, 300);
  try {
    const f = JSON.parse(text).Fault;
    if (f && f.Error && f.Error.length) msg = `${f.Error[0].Message} | ${f.Error[0].Detail || ''}`;
  } catch (e) { /* keep raw */ }
  return { ok: false, error: msg };
}

// Merge one item into another, which in QuickBooks is done by giving it the
// other one's name: the two become one and the transactions go with it. There
// is no "merge" call - this is the mechanism QuickBooks itself uses.
export async function mergeItem(realmId, token, fromId, intoName) {
  const q = await qbQuery(realmId, token,
    "SELECT * FROM Item WHERE Id = '" + String(fromId).replace(/'/g, "''") + "'");
  const item = (q.Item || [])[0];
  if (!item) return { ok: true, gone: true };

  const body = Object.assign({}, item, { Name: String(intoName).slice(0, 100) });
  delete body.MetaData;

  const res = await qbFetch(
    `${API}/v3/company/${realmId}/item?minorversion=70`,
    token,
    { method: 'POST', body: JSON.stringify(body) }
  );
  if (res.ok) return { ok: true };

  const text = await res.text();
  let msg = text.slice(0, 300);
  try {
    const f = JSON.parse(text).Fault;
    if (f && f.Error && f.Error.length) msg = `${f.Error[0].Message} | ${f.Error[0].Detail || ''}`;
  } catch (e) { /* keep raw */ }
  return { ok: false, error: msg };
}

// When merging is refused - QuickBooks will not merge an item that stock has
// moved through - putting it out of use is the next best thing, so it stops
// turning up on invoices and in lists.
export async function retireItem(realmId, token, id) {
  const q = await qbQuery(realmId, token,
    "SELECT * FROM Item WHERE Id = '" + String(id).replace(/'/g, "''") + "'");
  const item = (q.Item || [])[0];
  if (!item) return { ok: true, gone: true };

  const body = Object.assign({}, item, { Active: false });
  delete body.MetaData;

  const res = await qbFetch(
    `${API}/v3/company/${realmId}/item?minorversion=70`,
    token,
    { method: 'POST', body: JSON.stringify(body) }
  );
  if (res.ok) return { ok: true };
  const text = await res.text();
  return { ok: false, error: text.slice(0, 300) };
}

// Why mergeItem above cannot be the answer, and what is.
//
// QuickBooks does merge by rename - but only for the entities it lists for it:
// accounts, classes, customers, departments, employees, locations, terms and
// vendors. Products and services are **not** on that list. Renaming an item to
// another item's name is therefore not a merge; it is a duplicate name, and
// QuickBooks answers exactly that:
//
//   "Duplicate Name Exists Error | The name supplied already exists."
//
// There is no call that moves an item's history onto another item. Only the
// QuickBooks website can do that, by hand, one product at a time.
//
// So this does the thing that can be done, and is what was wanted anyway once
// the invoices are deleted: the duplicate carries nothing any more, so it is
// taken out of the way and the old product is left holding the SKU alone.
//
//   1. if the old product has no SKU, the SKU is moved onto it first - a SKU on
//      no item is how this whole mess started
//   2. the duplicate's SKU is cleared, so nothing can ever match it again
//   3. its name is parked, so the name is free for the old product
//   4. it is made inactive, so it is off every list and every dropdown
//
// Nothing of the old product is touched beyond possibly gaining the SKU.
export async function foldItem(realmId, token, fromId, intoName) {
  const dupQ = await qbQuery(realmId, token,
    "SELECT * FROM Item WHERE Id = '" + String(fromId).replace(/'/g, "''") + "'");
  const dup = (dupQ.Item || [])[0];
  if (!dup) return { ok: true, gone: true };

  const sku = String(dup.Sku || '').trim();
  const steps = [];

  // 1. the old product, and the SKU it may be missing
  let keep = null;
  if (intoName) {
    const kQ = await qbQuery(realmId, token,
      "SELECT * FROM Item WHERE Name = '" + String(intoName).replace(/'/g, "''") + "'");
    keep = (kQ.Item || []).find(i => String(i.Id) !== String(dup.Id)) || null;
    if (!keep) return { ok: false, error: 'no product called "' + intoName + '" in QuickBooks' };

    if (sku && !String(keep.Sku || '').trim()) {
      const moved = await setItemSku(realmId, token, keep, sku);
      if (!moved.ok) return { ok: false, error: 'could not put the SKU on ' + intoName + ': ' + moved.error };
      steps.push('SKU ' + sku + ' put on ' + intoName);
    }
  }

  // 2-4. park the duplicate, in one write
  const parked = (String(dup.Name || 'item') + ' (duplicate ' + dup.Id + ')').slice(0, 100);
  const body = Object.assign({}, dup, { Name: parked, Active: false });
  delete body.MetaData;
  delete body.Sku;              // a full update clears what it does not carry

  const res = await qbFetch(
    `${API}/v3/company/${realmId}/item?minorversion=70`,
    token,
    { method: 'POST', body: JSON.stringify(body) }
  );

  if (!res.ok) {
    const text = await res.text();
    let msg = text.slice(0, 300);
    try {
      const f = JSON.parse(text).Fault;
      if (f && f.Error && f.Error.length) msg = `${f.Error[0].Message} | ${f.Error[0].Detail || ''}`;
    } catch (e) { /* keep raw */ }
    return { ok: false, error: msg, steps };
  }

  const back = await res.json().catch(() => null);
  const left = back && back.Item ? String(back.Item.Sku || '').trim() : '';
  if (left) {
    // it kept the SKU after all - say so, rather than leaving two items on one
    // SKU and calling it done
    return { ok: false, error: 'the duplicate was retired but QuickBooks kept its SKU (' + left + ')', steps };
  }

  steps.push('retired as "' + parked + '"');
  return { ok: true, steps, keptBy: intoName || '' };
}
