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

import { relayed, relayHeaders, plainly, readBody, NO_ZIP } from './wire.js';
import { num, day, byWords, cityName } from './statuses.js';

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

// **A sign-in is not a list call and must not be timed like one.**
//
// The login page comes back through the relay in about ten seconds; the POST
// that answers it takes longer, and twenty-two was not enough for it. An
// account with a cached session never makes that call and was exact; the one
// without it timed out on every visit, and its receipts stayed as they were.
// That is what made one account of a courier right and the next wrong, and
// no amount of queueing or retrying could have fixed it.
//
// The relay's own curl must allow at least as much - tools/courier-relay.php,
// `CURLOPT_TIMEOUT`. Until that file is the current one on the website, the
// relay is the shorter of the two and it is the relay that cuts the call.
const SIGNIN_TIMEOUT =
  Math.max(5, Number(process.env.TRAX_PORTAL_SIGNIN_SECONDS) || 35) * 1000;
export const PAGE = Math.min(1000, Math.max(50, Number(process.env.TRAX_PORTAL_PAGE) || 500));

// Laravel's session lasts two hours by default. Signing in again costs two
// calls, so this errs well short of it rather than finding out the hard way in
// the middle of a month's import.
const SESSION_MS = Math.max(5, Number(process.env.TRAX_PORTAL_MINUTES) || 75) * 60 * 1000;

/* ==================== the call ==================== */

// Everything about this is ordinary except that the answer's headers are kept:
// the portal signs us in by setting a cookie, and a reader that only returns
// the body cannot see it.
// **A timeout gets one more go.**
//
// Every call here crosses the relay to a host that answers from inside
// Pakistan, and that journey occasionally simply does not finish in the
// twenty-two seconds this allows. One account of a courier came back
// "ETIMEDOUT - no answer at all" on every visit while the other, on the same
// portal through the same relay, answered instantly from a session it
// already held - so the account with nothing cached was the one that paid
// for the slow first call, every time, and its receipts never moved.
//
// Only a timeout is retried, and only once. Anything the portal actually
// said - a refused sign-in, a 419, a relay that will not forward - is an
// answer, and answers are not worth asking twice.
async function raw(path, opts = {}) {
  try {
    return await once(path, opts);
  } catch (e) {
    if (!/ETIMEDOUT|could not be reached/i.test(String(e.message || ''))) throw e;
    return once(path, opts);
  }
}

async function once(path, { method, jar, form, query, ajax } = {}) {
  const url = new URL(BASE + path);
  Object.keys(query || {}).forEach(k => {
    const v = query[k];
    if (v === undefined || v === null) return;
    url.searchParams.set(k, v);
  });

  let to = url.toString();
  const headers = {
    'Accept': ajax ? 'application/json, text/javascript, */*; q=0.01' : 'text/html,*/*',
    'User-Agent': 'Mozilla/5.0 (compatible; Fusion/1.0)',
    // the relay passes Content-Type back and not Content-Encoding, so ask the
    // portal for plain text rather than guessing afterwards - see wire.js
    ...NO_ZIP
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
  // the sign-in pages get the longer budget; everything else is a list
  const budget = /\/cod\/login/i.test(path) ? SIGNIN_TIMEOUT : TIMEOUT;
  const bell = setTimeout(() => ctl.abort(), budget);
  const started = Date.now();

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
    text = await readBody(r);
  } catch (e) {
    // Only the call itself failing lands here. What the portal or the relay
    // *said* is read below, where it can be said back in their own words.
    //
    // **Which call, and how long it waited.** "could not be reached" on its
    // own cost a morning of inference: the sign-in makes three calls with
    // two different budgets, and from outside there was no way to tell
    // which of them had stopped, nor whether it was our abort or the
    // relay's. A failure that names itself is the difference between
    // reading a screen and guessing at arithmetic.
    throw new Error('The Trax portal could not be reached: ' + plainly(e) +
      ' [' + (method || 'GET') + ' ' + path + ', gave up after ' +
      Math.round((Date.now() - started) / 100) / 10 + 's of ' +
      Math.round(budget / 1000) + 's]' +
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

// Laravel answers a refused sign-in by sending you back to the form with the
// reason in the session, and the reason is printed on the page it sends you
// to - not in the redirect. Where it answers 200 it is on the page already.
function complaintFrom(html) {
  const s = String(html || '');
  const bits = [];
  const grab = (re) => {
    let m;
    const r = new RegExp(re, 'gi');
    while ((m = r.exec(s)) && bits.length < 3) {
      const t = String(m[1] || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (t && t.length < 200 && !bits.includes(t)) bits.push(t);
    }
  };
  grab('<(?:div|span|p|li)[^>]*class=["\'][^"\']*(?:invalid-feedback|alert-danger|error)[^"\']*["\'][^>]*>([\\s\\S]{1,300}?)</(?:div|span|p|li)>');
  return bits.join('; ');
}

// Half of a sign-in, and the half that needs no password: ask the portal for
// its login page and say what came back with it. A session cookie and a token
// are both needed before an email and a password are worth sending, and when
// either is missing the fault is the route, not the credentials - so this can
// be run and read by anybody without a password being anywhere near it.
export async function probeLogin() {
  const jar = new Map();
  const page = await raw('/cod/login', { jar });
  const token = tokenFrom(page.text);
  const names = [...jar.keys()];

  let say;
  if (!page.status) say = 'The portal could not be reached at all: ' + page.text;
  else if (!token && !names.length)
    say = 'The portal answered ' + page.status + ' with neither a sign-in form ' +
          'nor a cookie - nothing of a sign-in can work from here.';
  else if (!names.length)
    say = 'The sign-in form came back but no cookie came with it. Laravel ties ' +
          'the form to a session cookie, so the sign-in would be refused ' +
          'whatever the password. The relay is dropping Set-Cookie - ' +
          'courier-relay.php on the website is not the current one.';
  else if (!token)
    say = 'A cookie came back but no _token field, so the page is not the ' +
          'sign-in form we expect.';
  else
    say = 'The sign-in form and its session cookie both came back, so the ' +
          'route is sound: anything refused from here is about the email and ' +
          'password themselves.';

  return {
    ok: !!token && names.length > 0,
    status: page.status,
    bytes: (page.text || '').length,
    token: !!token,
    cookies: names.length,
    cookieNames: names,
    say
  };
}

export async function signIn(email, password) {
  const jar = new Map();

  const page = await raw('/cod/login', { jar });
  const token = tokenFrom(page.text);
  if (!token) {
    throw new Error('The Trax portal did not hand over a sign-in form. ' +
      'Either sonic.pk is down or the sign-in page has moved.');
  }

  // Laravel ties the token on that page to the session cookie that came with
  // it. No cookie, no session, and the POST is refused for a reason that has
  // nothing to do with the password - which is what this used to report. The
  // relay is the only thing between us and the portal, so if the cookies did
  // not arrive it is the relay that dropped them.
  if (jar.size === 0) {
    throw new Error('The Trax portal sent its sign-in form but no session ' +
      'cookie came back with it, so the form cannot be submitted. The relay ' +
      'is not passing Set-Cookie through - tools/courier-relay.php on the ' +
      'website needs to be the current one.');
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
    // 419 is Laravel's own: the token did not match the session. That is a
    // cookie that did not survive the journey, never a wrong password, and
    // saying "wrong password" sends somebody to change a password that was
    // right all along.
    if (posted.status === 419) {
      throw new Error('The Trax portal refused the form as out of date ' +
        '(419): the sign-in page and the form we sent it did not share a ' +
        'session. The relay is not carrying the portal\'s cookies.');
    }
    const why = complaintFrom(posted.text);
    if (why) throw new Error('Trax refused the sign-in: ' + why);

    // Anything else is said with what actually came back, so the next person
    // is not guessing at a password that may be perfectly correct.
    if (posted.status !== 302 && posted.status !== 303) {
      throw new Error('Trax answered the sign-in with ' + posted.status +
        ' instead of the redirect a sign-in gives. Nothing says the email or ' +
        'password is wrong - that is the portal or the route misbehaving.');
    }
    throw new Error('Trax did not accept that email and password - it sent ' +
      'the sign-in straight back to the login page.');
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
    city:        cityName(r.destination),
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

/* ==================== the payments screen, which is the CPR list =========

   Trax pay against a **payment**, and the portal's Finance > Payments screen
   is the receipt for it: what was collected, what they kept, the GST, the
   withholding, the IBFT fee and what actually reached the bank. Nothing read
   it until 5 Nov 2026, so an account could hold thirteen thousand parcels and
   not one receipt - which is what "trax k cprs mn bohot msla h" was.

   Read off the live portal while signed in. One row, for payment 1827506:

     total_amount   166,169.00     collected at the door
     total_charges  134,763.22     what Trax kept for carrying
     total_gst       21,562.41
     total_wht        3,323.38     withheld
     total_cod_sst    3,323.38
     ibft_charges           100    the bank's own fee
     total_payable        3,097    what reached the bank

   and 166,169.00 less all five of those is 3,096.61, which is the 3,097 they
   print. So the breakdown ties and `total_payable` is the figure to keep: it
   already has every deduction off it, the IBFT fee included.                */

// Laravel wants its token on a POST, and the one minted at sign-in is not the
// one the session carries afterwards. The payments page prints the current
// one, so it is read from there once and kept for the session.
async function csrfOf(session) {
  if (session.csrf) return session.csrf;
  const page = await raw('/cod/finance/payments', { jar: session.jar });
  if (sentToLogin(page)) throw new Error('The Trax portal sign-in has expired');
  session.csrf = tokenFrom(page.text);
  if (!session.csrf) {
    throw new Error('The Trax payments screen did not carry a form token, so ' +
      'its lists cannot be asked for. The screen has moved or we are not signed in.');
  }
  return session.csrf;
}

// Their DataTables feed will not answer unless every column it draws is named
// in the request, so they are listed here exactly as the screen draws them.
const PAY_COLUMNS = [
  'serial_number', 'id_padded', 'shipper', 'city', 'phone_numbers', 'address',
  'total_shipments', 'delivered_shipments', 'returned_shipments',
  'adjusted_shipments', 'arrival_shipments', 'count_fintech_shipments',
  'total_amount', 'total_charges', 'total_gst', 'total_wht', 'total_cod_sst',
  'total_payable', 'bank', 'return_shipments_average_aging',
  'reference_number', 'done_at', 'company_bank', 'status', 'action'
];

function payQuery(start, length) {
  const q = {
    draw: 1, start, length,
    'search[value]': '', 'search[regex]': 'false',
    'order[0][column]': 1, 'order[0][dir]': 'desc'
  };
  PAY_COLUMNS.forEach((c, i) => {
    q['columns[' + i + '][data]'] = c;
    q['columns[' + i + '][name]'] = c;
    q['columns[' + i + '][searchable]'] = 'true';
    q['columns[' + i + '][orderable]'] = 'true';
    q['columns[' + i + '][search][value]'] = '';
    q['columns[' + i + '][search][regex]'] = 'false';
  });
  return q;
}

// "166,169.00" is a number with its thousands marks still on it, and a plain
// Number() of that is NaN - which would be written down as nought.
const money = (v) => num(String(v == null ? '' : v).replace(/,/g, ''));

// A count that may arrive as a number, as "1,709", or as the button their
// screen draws it in - `<button ...>74</button>`. Everything but the digits
// goes, and a count that is not there stays nought rather than becoming NaN.
const count = (v) => {
  const digits = String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
};

const pick = (a, b) => (a === undefined || a === null || a === '' ? b : a);

// What one of their payments comes to, added up the way their own screen
// does: five deductions off what was collected, and `total_payable` is what
// is left. It is here rather than worked out wherever it is wanted, because
// a receipt that does not tie to the courier's own figure is the first thing
// worth knowing about it - and that can only be said by one sum.
export function paymentTotals(p) {
  const r = (p && p.raw) || {};
  const r2 = v => Math.round(Number(v || 0) * 100) / 100;

  const collected = r2(p && p.grossAmount);
  const charges   = r2(p && p.chargeAmount);
  const gst       = r2(r.gst);
  const wht       = r2(r.wht);
  const sst       = r2(r.codSst);
  const ibft      = r2(r.ibft);
  const deducted  = r2(charges + gst + wht + sst + ibft);
  const net       = r2(p && p.netAmount);

  return {
    collected, charges, gst, wht, sst, ibft, deducted, net,
    // what their own payable leaves unexplained. Theirs is printed to the
    // rupee, so anything under one rupee is their rounding and not a gap.
    over: r2(collected - deducted - net)
  };
}

// Their status word, kept as they write it. Which of their words means the
// money has actually arrived is decided where every courier's is - not here.
export function mapPayment(r) {
  const id = String(r.id_padded || r.id || '').trim();
  return {
    cprNumber:   id,
    remoteId:    String(r.id || ''),
    status:      String(r.status || '').trim(),
    netAmount:   money(r.total_payable),
    grossAmount: money(r.total_amount),
    chargeAmount: money(r.total_charges),
    createdOn:   r.done_at || null,
    approvedOn:  r.done_at || null,
    paidToBank:  String(r.bank || '').trim(),
    paidToName:  String(r.shipper || '').trim(),
    instrument:  String(r.reference_number || '').trim() || null,
    raw: {
      // Named, so the receipt list can tell a cover we hold from the courier
      // itself apart from one worked out by adding its parcels up - the same
      // mark M&P's consolidated payments carry.
      source: 'trax-portal-payment-v1',
      gst: money(r.total_gst),
      wht: money(r.total_wht),
      codSst: money(r.total_cod_sst),
      ibft: money(r.ibft_charges),
      // Their screen draws each of these as a button with the count inside
      // it, so `delivered_shipments` is a lump of HTML and the figure is on
      // the `_count` beside it. The four add up to `total_shipments`:
      // delivered + returned + adjusted, with arrival counted another way.
      // The `_count` beside each button is not one of the columns their
      // screen asks for, so it is read where it is and the button itself is
      // the fallback - a count that moved is a count read wrong, not a nought.
      shipments: count(r.total_shipments),
      delivered: count(pick(r.delivered_shipments_count, r.delivered_shipments)),
      returned: count(pick(r.returned_shipments_count, r.returned_shipments)),
      adjusted: count(pick(r.adjusted_shipments_count, r.adjusted_shipments)),
      arrival: count(pick(r.arrival_shipments_count, r.arrival_shipments)),
      companyBank: String(r.company_bank || '').trim()
    }
  };
}

// Every payment on the account, newest first. There are a handful of these,
// not thousands, so one page of 200 covers it and the loop is only a guard.
export async function payments(session, { length = 200 } = {}) {
  const out = [];
  let start = 0;

  for (let guard = 0; guard < 20; guard++) {
    const j = await asked(session, '/cod/finance/payments/list',
                          payQuery(start, length));
    const rows = Array.isArray(j.data) ? j.data : [];
    rows.forEach(r => { const p = mapPayment(r); if (p.cprNumber) out.push(p); });

    const total = Number(j.recordsFiltered || j.recordsTotal || 0);
    start += rows.length;
    if (!rows.length || start >= total) break;
  }

  return out;
}

// The tracking numbers inside one payment. Their screen has a button per kind
// and each one answers a plain array of tracking numbers - 74 of them for
// payment 1827506, which is the 74 its row claims.
export async function paymentShipments(session, id, kind = 'delivered') {
  const token = await csrfOf(session);
  const answer = await raw('/cod/finance/payments/' + kind + '_shipments', {
    jar: session.jar,
    method: 'POST',
    ajax: true,
    form: { _token: token, payment_id: id, id }
  });

  if (sentToLogin(answer)) throw new Error('The Trax portal sign-in has expired');
  const j = answer.json;
  const list = Array.isArray(j) ? j : (j && typeof j === 'object' ? Object.values(j) : []);
  return list.map(x => String(x == null ? '' : x).trim()).filter(Boolean);
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
  paidOnly,
  payments,
  paymentShipments
};
