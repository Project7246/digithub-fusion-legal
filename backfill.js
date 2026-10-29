// Bringing months of a courier's history into our own table, once. After this
// runs, everything else - the receipts, the city figures, what is still owed -
// is answered from here instead of asking the courier all over again.

import {
  getAccount, saveOrders, needCpr, savePayments, markPaid, credsOf
} from './couriers.js';
import { adapterFor } from './adapters.js';
import { decrypt } from './secrets.js';
import { realmOf } from './desk.js';

const jobs = new Map();          // desk (company and person) -> job

const now = () => Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));

function say(job, text) {
  job.log.push({ at: new Date().toISOString(), text });
  if (job.log.length > 3000) job.log.splice(0, 800);
}

async function tryThrice(job, what, work) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await work();
    } catch (e) {
      last = e;
      if (job.cancel) throw e;
      if (attempt < 3) {
        say(job, `${what}: ${e.message} - trying again (${attempt} of 3)`);
        await sleep(attempt * 4000);
      }
    }
  }
  throw last;
}

// a month at a time keeps each answer small enough to arrive
function monthsBetween(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const lastY = Number(to.slice(0, 4));
  const lastM = Number(to.slice(5, 7));

  let guard = 0;
  while ((y < lastY || (y === lastY && m <= lastM)) && guard < 60) {
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let end = `${y}-${String(m).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

    out.push({
      from: start < from ? from : start,
      to: end > to ? to : end,
      label: start.slice(0, 7)
    });

    m++;
    if (m > 12) { m = 1; y++; }
    guard++;
  }
  return out;
}

export function backfillSnapshot(desk, since) {
  const job = jobs.get(desk);
  if (!job) return null;

  return {
    id: job.id,
    state: job.state,
    phase: job.phase,
    canCarryOn: job.state === 'stopped' || job.state === 'failed',
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
    account: job.label,
    monthsDone: job.monthsDone,
    monthsTotal: job.monthsTotal,
    ordersSaved: job.ordersSaved,
    asked: job.asked,
    withCpr: job.withCpr,
    cprLeft: job.cprLeft,
    log: job.log.slice(Number(since) || 0),
    logLength: job.log.length,
    error: job.error || null
  };
}

// Carry on after a Stop or a failure: the months not yet kept are read again,
// and the receipts are asked for again where they are still missing.
export function resumeBackfill(desk) {
  const realmId = realmOf(desk);
  const job = jobs.get(desk);
  if (!job) throw new Error('There is no backfill to carry on');
  if (job.state === 'running') throw new Error('The backfill is still running');
  if (job.state === 'done') throw new Error('The backfill already finished');

  job.cancel = false;
  job.error = null;
  job.state = 'running';
  job.phase = 'orders';
  job.finishedAt = null;
  job.monthsDone = job.okMonths.size;
  say(job, 'Carrying on');
  run(realmId, job, true).catch(e => {
    job.state = 'failed';
    job.error = e.message;
    job.finishedAt = new Date().toISOString();
    say(job, 'Stopped: ' + e.message);
  });
}

export function stopBackfill(desk) {
  const job = jobs.get(desk);
  if (!job || job.state !== 'running') return false;
  job.cancel = true;
  return true;
}

export function clearBackfill(desk) {
  const job = jobs.get(desk);
  if (job && job.state === 'running') return false;
  jobs.delete(desk);
  return true;
}

export function startBackfill(desk, opts) {
  const realmId = realmOf(desk);
  const old = jobs.get(desk);
  if (old && old.state === 'running') throw new Error('A backfill is already running');

  const from = String(opts.from || '').slice(0, 10);
  const to = String(opts.to || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error('Pick a from and to date');
  }
  if (from > to) throw new Error('The first date is after the last one');
  if (!opts.account) throw new Error('Pick an account');

  const job = {
    id: 'fill-' + now(),
    state: 'running',
    phase: 'orders',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    cancel: false,
    error: null,
    accountId: Number(opts.account),
    label: '',
    from, to,
    months: monthsBetween(from, to),
    monthsDone: 0,
    okMonths: new Set(),          // months kept, which a carry-on skips
    monthsTotal: 0,
    ordersSaved: 0,
    asked: 0,
    cprLeft: 0,
    withCpr: opts.withCpr !== false,
    log: []
  };
  job.monthsTotal = job.months.length;

  jobs.set(desk, job);
  run(realmId, job).catch(e => {
    job.state = 'failed';
    job.error = e.message;
    job.finishedAt = new Date().toISOString();
    say(job, 'Stopped: ' + e.message);
  });

  return job.id;
}

async function run(realmId, job, carrying) {
  const acc = await getAccount(realmId, job.accountId);
  if (!acc) throw new Error('No such account');

  const a = adapterFor(acc.courier);
  if (!a) throw new Error('No adapter for ' + acc.courier);

  // Two doors, and which one this account has decides nothing else about the
  // run. Most couriers answer a span of days from their API; Trax does not -
  // its API only ever answers about a tracking number you already hold - but
  // its **portal** does, and that is what the sign-in on the Couriers page
  // buys. Everything after this reads the same either way.
  const viaPortal = !!(a.portal && a.portal.lists &&
                       typeof a.portal.sessionFor === 'function' &&
                       acc.portal_email && acc.portal_secret);

  if (!viaPortal && (a.lists === false || typeof a.fetchOrders !== 'function')) {
    throw new Error(a.name + ' cannot be asked for past months through its API - ' +
      'it only answers about one parcel at a time' +
      (a.portal && a.portal.lists
        ? `. Its past is behind its own portal: sign in to ${a.portal.where} ` +
          'for this account on the Couriers page, then start this again'
        : ', so its orders arrive through its webhooks from the day they are ' +
          'switched on'));
  }

  // whatever this courier wants beside its token - a login, an account number
  const extra = credsOf(acc);

  // The portal is a second sign-in and it is made once, here, rather than per
  // month: twenty months would otherwise be twenty sign-ins.
  let session = null;
  let shipper = '';
  if (viaPortal) {
    session = await a.portal.sessionFor(acc.id, acc.portal_email, decrypt(acc.portal_secret));
    const who = (session.shippers || [])[0] || null;
    shipper = who ? who.id : '';
    if (!shipper) {
      throw new Error(`${a.portal.where} did not say which shipper this sign-in ` +
        'is for, so there is nothing to ask it about');
    }
    say(job, `Signed in to ${a.portal.where} as ${who.name || acc.portal_email}`);
  }

  // One month's parcels, however this account gets them.
  async function monthOrders(m) {
    if (!viaPortal) return a.fetchOrders(acc.token, m.from, m.to, 0, extra);

    const got = [];
    await a.portal.shipments(session, {
      shipper,
      from: m.from,
      to: m.to,
      onPage: list => { got.push(...list); },
      stop: () => job.cancel
    });
    return got;
  }

  job.label = acc.label;
  if (!carrying) say(job, `${acc.label}: ${job.from} to ${job.to}, ${job.months.length} month${job.months.length === 1 ? '' : 's'}`);

  /* ---------- the orders themselves ---------- */

  for (const m of job.months) {
    if (job.cancel) break;
    if (job.okMonths.has(m.label)) continue;

    let orders = [];
    try {
      orders = await tryThrice(job, m.label, () => monthOrders(m));
    } catch (e) {
      say(job, `${m.label}: gave up - ${e.message}`);
      job.monthsDone++;
      continue;
    }

    let saved = 0;
    try {
      saved = await saveOrders(realmId, acc.id, acc.courier, orders);
    } catch (e) {
      say(job, `${m.label}: ${orders.length} came back but could not be kept - ${e.message}`);
      job.monthsDone++;
      continue;
    }

    // What the portal's own report says has been paid out. It names no payment,
    // so it only ever marks a parcel paid and never unpaid - markPaid() is the
    // whole of that rule, and the receipt numbers the payment webhook wrote are
    // left exactly as they are.
    let paid = 0;
    if (viaPortal && typeof a.portal.paidOnly === 'function') {
      try {
        paid = await markPaid(realmId, acc.id, a.portal.paidOnly(orders));
      } catch (e) {
        say(job, `${m.label}: the parcels were kept but their payment status was not - ${e.message}`);
      }
    }

    job.ordersSaved += saved;
    job.monthsDone++;
    job.okMonths.add(m.label);
    say(job, `${m.label}: ${orders.length} orders, ${saved} kept` +
             (paid ? `, ${paid} of them already paid for` : ''));

    await sleep(500);
  }

  if (job.cancel) {
    job.state = 'stopped';
    job.finishedAt = new Date().toISOString();
    say(job, `Stopped - ${job.ordersSaved} orders kept`);
    return;
  }

  /* ---------- then what each one was paid under ---------- */

  if (job.withCpr && viaPortal) {
    say(job, 'The payment status came with each parcel, so nothing is asked ' +
             'about one at a time. Which payment paid for it arrives from the ' +
             "courier's payment webhook, a whole batch at a time.");
  }

  // Asked parcel by parcel, which is the only way PostEx's API will answer it.
  // **Never after a portal import**: that import is how a courier with no list
  // call gets years of parcels at once, and asking each delivered one of fifty
  // thousand what it was paid under is fifty thousand calls through a relay.
  // What paid for them arrives from the payment webhook and the invoice behind
  // it (traxlive.js), a whole batch at a time.
  if (job.withCpr && a.fetchPayment && !viaPortal) {
    job.phase = 'receipts';
    say(job, 'Now asking what each delivered parcel was paid under');

    let round = 0;
    while (!job.cancel && round < 400) {
      let list;
      try {
        list = await needCpr(realmId, acc.id, 80);
      } catch (e) {
        say(job, 'Could not read the list of what is left - ' + e.message);
        break;
      }

      if (!list.length) {
        say(job, 'Every delivered parcel has been asked about');
        break;
      }

      job.cprLeft = list.length;

      // eight at a time - quick, without leaning on the courier
      for (let i = 0; i < list.length; i += 8) {
        if (job.cancel) break;
        const chunk = list.slice(i, i + 8);
        const answers = await Promise.all(
          chunk.map(t => a.fetchPayment(acc.token, t, extra).catch(() => null))
        );
        const good = answers.filter(Boolean);
        try { await savePayments(realmId, acc.id, good); } catch (e) {}
        job.asked += chunk.length;
      }

      round++;
      if (round % 5 === 0) say(job, `${job.asked} asked about so far`);
      await sleep(300);
    }
  }

  job.state = job.cancel ? 'stopped' : 'done';
  job.phase = 'done';
  job.finishedAt = new Date().toISOString();
  say(job, job.cancel
    ? `Stopped - ${job.ordersSaved} orders kept, ${job.asked} asked about`
    : `Finished - ${job.ordersSaved} orders kept, ${job.asked} asked about`);
}
