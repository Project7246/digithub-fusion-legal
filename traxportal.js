// The Trax merchant portal at sonic.pk, which is not the same thing as the
// Sonic API in trax.js.
//
//   trax.js       one API key, an Authorization header, and twenty-seven calls
//                 every one of which is about a tracking number you already
//                 hold. There is no call that takes a span of days.
//   this file     the portal's own sign-in, and the lists its screens are
//                 built from - which do take a span of days.
//
// That difference is the whole reason this file exists. A Trax account could
// only ever know what its webhooks had told it since the day they were
// switched on, so an account connected this morning had no past at all: how
// many parcels were booked, how many the courier never picked up, how many
// were picked up and never delivered - none of it could be asked for. The
// payment route (`/invoice`, in traxlive.js) answers only for parcels that
// were delivered **and paid**, which is the half of the question that was
// never the hard half.
//
// The portal's Reports -> Summary screen is built on one endpoint:
//
//   GET /cod/reports/summary/list?search_user=&search_date_from=&search_date_to=
//
// It is a DataTables feed, so it answers in JSON, it pages, and it carries
// everything the parcel tabs here need - the booking date, the date the rider
// actually picked it up (empty when nobody did), every delivery attempt, the
// courier's own status wording, the COD and the charges.
//
// Two things to keep in mind about it, both the same kind of thing:
//
// **This is not Trax's documented API.** It is the address the portal's own
// screens call, read off the portal while signed in. If Trax change their
// front end these calls change with it, and this file is where that is fixed.
// PostEx is in exactly the same position (postexportal.js) and has held.
//
// **It goes through the relay like everything else at sonic.pk.** The host
// answers from a PTCL address inside Pakistan and this app is hosted in
// Bangalore, so the direct route times out - see wire.js. The one thing this
// file needs that the API calls do not is the **cookie** the portal sets at
// sign-in, so it talks to the relay itself rather than through `call()`,
// which reads a body and throws the headers away.

import { relayed, relayHeaders, plainly } from './wire.js';
import { num, day, byWords } from './statuses.js';

// Which bucket one of their words belongs in is **Trax's dialect, not this
// file's**, so trax.js hands its own grouper over (`portal.groupOf = groupOf`,
// at the foot of that file) rather than this file importing it. The two files
// would otherwise import each other, and a cycle like that works right up
// until something loads them in the other order - which is a bug that turns up
// weeks later, as "Cannot access 'portal' before initialization" on a boot
// nobody changed. byWords is the same reader every unknown status gets.

const BASE = (process.env.TRAX_PORTAL_BASE || 'https://sonic.pk').replace(/\/+$/, '');

// The relay's own curl gives up at 25 seconds, so nothing here may be allowed
// to ask for more than fits inside that. 500 parcels come back in about three.
const TIMEOUT = Math.max(5, Number(process.env.TRAX_PORTAL_TIMEOUT_SECONDS) || 22) * 1000;
export const PAGE = Math.min(1000, Math.max(50, Number(process.env.TRAX_PORTAL_PAGE) || 500));

// Laravel's session lasts two hours by default. Signing in again costs two
// calls, so this errs well short of it rather than finding out the hard way in
// the middle of a month's import.
const SESSION_MS = Math.max(5, Number(process.env.TRAX_PORTAL_MINUTES) || 75) * 60 * 1000;

/* ==================== the call ==================== */

// Everything about this is ordinary except that the answer's headers are kept:
// the portal signs us in by setting a cookie, and a reader that only returns
// the body cannot see it.
async function raw(path, { method, jar, form, query, ajax } = {}) {
  const url = new URL(BASE + path);
  Object.keys(query || {}).forEach(k => {
    const v = query[k];
    if (v === undefined || v === null) return;
    url.searchParams.set(k, v);
  });

  let to = url.toString();
  const headers = {
    'Accept': ajax ? 'application/json, text/javascript, */*; q=0.01' : 'text/html,*/*',
    'User-Agent': 'Mozilla/5.0 (compatible; Fusion/1.0)'
  };
  if (ajax) headers['X-Requested-With'] = 'XMLHttpRequest';

  const cookie = jarString(jar);
  if (cookie) headers['Cookie'] = cookie;

  let body;
  if (form) {
    body = new URLSearchParams(form).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  const through = relayed(to);
  if (through) {
    to = through;
    Object.assign(headers, relayHeaders());
  }

  const ctl = new AbortController();
  const bell = setTimeout(() => ctl.abort(), TIMEOUT);

  let r, text;
  try {
    r = await fetch(to, {
      method: method || 'GET',
      headers,
      body,
      // A sign-in that worked answers 302. Followed, that redirect would be
      // another page and the one thing we came for - the cookie - would be
      // behind us, so the redirect is read rather than taken.
      redirect: 'manual',
      signal: ctl.signal
    });

    absorb(jar, r);
    text = await r.text();
  } catch (e) {
    // Only the call itself failing lands here. What the portal or the relay
    // *said* is read below, where it can be said back in their own words.
    throw new Error('The Trax portal could not be reached: ' + plainly(e) +
      (through ? ' (through the relay)' : ''));
  } finally {
    clearTimeout(bell);
  }

  {
    // The relay answers for itself in four cases, and every one of them is a
    // perfectly good HTTP response - so they are told apart here rather than
    // being read as the portal refusing us. A 401 from the relay followed by
    // "your sign-in has expired" would send somebody to change a password
    // that was never the problem.
    if (through) {
      if (r.status === 401 && /relay|"no"/i.test(text)) {
        throw new Error('The relay refused our key - COURIER_RELAY_KEY here and ' +
          'the key inside the relay file are not the same string');
      }
      if (r.status === 403 && /host/i.test(text)) {
        throw new Error('The relay will not forward to sonic.pk - its own allowed ' +
          'list does not name that host');
      }
      if (r.status === 500 && /no key set/i.test(text)) {
        throw new Error('The relay file has no key in it yet, so it refuses everything');
      }
      if (r.status === 502 && /could not reach/i.test(text)) {
        throw new Error('The relay answers, but it cannot see sonic.pk either: ' +
          text.replace(/<[^>]*>/g, ' ').trim().slice(0, 160));
      }
    }
  }

  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = null; }

  return {
    status: r.status,
    location: r.headers.get('location') || '',
    json,
    text
  };
}

/* ---------- cookies, by hand ---------- */
//
// A jar is a plain Map of name to value. Nothing here cares what is in them -
// the portal sets a session cookie and an XSRF cookie and renames the session
// one the moment you sign in, which is exactly why they are kept as they come
// rather than being looked for by name.

function jarString(jar) {
  if (!jar || !jar.size) return '';
  return [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ');
}

function absorb(jar, r) {
  if (!jar) return;
  const list = typeof r.headers.getSetCookie === 'function'
    ? r.headers.getSetCookie()
    : [r.headers.get('set-cookie')].filter(Boolean);

  list.forEach(line => {
    const first = String(line).split(';')[0];
    const at = first.indexOf('=');
    if (at < 1) return;
    const name = first.slice(0, at).trim();
    const value = first.slice(at + 1).trim();
    if (!name) return;
    // An expiry in the past is the portal taking a cookie off us.
    if (!value || /expires=Thu, 01 Jan 1970/i.test(line)) jar.delete(name);
    else jar.set(name, value);
  });
}

/* ==================== signing in ==================== */

// Laravel will not take a form without the token on the page it was drawn on,
// and the token is tied to the session cookie that came with that page - so
// the login page is read first, every time, and both are carried into the POST.
function tokenFrom(html) {
  const s = String(html || '');
  let m = s.match(/name=["']_token["'][^>]*value=["']([^"']+)["']/i);
  if (m) return m[1];
  m = s.match(/value=["']([^"']+)["'][^>]*name=["']_token["']/i);
  if (m) return m[1];
  m = s.match(/name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i);
  return m ? m[1] : '';
}

// Whether what came back is the portal saying "you are not signed in". It says
// it by sending us back to the login page, whatever we asked for.
function sentToLogin(answer) {
  if (answer.status === 302 || answer.status === 301) {
    return /\/cod\/login/i.test(answer.location || '');
  }
  if (answer.status === 200 && !answer.json) {
    return /name=["']_token["']/i.test(answer.text) && /\/cod\/login/i.test(answer.text);
  }
  return answer.status === 401 || answer.status === 419;
}

export async function signIn(email, password) {
  const jar = new Map();

  const page = await raw('/cod/login', { jar });
  const token = tokenFrom(page.text);
  if (!token) {
    throw new Error('The Trax portal did not hand over a sign-in form. ' +
      'Either sonic.pk is down or the sign-in page has moved.');
  }

  const posted = await raw('/cod/login', {
    jar,
    method: 'POST',
    form: { _token: token, email: String(email || '').trim(), password: String(password || '') }
  });

  // It answers 302 either way: to the welcome screen when it worked, back to
  // the login page when it did not. Nothing is read out of the body, because
  // the body of a redirect is empty.
  const ok = (posted.status === 302 || posted.status === 303) &&
             !/\/cod\/login/i.test(posted.location || '');
  if (!ok) {
    if (posted.status === 429) {
      throw new Error('Trax has blocked sign-ins for a few minutes - too many tries');
    }
    throw new Error('Trax did not accept that email and password');
  }

  const shippers = await readShippers(jar);
  return { jar, shippers, at: Date.now() };
}

// Who this sign-in can see. The Summary screen's own dropdown is the list, and
// for an ordinary merchant login it holds exactly one - themselves.
async function readShippers(jar) {
  const page = await raw('/cod/reports/summary', { jar });
  const block = String(page.text).match(/<select[^>]*name=["']search_user["'][^>]*>([\s\S]*?)<\/select>/i);
  if (!block) return [];

  const out = [];
  const re = /<option[^>]*value=["'](\d+)["'][^>]*>([\s\S]*?)<\/option>/gi;
  let m;
  while ((m = re.exec(block[1]))) {
    out.push({ id: m[1], name: m[2].replace(/<[^>]*>/g, '').trim() });
  }
  return out;
}

/* ==================== the session, kept ==================== */
//
// One signed-in session per courier account, in memory. It is not worth a
// database row: a restart signs in again, which is two calls, and a session
// that has gone stale on their side would be remembered wrongly for ever.

const live = new Map();

export function forget(accountId) {
  live.delete(Number(accountId));
}

export async function sessionFor(accountId, email, password) {
  const id = Number(accountId);
  const held = live.get(id);
  if (held && Date.now() - held.at < SESSION_MS) return held;

  // The sign-in is kept on the session because a session can go stale in the
  // middle of a long import, and asked() below signs in again by itself rather
  // than reporting an empty March.
  const fresh = await signIn(email, password);
  fresh.email = email;
  fresh.password = password;
  live.set(id, fresh);
  return fresh;
}

// Everything below takes a session and, if the portal has forgotten us,
// signs in once more and asks again. A session expiring in the middle of a
// twenty-month import must not read as "Trax has no parcels in March".
async function asked(session, path, query) {
  let answer = await raw(path, { jar: session.jar, query, ajax: true });

  if (sentToLogin(answer)) {
    if (!session.email) throw new Error('The Trax portal sign-in has expired');
    const again = await signIn(session.email, session.password);
    session.jar = again.jar;
    session.at = again.at;
    session.shippers = again.shippers;
    answer = await raw(path, { jar: session.jar, query, ajax: true });
    if (sentToLogin(answer)) throw new Error('The Trax portal sign-in has expired');
  }

  if (!answer.json) {
    throw new Error('Trax answered ' + answer.status + ' with something that was not ' +
      'a list: ' + String(answer.text).replace(/<[^>]*>/g, ' ').trim().slice(0, 160));
  }
  return answer.json;
}

/* ==================== the list that has a date range ==================== */

// DataTables asks for its page by index, and which column it is ordered by
// decides whether two pages of the same search hold the same parcel twice.
// So it is ordered by the tracking number - unique, and theirs - rather than
// by whatever the server would have chosen.
function pageQuery(shipper, from, to, start, length) {
  return {
    draw: 1,
    start,
    length,
    'columns[0][data]': 'tracking_number',
    'columns[0][name]': 'shipments.tracking_number',
    'columns[0][searchable]': 'true',
    'columns[0][orderable]': 'true',
    'order[0][column]': 0,
    'order[0][dir]': 'asc',
    'search[value]': '',
    'search[regex]': 'false',
    search_user: shipper,
    search_origin: '',
    search_destination: '',
    cards_filter: '',
    search_date_from: from + ' 00:00:00',
    search_date_to: to + ' 23:59:59'
  };
}

// One page of a date range, as the app's own parcels.
export async function shipmentPage(session, { shipper, from, to, start, length }) {
  const j = await asked(session, '/cod/reports/summary/list',
    pageQuery(shipper, from, to, Number(start) || 0, Number(length) || PAGE));

  const rows = Array.isArray(j.data) ? j.data : [];
  return {
    total: Number(j.recordsFiltered || j.recordsTotal || 0) || rows.length,
    parcels: rows.map(mapRow).filter(p => p.tracking)
  };
}

// Every parcel in a date range, a page at a time. `onPage` is called as each
// one lands so a long month can be written down and said out loud rather than
// held in memory to the end.
export async function shipments(session, { shipper, from, to, onPage, stop }) {
  let start = 0;
  let total = 0;
  let got = 0;
  let guard = 0;

  // Nothing of theirs is ever this big, and a page count that cannot run away
  // is the difference between a slow import and an afternoon.
  const CAP = Math.max(1, Number(process.env.TRAX_PORTAL_PAGE_CAP) || 200);

  while (guard++ < CAP) {
    if (stop && stop()) break;

    const page = await shipmentPage(session, { shipper, from, to, start, length: PAGE });
    total = page.total;

    if (page.parcels.length && onPage) await onPage(page.parcels, { start, total });
    got += page.parcels.length;

    if (page.parcels.length < PAGE) break;
    start += PAGE;
    if (start >= total) break;
  }

  return { total, got };
}

/* ---------- their row, in the app's own shape ---------- */
//
// Their Summary row carries about two dozen fields and a dozen are read. The
// one that matters most is `rider_picked_status_date`: **empty means nobody
// came for it**, which is the question the API could never answer.
export function mapRow(row) {
  const r = row || {};
  const status = String(r.current_status || '').trim();
  const group = (portal.groupOf || byWords)(status);
  const statusDay = day(r.current_status_date);

  return {
    tracking:    String(r.tracking_number || '').trim(),
    // Their Order ID is our own order number - Shopify's, as it was put on the
    // booking - so an imported parcel ties to an order without being matched
    // by anything cleverer than its own name.
    orderRef:    String(r.order_id || '').trim(),
    customer:    String(r.consignee_name || '').trim(),
    phone:       String(r.consignee_phone || '').trim(),
    address:     '',
    detail:      String(r.product_name || '').trim(),
    notes:       String(r.return_reason || '').trim(),
    items:       0,
    weight:      num(r.actual_weight),
    status,
    statusGroup: group,
    amount:      num(r.collection_amount),
    // What Trax keep for carrying it. Their GST is not on this screen - it is
    // on the payment, which is where the settled figures come from anyway.
    fee:         num(r.weight_charges) + num(r.cash_handling_charges),
    tax:         0,
    payout:      0,
    upfront:     0,
    reserve:     0,
    balance:     0,
    city:        String(r.destination || '').trim(),
    bookedOn:    day(r.booking_date) || day(r.arrival_date),
    // Deliberately only the rider's own pickup. A parcel with no pickup date
    // is a parcel nobody collected, and filling that in from the first
    // delivery attempt would hide the very thing this import is for.
    pickedOn:    day(r.rider_picked_status_date),
    deliveredOn: group === 'delivered' ? statusDay : null,
    // What the portal says about the money, kept as it was said. It is not
    // written into the settlement columns here - see paidOnly() below.
    paidSaid:    String(r.payment_status || '').trim(),
    raw: {
      via: 'portal',
      payment_status: String(r.payment_status || '').trim(),
      return_reason: String(r.return_reason || '').trim(),
      first_attempt: day(r.first_attempt_date),
      second_attempt: day(r.second_attempt_date),
      third_attempt: day(r.third_attempt_date),
      origin: String(r.origin || '').trim(),
      service: String(r.service_type || '').trim(),
      status_date: statusDay
    }
  };
}

// Which of these the portal says have been paid out.
//
// Only "paid" is ever carried over, and nothing is ever marked unpaid from
// here. The payment webhook and `/invoice` know the payment's own id and this
// screen does not, so a row that says nothing must leave what they wrote
// alone - "this screen did not mention it" is not "the courier has not paid".
export function paidOnly(parcels) {
  return (parcels || [])
    .filter(p => /paid|processed|cleared|transferred/i.test(p.paidSaid || ''))
    .map(p => ({ tracking: p.tracking, settled: true, settledOn: null }));
}

/* ==================== what the adapter hands over ==================== */

export const portal = {
  where: 'sonic.pk',
  // filled in by trax.js, which owns the courier's own wording
  groupOf: null,
  // what the sign-in box says, so the page need not know which courier it is
  // drawing it for
  says: 'The same email and password you use on sonic.pk. It is kept ' +
        'encrypted so the app can sign in again on its own - a portal ' +
        'sign-in only lasts a couple of hours. It is checked before it is saved.',
  lists: true,
  signIn,
  sessionFor,
  forget,
  shipments,
  shipmentPage,
  paidOnly
};
