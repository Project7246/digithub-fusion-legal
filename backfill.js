// Bringing months of a courier's history into our own table, once. After this
// runs, everything else - the receipts, the city figures, what is still owed -
// is answered from here instead of asking the courier all over again.
//
// Two ways in, because the couriers differ on the one thing that matters here:
//
//   by month     PostEx and M&P hand over a span of days, so the job walks it
//                a month at a time and keeps whatever comes back
//   by tracking  Trax has no call that lists a day's shipments - twenty-seven
//                endpoints and every one of them is about a consignment you
//                already hold. So their history cannot be asked for; it can
//                only be named. Give the job the tracking numbers (their own
//                portal exports them) and it asks about each one.
//
// The second is the only way a Trax account ever gets a past, and without it
// their webhooks are the whole record - which starts the day they are switched
// on and knows nothing of the months before.

import { getAccount, saveOrders, needCpr, savePayments, credsOf } from './couriers.js';
import { adapterFor } from './adapters.js';
import { realmOf } from './desk.js';

const jobs = new Map();          // desk (company and person) -> job

// One run's worth of tracking numbers. A courier that answers one parcel at a
// time is a courier it is easy to spend an afternoon and a month's compute on,
// so the limit is said out loud rather than discovered at parcel 40,000.
const TRACKING_CAP = Math.max(100, Number(process.env.BACKFILL_TRACKING_CAP) || 20000);

// asked three at a time, kept sixty at a time: the courier is not leant on,
// and the database is written to once a minute rather than once a parcel
const ASK_AT_ONCE = Math.max(1, Number(process.env.BACKFILL_ASK_AT_ONCE) || 3);
const KEEP_EVERY = Math.max(10, Number(process.env.BACKFILL_KEEP_EVERY) || 60);

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
    unit: job.unit,
    done: job.monthsDone,
    total: job.monthsTotal,
    missed: job.badUnits ? job.badUnits.size : 0,
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
  // Carrying on picks up where it stopped: what was kept is not asked for
  // again, and neither is what the courier has already said it does not know.
  job.monthsDone = job.okUnits.size + (job.badUnits ? job.badUnits.size : 0);
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

  if (!opts.account) throw new Error('Pick an account');

  // A list of tracking numbers instead of a span of days. Duplicates go here,
  // because an export with the same consignment on three rows is an export,
  // not three parcels - and each one asked twice is the courier asked twice.
  const named = Array.isArray(opts.trackings)
    ? [...new Set(opts.trackings.map(t => String(t == null ? '' : t).trim())
                                .filter(Boolean))]
    : null;

  if (named && named.length > TRACKING_CAP) {
    throw new Error(`That is ${named.length} tracking numbers and ${TRACKING_CAP} ` +
      'is as many as one run takes. Split the file and run it twice.');
  }

  let from = '', to = '';
  if (!named) {
    from = String(opts.from || '').slice(0, 10);
    to = String(opts.to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new Error('Pick a from and to date');
    }
    if (from > to) throw new Error('The first date is after the last one');
  }

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
    // one of the two, never both
    unit: named ? 'parcel' : 'month',
    trackings: named || [],
    months: named ? [] : monthsBetween(from, to),
    monthsDone: 0,
    okUnits: new Set(),           // kept, which a carry-on skips
    badUnits: new Set(),          // asked, and the courier knew nothing
    monthsTotal: 0,
    ordersSaved: 0,
    asked: 0,
    cprLeft: 0,
    withCpr: opts.withCpr !== false,
    log: []
  };
  job.monthsTotal = named ? named.length : job.months.length;

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

  const byName = job.unit === 'parcel';

  if (byName && typeof a.trackOne !== 'function') {
    throw new Error(a.name + ' will not answer about one parcel at a time, so a ' +
      'list of tracking numbers is no use to it. Use the dates instead.');
  }
  if (!byName && (a.lists === false || typeof a.fetchOrders !== 'function')) {
    throw new Error(a.name + ' cannot be asked for past months - its API only ' +
      'answers about one parcel at a time. Give it the tracking numbers from ' +
      'its own portal instead, and it will answer about every one of them.');
  }

  // whatever this courier wants beside its token - a login, an account number
  const extra = credsOf(acc);

  job.label = acc.label;
  if (!carrying) {
    say(job, byName
      ? `${acc.label}: ${job.trackings.length} tracking numbers to ask about`
      : `${acc.label}: ${job.from} to ${job.to}, ${job.months.length} month${job.months.length === 1 ? '' : 's'}`);
  }

  /* ---------- the orders themselves ---------- */

  if (byName) await askByName(realmId, job, acc, a, extra);
  else await askByMonth(realmId, job, acc, a, extra);

  if (job.cancel) {
    job.state = 'stopped';
    job.finishedAt = new Date().toISOString();
    say(job, `Stopped - ${job.ordersSaved} orders kept`);
    return;
  }

  await askWhatWasPaid(realmId, job, acc, a, extra);

  job.state = job.cancel ? 'stopped' : 'done';
  job.phase = 'done';
  job.finishedAt = new Date().toISOString();
  say(job, job.cancel
    ? `Stopped - ${job.ordersSaved} orders kept, ${job.asked} asked about`
    : `Finished - ${job.ordersSaved} orders kept, ${job.asked} asked about`);
}

// A span of days, a month at a time: the shape for a courier that will hand
// over a list.
async function askByMonth(realmId, job, acc, a, extra) {
  for (const m of job.months) {
    if (job.cancel) break;
    if (job.okUnits.has(m.label)) continue;

    let orders = [];
    try {
      orders = await tryThrice(job, m.label,
        () => a.fetchOrders(acc.token, m.from, m.to, 0, extra));
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

    job.ordersSaved += saved;
    job.monthsDone++;
    job.okUnits.add(m.label);
    say(job, `${m.label}: ${orders.length} orders, ${saved} kept`);

    await sleep(500);
  }
}

// Named one at a time: the shape for Trax, whose history exists only as a list
// of consignment numbers in their own portal.
async function askByName(realmId, job, acc, a, extra) {
  const left = job.trackings.filter(
    t => !job.okUnits.has(t) && !job.badUnits.has(t));

  let batch = [];
  let misses = 0;
  const unknown = [];

  const keep = async () => {
    if (!batch.length) return;
    const holding = batch;
    batch = [];
    try {
      job.ordersSaved += await saveOrders(realmId, acc.id, acc.courier,
                                          holding.map(x => x.order));
      holding.forEach(x => job.okUnits.add(x.cn));
    } catch (e) {
      // not marked done, so a carry-on asks about them again
      say(job, `${holding.length} came back but could not be kept - ${e.message}`);
    }
  };

  for (let i = 0; i < left.length; i += ASK_AT_ONCE) {
    if (job.cancel) break;
    const chunk = left.slice(i, i + ASK_AT_ONCE);

    const answers = await Promise.all(chunk.map(cn =>
      a.trackOne(acc.token, cn, extra)
        .then(order => ({ cn, order }))
        .catch(e => ({ cn, why: e.message }))));

    answers.forEach(x => {
      job.monthsDone++;
      if (x.order && x.order.tracking) {
        batch.push({ cn: x.cn, order: x.order });
      } else {
        misses++;
        job.badUnits.add(x.cn);
        if (unknown.length < 8) unknown.push(x.cn + ' - ' + (x.why || 'nothing came back'));
      }
    });

    if (batch.length >= KEEP_EVERY) await keep();

    if (job.monthsDone % 300 < ASK_AT_ONCE) {
      say(job, `${job.monthsDone} of ${job.monthsTotal} asked about, ${job.ordersSaved} kept`);
    }
  }

  await keep();

  if (misses) {
    say(job, `${misses} the courier had nothing for` +
             (unknown.length ? ' - first few: ' + unknown.join('; ') : ''));
  }
}

/* ---------- then what each one was paid under ---------- */

async function askWhatWasPaid(realmId, job, acc, a, extra) {
  if (job.withCpr && a.fetchPayment) {
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
}
