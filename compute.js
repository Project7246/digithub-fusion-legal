// How much of the month's Neon allowance has been spent, and what the quiet
// background work is allowed to spend next.
//
// Neon charges for the time its compute is awake, not for the queries run. It
// sleeps after about five minutes with nothing touching it, so one query at
// 10:00 and one at 10:04 cost one spell of nine minutes, and the same two
// queries an hour apart cost two spells of five. That is the whole of the bill,
// and it means the thing worth measuring is not how many queries we run but how
// often we wake the database up.
//
// Nothing here guesses. Every query goes through the pool, so the pool is where
// the meter sits: each query says "awake, now", a gap longer than the sleep
// window closes the old spell and starts a new one, and the month's total is
// the sum of the spells plus the five idle minutes each one ends with.
//
// Why it matters: the sweep in keeper.js used to run every thirty minutes come
// what may. Each sweep is a spell, so that is 48 spells a day, about six hours
// of compute, 180 hours a month - on a free plan of about 100. It would have
// run out somewhere around the twentieth of every month and the app would have
// looked broken for the rest of it. So the sweep now asks this file how long to
// wait, and the answer comes from what is actually left.
//
// This table holds no company's work - it is the server's own meter, like
// app_keys and once_done - so it carries no realm_id.

import { pool } from './db.js';

const MIN = 60 * 1000;

// How long Neon waits before suspending. Five minutes is the default and the
// one the free plan uses; NEON_IDLE_MINUTES is here for the day that changes.
const IDLE = Math.max(1, Number(process.env.NEON_IDLE_MINUTES) || 5) * MIN;

// The month's allowance in compute hours. The free plan is about 100.
const ALLOWANCE = Math.max(1, Number(process.env.NEON_CU_HOURS) || 100);

// How much of it the quiet background work may take. The rest is kept for
// people actually using the app, which must never be the thing that runs out.
const SHARE = Math.min(0.9, Math.max(0.05, Number(process.env.COMPUTE_SHARE) || 0.5));

// The floor and ceiling on the gap between sweeps. The floor is what somebody
// asked for; the ceiling stops a quiet month from letting the sweep drift so
// far out that nothing is ever picked up.
const FLOOR = Math.max(5, Number(process.env.KEEPER_MINUTES) || 30);
const CEIL  = Math.max(FLOOR, Number(process.env.KEEPER_MAX_MINUTES) || 360);

// Where the sweep stops altogether. Past this, the month's compute is the
// app's to spend on people, not on asking couriers what we already know -
// and webhooks keep arriving, each one costing a single query.
const STOP_AT = Math.min(0.99, Math.max(0.5, Number(process.env.COMPUTE_STOP_AT) || 0.95));

const monthNow = () => new Date().toISOString().slice(0, 7);

const state = {
  month: monthNow(),
  seconds: 0,          // spells already closed, this month
  bgSeconds: 0,        // of those, the part the background sweep paid for
  spells: 0,
  wokeAt: 0,           // when the spell now running began
  lastAt: 0,           // the last query in it
  dirty: false,
  loaded: false,
  patched: false
};

/* ---------- the meter ---------- */

function closeSpell() {
  if (!state.wokeAt) return;
  // the spell is the work plus the idle minutes Neon stays up for afterwards
  state.seconds += Math.round((state.lastAt - state.wokeAt + IDLE) / 1000);
  state.wokeAt = 0;
  state.dirty = true;
}

// Called on every query. Deliberately the cheapest thing in this file: two
// comparisons and an assignment, no awaits, nothing that can throw.
function note() {
  const now = Date.now();

  const month = monthNow();
  if (month !== state.month) {
    closeSpell();
    flush().catch(() => {});       // the old month, written down before it goes
    state.month = month;
    state.seconds = 0;
    state.bgSeconds = 0;
    state.spells = 0;
    state.lastAt = 0;
  }

  if (state.wokeAt && now - state.lastAt > IDLE) closeSpell();

  if (!state.wokeAt) {
    state.wokeAt = now;
    state.spells++;
    state.dirty = true;
  }

  state.lastAt = now;
}

// The spell running right now, counted as though it ended at the last query -
// its idle tail included, because that time is already bought.
function liveSeconds() {
  if (!state.wokeAt) return 0;
  return Math.round((state.lastAt - state.wokeAt + IDLE) / 1000);
}

export function usedHours() {
  return (state.seconds + liveSeconds()) / 3600;
}

// Is the database up at this moment? Only a flush that happens while it is
// already awake is free, so this is what decides whether to write.
export function awake() {
  return !!state.wokeAt && (Date.now() - state.lastAt) < IDLE;
}

/* ---------- keeping it across restarts ---------- */

export async function initCompute() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS compute_meter (
      month      TEXT PRIMARY KEY,
      seconds    BIGINT  DEFAULT 0,
      bg_seconds BIGINT  DEFAULT 0,
      spells     INTEGER DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(
    'ALTER TABLE compute_meter ADD COLUMN IF NOT EXISTS bg_seconds BIGINT DEFAULT 0');

  // A month is a month whoever restarts the server in the middle of it
  const r = await pool.query(
    'SELECT seconds, bg_seconds, spells FROM compute_meter WHERE month = $1',
    [state.month]);
  if (r.rows[0]) {
    state.seconds   = Number(r.rows[0].seconds) || 0;
    state.bgSeconds = Number(r.rows[0].bg_seconds) || 0;
    state.spells    = Number(r.rows[0].spells) || 0;
  }
  state.loaded = true;

  // The meter has to sit under everything, and every query in this app goes
  // through pool.query or a client from pool.connect, so those two are where
  // it goes. Wrapping them here rather than asking sixty files to report in is
  // the only version of this that cannot be forgotten in a new file.
  if (!state.patched) {
    const query = pool.query.bind(pool);
    pool.query = function (...args) { note(); return query(...args); };

    const connect = pool.connect.bind(pool);
    pool.connect = function (...args) { note(); return connect(...args); };

    state.patched = true;
  }

  // Written down now and then, and only while the database is already awake -
  // a meter that woke the database to record that it was asleep would be a
  // joke at its own expense.
  setInterval(() => {
    if (state.dirty && awake()) flush().catch(() => {});
  }, 3 * MIN).unref();

  // The tally is small, but a year of months is still a year of rows nobody
  // reads. Fourteen is enough to compare this month with last.
  try {
    await pool.query(
      `DELETE FROM compute_meter
         WHERE month < to_char(NOW() - INTERVAL '14 months', 'YYYY-MM')`);
  } catch (e) { /* not worth failing startup over */ }
}

export async function flush() {
  if (!state.loaded) return;
  const seconds = state.seconds + liveSeconds();
  state.dirty = false;

  await pool.query(
    `INSERT INTO compute_meter (month, seconds, bg_seconds, spells, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (month) DO UPDATE SET
       seconds    = GREATEST(compute_meter.seconds, EXCLUDED.seconds),
       bg_seconds = GREATEST(compute_meter.bg_seconds, EXCLUDED.bg_seconds),
       spells     = GREATEST(compute_meter.spells, EXCLUDED.spells),
       updated_at = NOW()`,
    [state.month, Math.round(seconds), Math.round(state.bgSeconds), state.spells]
  );
}

/* ---------- the budget ---------- */

// How far through the month we are, as a fraction. Never zero: on the first of
// the month at one minute past midnight, dividing by it would say the year's
// compute is already gone.
function monthGone() {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.max(0.02, (now.getTime() - start) / (end - start));
}

function daysLeft() {
  const now = new Date();
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.max(0.25, (end - now.getTime()) / (24 * 60 * MIN));
}

// What one sweep costs, and what the sweeps have cost so far.
//
// The month's total cannot be split by asking the database - a query does not
// say who sent it - so the background work measures itself. A sweep that
// begins while the database is asleep pays for the wake-up and the five idle
// minutes that follow it; one that begins while somebody is already working in
// the app pays only for its own minutes, because the database was up anyway
// and would have stayed up.
const sweepCost = { minutes: 1.5, seen: 0 };

export function beginBackground() {
  return { at: Date.now(), wasAsleep: !awake() };
}

export function endBackground(mark) {
  if (!mark) return;
  const ran = Math.max(0, Date.now() - mark.at);
  const mins = Math.max(0.2, ran / MIN);

  sweepCost.seen++;
  // a running average, weighted towards what just happened
  sweepCost.minutes = sweepCost.seen === 1 ? mins : (sweepCost.minutes * 2 + mins) / 3;

  state.bgSeconds += Math.round((ran + (mark.wasAsleep ? IDLE : 0)) / 1000);
  state.dirty = true;
}

export function backgroundHoursUsed() {
  return state.bgSeconds / 3600;
}

function costPerSweep() {
  return sweepCost.minutes + IDLE / MIN;
}

// What the background is allowed this month. Its own share of the allowance,
// and less than that when the month as a whole is heading over: people using
// the app is the thing that must not run out, so the sweep is what gives way.
function backgroundBudget() {
  const projected = usedHours() / monthGone();
  const headroom = projected > ALLOWANCE ? ALLOWANCE / projected : 1;
  return ALLOWANCE * SHARE * headroom;
}

// The number the sweep actually asks for: how many minutes to wait before the
// next one. Worked out from what is left of the month, not from a constant.
//
//  - what the background is allowed this month  = allowance x share
//  - what it has left                           = that, less what it has spent
//  - how many sweeps that buys                  = left / cost of one sweep
//  - spread over the days remaining             = the gap
//
// `hooked` is the saving the webhooks buy. When every account is being told
// its statuses as they happen, the sweep is no longer how anybody finds out a
// parcel was delivered - it is there for the money side and for whatever the
// courier never called about. Once every few hours is plenty, and that is most
// of the month's compute handed back.
export function nextGapMinutes(opts) {
  const o = opts || {};
  if (usedHours() >= ALLOWANCE * STOP_AT) return CEIL;

  const left = Math.max(0, backgroundBudget() - backgroundHoursUsed());
  const sweeps = (left * 60) / costPerSweep();
  const perDay = sweeps / daysLeft();

  const gap = perDay > 0 ? (24 * 60) / perDay : CEIL;

  // A hooked account needs the sweep only for settlement and for what no
  // webhook mentioned, so its floor is a few hours rather than half an hour.
  const floor = o.hooked
    ? Math.max(FLOOR, Math.max(60, Number(process.env.KEEPER_HOOKED_MINUTES) || 360))
    : FLOOR;

  return Math.round(Math.min(CEIL, Math.max(floor, gap)));
}

// Whether the quiet work may run at all. Said as a sentence, because the page
// shows it and "false" explains nothing.
export function mayRun() {
  const used = usedHours();
  if (used >= ALLOWANCE * STOP_AT) {
    return {
      ok: false,
      why: 'This month’s database allowance is nearly spent (' +
           used.toFixed(1) + ' of ' + ALLOWANCE + ' hours), so the background ' +
           'sweep is holding off until the 1st. Webhooks still arrive, and ' +
           'Pull orders still works whenever you ask for it.'
    };
  }
  return { ok: true, why: '' };
}

// Everything the Database screen shows.
export function computeState() {
  const used = usedHours();
  const gone = monthGone();
  const projected = used / gone;

  return {
    month: state.month,
    usedHours: Math.round(used * 100) / 100,
    allowanceHours: ALLOWANCE,
    share: SHARE,
    backgroundHours: Math.round(backgroundBudget() * 10) / 10,
    projectedHours: Math.round(projected * 10) / 10,
    monthGone: Math.round(gone * 100) / 100,
    spells: state.spells,
    backgroundUsedHours: Math.round(backgroundHoursUsed() * 100) / 100,
    awake: awake(),
    idleMinutes: IDLE / MIN,
    sweepMinutes: Math.round(sweepCost.minutes * 10) / 10,
    sweepCostMinutes: Math.round(costPerSweep() * 10) / 10,
    gapMinutes: nextGapMinutes({}),
    gapHookedMinutes: nextGapMinutes({ hooked: true }),
    stopAt: Math.round(ALLOWANCE * STOP_AT * 10) / 10,
    holding: !mayRun().ok,
    note: mayRun().why
  };
}

// Last month and the ones before, for the same screen. Cheap: fourteen rows at
// the most, and only asked for when somebody opens the page.
export async function computeHistory() {
  const r = await pool.query(
    `SELECT month, seconds, bg_seconds, spells FROM compute_meter
      ORDER BY month DESC LIMIT 14`);
  return r.rows.map(x => ({
    month: x.month,
    hours: Math.round((Number(x.seconds) / 3600) * 10) / 10,
    sweepHours: Math.round((Number(x.bg_seconds || 0) / 3600) * 10) / 10,
    spells: Number(x.spells)
  }));
}

// Written down on the way out, so a deploy does not lose the month's tally.
export function saveComputeOnExit() {
  ['SIGTERM', 'SIGINT'].forEach(sig => {
    process.once(sig, () => {
      closeSpell();
      flush().catch(() => {}).finally(() => process.exit(0));
    });
  });
}
