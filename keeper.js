// Keeps our own table in step with the couriers, without anyone asking.
// On start it works out how far behind each account is and fills the gap;
// after that it comes back as often as the month's database allowance allows.
//
// It used to come back every thirty minutes come what may. That is 48 wake-ups
// a day, and because Neon stays awake five minutes after the last query, each
// one costs about six minutes of compute - call it 180 hours a month on a free
// plan of about 100. It would have run out around the twentieth of every month.
//
// So the gap is no longer a constant. After each sweep the keeper asks
// compute.js what the month can still afford and comes back then; and an
// account whose webhook is live is skipped in between, because the courier is
// already telling us the thing the sweep would have gone looking for. The
// sweep is still what the settlement side and the quiet gaps depend on - it is
// how often, not whether.

import { pool } from './db.js';
import { listAccounts, getAccount, saveOrders, trimRaw, credsOf } from './couriers.js';
import { adapterFor } from './adapters.js';
import {
  beginBackground, endBackground, nextGapMinutes, mayRun, computeState
} from './compute.js';

const RECENT_DAYS = 4;             // what a routine refresh covers
const MAX_CATCHUP = 120;           // how far back a first fill will reach
const RAW_DAYS = 7;                // how long the courier's own JSON is kept
const HOOK_ALIVE = 24 * 3600 * 1000; // a webhook that called today is working

const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);

function shift(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// a month at a time - a whole span in one ask comes back short
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
    const end = `${y}-${String(m).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

    out.push({ from: start < from ? from : start, to: end > to ? to : end });

    m++;
    if (m > 12) { m = 1; y++; }
    guard++;
  }
  return out;
}

// what the page can show about the last sweep
const state = {
  running: false,
  startedAt: null,
  finishedAt: null,
  accounts: {},          // account id -> { label, from, to, saved, at, error }
  sweptAt: {},           // account id -> when this keeper last asked about it
  nextAt: null,
  gapMinutes: null,
  hooked: false,
  holding: false,
  note: ''
};

let timer = null;

export function keeperState() {
  return {
    running: state.running,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    nextAt: state.nextAt,
    gapMinutes: state.gapMinutes,
    holding: state.holding,
    note: state.note,
    compute: computeState(),
    accounts: Object.values(state.accounts)
  };
}

// the newest day we already hold for one account
async function lastDayOf(realmId, accountId) {
  const r = await pool.query(
    `SELECT MAX(booked_on) AS day FROM courier_orders
      WHERE realm_id = $1 AND account_id = $2`,
    [realmId, accountId]
  );
  const d = r.rows[0] && r.rows[0].day;
  return d ? new Date(d).toISOString().slice(0, 10) : null;
}

// every company that has a courier account
async function everyRealm() {
  const r = await pool.query(
    `SELECT DISTINCT realm_id FROM courier_accounts WHERE active IS NOT FALSE`
  );
  return r.rows.map(x => x.realm_id);
}

async function catchUpOne(realmId, acc) {
  const a = adapterFor(acc.courier);
  if (!a) return;

  const last = await lastDayOf(realmId, acc.id);
  const to = today();

  // nothing yet: reach back a few months. otherwise: from a little before
  // the newest day we hold, so anything that changed since is picked up
  const from = last ? shift(last, -(RECENT_DAYS - 1)) : shift(to, -MAX_CATCHUP);

  const mine = state.accounts[acc.id] = {
    id: acc.id,
    label: acc.label,
    courier: acc.courier,
    from, to,
    saved: 0,
    at: new Date().toISOString(),
    error: null,
    skipped: false
  };

  const extra = credsOf(acc);
  const spans = monthsBetween(from, to);

  for (const s of spans) {
    try {
      const orders = await a.fetchOrders(acc.token, s.from, s.to, 0, extra);
      const saved = await saveOrders(realmId, acc.id, acc.courier, orders);
      mine.saved += saved;
    } catch (e) {
      mine.error = e.message;
    }
    await sleep(400);
  }

  state.sweptAt[acc.id] = Date.now();
  mine.at = new Date().toISOString();
}

async function sweep(force) {
  if (state.running) return;

  // The one place the month's allowance is enforced. Past it the sweep holds
  // off by itself - webhooks still arrive, and Pull orders still works when
  // somebody asks for it, which is the right way round: a person waiting is
  // worth compute, a sweep nobody asked for is not. `force` is that person
  // pressing the button, and it goes through.
  const gate = mayRun();
  state.holding = !gate.ok;
  if (!gate.ok && !force) {
    state.note = gate.why;
    return;
  }

  state.running = true;
  state.startedAt = new Date().toISOString();
  state.note = 'looking for anything missing';

  const mark = beginBackground();
  const hookedGap = nextGapMinutes({ hooked: true }) * 60 * 1000;
  let seen = 0, hooked = 0;

  try {
    const realms = await everyRealm();

    for (const realmId of realms) {
      let list = [];
      try { list = await listAccounts(realmId); } catch (e) { continue; }

      for (const row of list) {
        if (!adapterFor(row.courier)) continue;
        seen++;

        // A live webhook is the courier telling us a status the moment it
        // changes, which is what most of this sweep was for. So an account
        // being called about is asked only every few hours, for the money side
        // and for whatever no webhook mentioned.
        const live = row.hook_at &&
          (Date.now() - new Date(row.hook_at).getTime()) < HOOK_ALIVE;
        if (live) hooked++;

        const since = state.sweptAt[row.id] ? Date.now() - state.sweptAt[row.id] : Infinity;
        if (live && since < hookedGap) {
          state.accounts[row.id] = {
            id: row.id, label: row.label, courier: row.courier,
            skipped: true, saved: 0,
            at: new Date().toISOString(),
            note: 'its webhook is keeping this one current'
          };
          continue;
        }

        // listAccounts leaves the token out
        const acc = await getAccount(realmId, row.id);
        if (!acc) continue;

        try {
          await catchUpOne(realmId, acc);
        } catch (e) {
          state.accounts[row.id] = {
            id: row.id, label: row.label, courier: row.courier, error: e.message,
            at: new Date().toISOString()
          };
        }
      }
    }

    // the untouched copies are only worth keeping while they are recent
    try {
      const freed = await trimRaw(RAW_DAYS);
      if (freed) state.trimmed = freed;
    } catch (e) { /* not worth failing a sweep over */ }

    state.hooked = seen > 0 && hooked === seen;
    state.note = '';
  } catch (e) {
    state.note = e.message;
  } finally {
    endBackground(mark);
    state.running = false;
    state.finishedAt = new Date().toISOString();
  }
}

// Each sweep decides when the next one is, rather than a fixed interval doing
// it - which is the whole point: the gap has to be able to change as the month
// goes on, and a setInterval cannot.
function plan() {
  const mins = nextGapMinutes({ hooked: state.hooked });
  state.gapMinutes = mins;
  state.nextAt = new Date(Date.now() + mins * 60 * 1000).toISOString();

  if (timer) clearTimeout(timer);
  timer = setTimeout(() => run(false), mins * 60 * 1000);
  if (timer.unref) timer.unref();
}

function run(force) {
  sweep(force).catch(() => {}).finally(plan);
}

export function startKeeper() {
  // a moment after the server settles, then as often as the month allows
  setTimeout(() => run(false), 15000);
}

// for the button on the page. Asked for by a person, so the allowance does not
// stand in the way - it is their compute to spend.
export function sweepNow() {
  if (state.running) return { started: false, note: 'already going' };
  state.sweptAt = {};              // "now" means now, hooked accounts included
  run(true);
  return { started: true };
}
