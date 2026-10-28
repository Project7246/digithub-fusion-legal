import { pool } from './db.js';
import {
  hrPolicy, cycleOf, monthText, thisMonth, dayText, todayText, eachDay,
  listEmployees, daysOf, dayFigures, lateRuleFor, minutesOf, clockOf
} from './hr.js';
import {
  worksheet, figureAll, explainAll, lateDaysLost, RULE_HEADS, lateRuleNamed
} from './hrrules.js';

// ==================== HR: what the month is worth ====================
//
// This is the salary working, the ledger, the report, the slips and the time
// sheets - the second half of the process the company already runs by hand:
// download the biometric report, work the figures out underneath it, turn that
// into a ledger, send the ledger to the management and a time sheet to each
// person. The system is new; the calculation and the presentation are theirs,
// to the column - "sara kam hu ga standard per but hamri jo reports hy wo hum
// is format mein kry gy".
//
// Every formula below is the formula off their own sheet, and the comment above
// each one is the cell it came out of, so the two can be checked against each
// other rather than taken on trust.

/* ==================== the heads ==================== */
//
// One name per head, spelled the way their sheets spell it, because the same
// word has to appear on the working sheet, the slip, the report and the
// QuickBooks entry. A head that is spelled two ways is two heads.

export const EARN = [
  'Basic Salary', 'Overtime', 'Attendance Bonus', 'Performance Bonus',
  'Parcel / Order Bonus', 'Managerial Allowance', 'Travelling Allowance',
  'Food Allowance', 'Occasional Bonus'
];

export const DEDUCT = [
  'Late Fine', 'Parcel Fine', 'Absent Fine', 'Half Day Fine',
  'Loan Deduction', 'Employee Adjustments'
];

// Money that moved during the month and so is not payable at the end of it.
//
// `Paid During Month` is their own Paid column, and in their ledger it is not a
// figure anybody types: it is every row whose credit side says **Paid** - the
// food allowance handed over in cash as the month goes, plus whatever salary was
// taken in advance. So it is worked out from the heads named in the policy plus
// `Advance Salary Paid`, which mirrors their AI = W + AE exactly, and an import
// of the old ledger writes it straight from those Paid rows.
export const PAID = ['Advance Salary Paid', 'Paid During Month'];

// Said on the report and the slip, and deducted by neither: what the advance
// stands at, and what was bought on the company's account. The recovery of
// them is a Loan Deduction and an Employee Adjustment, which are deductions.
export const INFO = ['Advance', 'Credit Purchase'];

export const HEADS = [...EARN, ...DEDUCT, ...PAID, ...INFO];

// Which heads this app works out for itself, and which are a person's to type.
// A head nobody calculates is not a gap - the performance bonus is decided by
// the management and the travelling allowance is agreed with the person, and
// neither is something a formula should be guessing at.
// Which heads this app works out for itself. **Taken from the rules list**, not
// written out again here - a head on one list and off the other is how a figure
// comes out as nought with nothing to explain it.
//
// A head that is not here is a person's to type: the performance bonus is a
// management decision and the travelling allowance is agreed with the person,
// and neither is something a formula should be guessing at.
export const AUTO_HEADS = [...RULE_HEADS, 'Paid During Month'];

export const HEAD_KIND = {};
EARN.forEach(h => { HEAD_KIND[h] = 'earn'; });
DEDUCT.forEach(h => { HEAD_KIND[h] = 'deduct'; });
PAID.forEach(h => { HEAD_KIND[h] = 'paid'; });
INFO.forEach(h => { HEAD_KIND[h] = 'info'; });

const n2 = v => Math.round((Number(v) || 0) * 100) / 100;
const up = v => Math.ceil(Number(v) || 0);          // their ROUNDUP, to whole rupees

/* ==================== a standing amount ==================== */
//
// Twenty people on the logistics floor are each owed the same food allowance
// every month, and typing it twenty times every month is twenty chances to
// type it wrong. A standing amount is set once on the person and is written
// into every month from then on; a figure typed into the month itself always
// wins over it.
export async function initHrPay() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hr_standing (
      realm_id   TEXT NOT NULL,
      emp_code   TEXT NOT NULL,
      head       TEXT NOT NULL,
      amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
      prorate    BOOLEAN DEFAULT FALSE,
      note       TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (realm_id, emp_code, head)
    )
  `);
  console.log('HR payroll ready');
}

export async function standingOf(realmId, code) {
  const args = [realmId];
  let extra = '';
  if (code) { args.push(String(code)); extra = ' AND emp_code = $2'; }
  const r = await pool.query(
    `SELECT * FROM hr_standing WHERE realm_id = $1${extra} ORDER BY emp_code, head`, args);
  return r.rows;
}

export async function setStanding(realmId, code, head, amount, prorate) {
  if (HEADS.indexOf(head) < 0) return { error: 'That is not a head.' };
  if (AUTO_HEADS.indexOf(head) >= 0) {
    return { error: head + ' is worked out from the attendance, so it cannot be a standing amount.' };
  }
  const amt = Number(amount);
  if (!isFinite(amt)) return { error: 'That is not an amount.' };
  if (!amt) {
    await pool.query(
      `DELETE FROM hr_standing WHERE realm_id = $1 AND emp_code = $2 AND head = $3`,
      [realmId, String(code), head]);
    return { ok: true, removed: true };
  }
  await pool.query(
    `INSERT INTO hr_standing (realm_id, emp_code, head, amount, prorate)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (realm_id, emp_code, head) DO UPDATE SET
       amount = $4, prorate = $5, updated_at = NOW()`,
    [realmId, String(code), head, n2(amt), !!prorate]);
  return { ok: true };
}

/* ==================== the month itself ==================== */

// Is this month finished with?
//
// **A month that has been signed off is the month, for ever.** Until then every
// screen works the figures out again from the attendance, the pools and the
// policy, which is what makes the working a working. The moment it is signed
// off that has to stop: a policy changed in November cannot be allowed to move
// October's slips, and an employee opening last March must see what they were
// actually paid in March.
//
// So from `approved` onwards the stored lines **are** the answer and nothing
// recalculates. That is what "final and submit" means here.
export function isFinal(run) {
  return !!run && (run.state === 'approved' || run.state === 'posted');
}

export function whyShut(run) {
  if (!run) return null;
  if (run.state === 'posted') {
    return 'That month is in QuickBooks as ' + (run.qb_doc_number || 'an entry') +
           '. Nothing in it can change.';
  }
  if (run.state === 'approved') {
    return 'That month has been signed off, so its figures are fixed. ' +
           'Reopen it if something in it has to change.';
  }
  return null;
}

// A month, read. It does **not** write one: every screen that shows figures
// calls workingOf(), and workingOf() asks for the run - so an upsert here was a
// write on every page open, which on Neon is a database kept awake by people
// reading. The row is made only when something actually happens to the month.
export async function runOf(realmId, month, make) {
  const m = monthText(month);
  if (!m) return null;
  const r = await pool.query(
    `SELECT * FROM hr_pay_runs WHERE realm_id = $1 AND month = $2`, [realmId, m]);
  if (r.rowCount) return r.rows[0];
  if (!make) {
    // A month nobody has touched is open, with nobody's approval on it. That is
    // the truth about it, and it needs no row to say so.
    return { realm_id: realmId, month: m, state: 'open', approvals: [],
             qb_journal_id: null, qb_doc_number: null, posted_at: null,
             figured_at: null, note: null };
  }
  const made = await pool.query(
    `INSERT INTO hr_pay_runs (realm_id, month) VALUES ($1,$2)
     ON CONFLICT (realm_id, month) DO UPDATE SET updated_at = NOW() RETURNING *`,
    [realmId, m]);
  return made.rows[0];
}

export async function listRuns(realmId, limit) {
  const r = await pool.query(
    `SELECT * FROM hr_pay_runs WHERE realm_id = $1 ORDER BY month DESC LIMIT $2`,
    [realmId, Number(limit) || 24]);
  return r.rows;
}

// The three who approve. The month is theirs to sign off and nothing is posted
// to QuickBooks until they have - "is pory project ky final approval authority
// in 3 ky pass hti hy".
export async function approveMonth(realmId, month, who, policy) {
  const run = await runOf(realmId, month, true);
  if (!run) return { error: 'That is not a month.' };
  if (run.state === 'posted') return { error: 'That month is already in QuickBooks.' };
  // Signing off freezes the stored lines, so a month nobody has worked out
  // would be frozen at nothing at all. That is the one thing this must refuse.
  const has = await pool.query(
    `SELECT 1 FROM hr_pay_lines WHERE realm_id = $1 AND month = $2 LIMIT 1`,
    [realmId, run.month]);
  if (!has.rowCount) {
    return { error: 'There is nothing in that month yet. Press ' +
                    '"Work the month out" first, then sign it off.' };
  }

  const need = ((policy && policy.approvers) || []).length;
  const list = Array.isArray(run.approvals) ? run.approvals.slice() : [];
  const me = String((who && (who.email || who.sub)) || '').toLowerCase();
  if (!me) return { error: 'Who is approving?' };
  if (list.some(a => String(a.who).toLowerCase() === me)) {
    return { ok: true, already: true, run };
  }
  list.push({ who: me, at: new Date().toISOString() });
  const enough = need ? list.length >= need : true;
  const r = await pool.query(
    `UPDATE hr_pay_runs SET approvals = $3::jsonb, state = $4, updated_at = NOW()
      WHERE realm_id = $1 AND month = $2 RETURNING *`,
    [realmId, run.month, JSON.stringify(list), enough ? 'approved' : 'open']);
  return { ok: true, run: r.rows[0], waiting: Math.max(0, need - list.length) };
}

export async function reopenMonth(realmId, month) {
  const run = await runOf(realmId, month, true);
  if (!run) return { error: 'That is not a month.' };
  if (run.state === 'posted') {
    return { error: 'That month is in QuickBooks. Undo it there first, then reopen it here.' };
  }
  const r = await pool.query(
    `UPDATE hr_pay_runs SET state = 'open', approvals = '[]'::jsonb, updated_at = NOW()
      WHERE realm_id = $1 AND month = $2 RETURNING *`, [realmId, run.month]);
  return { ok: true, run: r.rows[0] };
}

/* ==================== the pools ==================== */
//
// The parcel bonus, the parcel fine and the order bonus. The shape of each is
// theirs - a slab table, a fine table, a brand table - and so is the choice of
// who shares in it. Fusion works the arithmetic and nothing else: "tm srf wo
// main calculation bna dena hum value khud bana kr daal dein gy, or selection
// hu kis ko dena hy kis ko ni dena, ye hamari choice apni hoti hai".

export const POOL_KINDS = ['parcel', 'parcelfine', 'order'];

export const POOL_BLANK = {
  // Logistics: parcels carried in the month, charged in slabs
  parcel: {
    label: 'Parcel bonus',
    sources: [{ name: 'PC', count: 0 }, { name: 'MR', count: 0 }],
    slabs: [{ upto: 6000, rate: 1.5 }, { upto: null, rate: 2 }],
    persons: []
  },
  // Logistics: what went wrong, and half of it shared out
  parcelfine: {
    label: 'Parcel fine',
    cats: [{ name: 'Damaged', count: 0, rate: 500 },
           { name: 'Missing', count: 0, rate: 250 },
           { name: 'Wrong', count: 0, rate: 250 }],
    share: 0.5,
    persons: []
  },
  // CSR: a percentage of what each brand sold
  order: {
    label: 'Order bonus',
    brands: [{ name: '', orders: 0, amount: 0 }],
    rate: 0.02,
    persons: []
  }
};

export async function poolsOf(realmId, month) {
  const m = monthText(month);
  const r = await pool.query(
    `SELECT kind, data FROM hr_pools WHERE realm_id = $1 AND month = $2`, [realmId, m]);
  const out = {};
  POOL_KINDS.forEach(k => { out[k] = JSON.parse(JSON.stringify(POOL_BLANK[k])); });
  r.rows.forEach(row => {
    if (out[row.kind]) out[row.kind] = Object.assign(out[row.kind], row.data || {});
  });
  POOL_KINDS.forEach(k => { out[k].figures = figurePool(k, out[k]); });
  return out;
}

export async function savePool(realmId, month, kind, data) {
  const m = monthText(month);
  if (!m) return { error: 'That is not a month.' };
  if (POOL_KINDS.indexOf(kind) < 0) return { error: 'That is not a pool.' };
  const shut = whyShut(await runOf(realmId, m));
  if (shut) return { error: shut };
  const clean = Object.assign(JSON.parse(JSON.stringify(POOL_BLANK[kind])), data || {});
  clean.persons = (clean.persons || []).map(String);
  await pool.query(
    `INSERT INTO hr_pools (realm_id, month, kind, data) VALUES ($1,$2,$3,$4)
     ON CONFLICT (realm_id, month, kind) DO UPDATE SET data = $4, updated_at = NOW()`,
    [realmId, m, kind, JSON.stringify(clean)]);
  return { ok: true, figures: figurePool(kind, clean) };
}

// The arithmetic of one pool, and it is shown as a chain rather than a figure,
// so it can be argued with: how many, at what rate, between how many people.
export function figurePool(kind, d) {
  const people = (d.persons || []).length;

  if (kind === 'parcel') {
    // Salary Working F1056:I1058 - 0 to 6000 at 1.5, above 6000 at 2
    const count = (d.sources || []).reduce((a, s) => a + (Number(s.count) || 0), 0);
    let left = count, done = 0, total = 0;
    const slabs = [];
    (d.slabs || []).forEach(s => {
      const upto = s.upto == null || s.upto === '' ? null : Number(s.upto);
      const take = upto == null ? left : Math.max(0, Math.min(left, upto - done));
      const amount = take * (Number(s.rate) || 0);
      slabs.push({ from: done, upto, rate: Number(s.rate) || 0, parcels: take, amount: n2(amount) });
      total += amount;
      left -= take;
      done += take;
    });
    return {
      count, slabs, total: n2(total), people,
      // I1062 =ROUNDUP(I1058/I1061,0)
      each: people ? up(total / people) : 0
    };
  }

  if (kind === 'parcelfine') {
    // Salary Working K1055:N1062 - each category counted at its own rate,
    // then N1060/N1062 halve it per person
    const cats = (d.cats || []).map(c => ({
      name: c.name, count: Number(c.count) || 0, rate: Number(c.rate) || 0,
      amount: n2((Number(c.count) || 0) * (Number(c.rate) || 0))
    }));
    const total = cats.reduce((a, c) => a + c.amount, 0);
    const share = d.share == null ? 0.5 : Number(d.share);
    return {
      cats, total: n2(total), share, people,
      // N1062 =ROUNDUP((N1059/N1061)/2,0)
      each: people ? up((total / people) * share) : 0
    };
  }

  // order: Salary Working S1056:W1059 - each brand's sales at the rate,
  // then divided between the people
  const rate = d.rate == null ? 0.02 : Number(d.rate);
  const brands = (d.brands || []).map(b => ({
    name: b.name, orders: Number(b.orders) || 0, amount: n2(Number(b.amount) || 0),
    bonus: n2((Number(b.amount) || 0) * rate)
  }));
  const total = brands.reduce((a, b) => a + b.bonus, 0);
  const orders = brands.reduce((a, b) => a + b.orders, 0);
  return {
    brands, orders, rate, total: n2(total), people,
    // W1057 =V1057/6 and W1059 the sum of them - not rounded
    each: people ? n2(total / people) : 0
  };
}

/* ==================== how many days somebody was here ==================== */
//
// Their No. of Working Days is not the length of the cycle: a cycle of 31 days
// is written as 30, because 30 is the divisor every per-day rate uses, and a
// person who joined on the 7th is written as the days from the 7th. So it is
// the calendar days they were on the payroll inside the cycle, and never more
// than the month's own 30.
export function workDaysOf(emp, cycle, monthDays) {
  const from = emp.joined_on && emp.joined_on > cycle.from ? emp.joined_on : cycle.from;
  const to = emp.left_on && emp.left_on < cycle.to ? emp.left_on : cycle.to;
  if (to < from) return 0;
  let n = 0;
  for (const d of eachDay(from, to)) { n++; if (d >= to) break; }
  return Math.min(n, Number(monthDays) || 30);
}

/* ==================== the working ==================== */
//
// One row per employee, and every column on their own Salary Working sheet, in
// its order. This is the sheet the figures are checked on before anything is
// sent anywhere, so it shows the counts it worked from beside the money it
// worked out - a column of figures nobody can open into its days is a column
// nobody trusts.

export async function workingOf(realmId, month) {
  const policy = await hrPolicy(realmId);
  const m = monthText(month) || thisMonth();
  const cycle = cycleOf(m, policy);
  const run = await runOf(realmId, m);

  const everyone = await listEmployees(realmId, { all: true });
  // Somebody who left before this cycle began is not on this month's payroll;
  // somebody who left inside it is, for the days they were here.
  const people = everyone.filter(e =>
    (!e.joined_on || e.joined_on <= cycle.to) &&
    (!e.left_on || e.left_on >= cycle.from));

  const days = await daysOf(realmId, cycle.from, cycle.to);
  const byCode = new Map();
  days.forEach(d => {
    const list = byCode.get(d.emp_code) || [];
    list.push(d);
    byCode.set(d.emp_code, list);
  });

  const facts = await monthFacts(realmId, m);
  const standing = await standingOf(realmId);
  const lines = await linesOf(realmId, m);
  const pools = await poolsOf(realmId, m);

  const standingBy = new Map();
  standing.forEach(s => {
    const o = standingBy.get(s.emp_code) || {};
    o[s.head] = s;
    standingBy.set(s.emp_code, o);
  });
  const lineBy = new Map();
  lines.forEach(l => {
    const o = lineBy.get(l.emp_code) || {};
    o[l.head] = l;
    lineBy.set(l.emp_code, o);
  });

  const mdays = Number(policy.monthDays) || 30;
  const dutyMin = Number(policy.dutyMinutes) || 480;
  // signed off, so the stored figures are the month and nothing is worked out
  // over the top of them
  const frozen = isFinal(run);

  const rows = people.map(emp => {
    const code = String(emp.emp_code);
    const mine = byCode.get(code) || [];
    const f = facts.get(code) || {};
    const held = lineBy.get(code) || {};
    const stand = standingBy.get(code) || {};

    const basic = f.basic != null ? Number(f.basic) : Number(emp.basic) || 0;
    const workDays = f.work_days != null
      ? Number(f.work_days)
      : workDaysOf(emp, cycle, mdays);

    // the counts, straight off the days
    let otMin = 0, lateMin = 0, lateDays = 0;
    // Every status there is. A status missing from this object is a day that
    // would be counted as nothing at all, silently.
    const count = { present: 0, late: 0, absent: 0, leave: 0, half: 0, ahalf: 0,
                    wfh: 0, holiday: 0, weekend: 0, pending: 0, thirdparty: 0 };
    mine.forEach(d => {
      const g = dayFigures(d, policy, emp);
      otMin += g.ot;
      lateMin += g.late;
      if (g.lateDay) lateDays++;
      if (count[d.status] != null) count[d.status]++;
    });

    // Who is paid overtime and who gets the regular bonus is a department's
    // business, set in the policy, overridable per person.
    const otAllowed = emp.ot_allowed != null
      ? !!emp.ot_allowed
      : (policy.otDepts || []).some(x => sameWord(x, emp.department));
    const bonusAllowed = !(policy.noBonusDepts || []).some(x => sameWord(x, emp.department));
    const lateRule = lateRuleFor(policy, emp);
    const inPool = (which) =>
      (pools[which].persons || []).map(String).indexOf(code) >= 0;

    // Everything a rule is allowed to see, with every name the plain word for
    // the thing. One object, built here, read by `hrrules.js`.
    const sheet = worksheet({
      basic,
      monthDays: mdays,
      workDays,
      dutyMinutes: dutyMin,
      lateMinutes: lateMin,
      lateDays,
      overtimeMinutes: otMin,
      absentDays: count.absent,
      halfDays: count.half,
      approvedHalfDays: count.ahalf,
      leaveDays: count.leave,
      overtimePaid: otAllowed,
      bonusPaid: bonusAllowed,
      lateRule,
      extraOvertimeDays: Number(f.ot_extra_days) || 0,
      parcelBonusShare: inPool('parcel') ? pools.parcel.figures.each : 0,
      orderBonusShare: inPool('order') ? pools.order.figures.each : 0,
      parcelFineShare: inPool('parcelfine') ? pools.parcelfine.figures.each : 0,
      latePer: policy.latePer,
      halfDayFine: policy.halfDayFine
    });

    // **Every rule gives a positive amount, and the head's kind decides the
    // sign** - in one place, here. Their sheet writes a minus inside some of
    // its fine formulas and not others, which is how a fine is taken off on one
    // row and added on the next; there is nowhere for that to happen now.
    const auto = {};
    const figured = figureAll(sheet);
    Object.keys(figured).forEach(head => {
      auto[head] = HEAD_KIND[head] === 'deduct'
        ? n2(-Math.abs(figured[head]))
        : n2(figured[head]);
    });

    // A standing amount is not a rule - it is a figure set once on the person
    // (the logistics floor's food allowance) and written into every month after,
    // shared over the days they were actually here where it is set to be.
    Object.keys(stand).forEach(head => {
      const st = stand[head];
      const amt = Number(st.amount) || 0;
      auto[head] = n2(st.prorate && mdays ? (amt / mdays) * workDays : amt);
    });

    // What is actually on the ledger.
    //
    // Two different months, two different answers, and the run's state is what
    // decides which:
    //
    //   open     the figures are worked out again every time this is read, so
    //            approving a leave or fixing a clock-in shows up at once. A
    //            figure somebody typed is still theirs and is never moved.
    //   final    the stored lines are the month. Nothing is recalculated, so
    //            next year's policy cannot move last year's slips.
    const amount = {};
    const onLedger = h => {
      const l = held[h];
      if (frozen) return l ? Number(l.amount) || 0 : 0;
      if (l && l.source !== 'auto') return Number(l.amount) || 0;
      if (auto[h] !== undefined) return auto[h];
      return l ? Number(l.amount) || 0 : 0;
    };
    HEADS.forEach(h => { if (h !== 'Paid During Month') amount[h] = onLedger(h); });

    // And the one head worked out from the others, so it has to come last.
    auto['Paid During Month'] = n2(paidDuring(policy)
      .reduce((a, h) => a + Math.abs(amount[h] || 0), 0));
    amount['Paid During Month'] = Math.abs(onLedger('Paid During Month'));

    const earn = EARN.reduce((a, h) => a + (amount[h] || 0), 0);
    const ded = DEDUCT.reduce((a, h) => a + (amount[h] || 0), 0);
    const paid = amount['Paid During Month'];

    return {
      code, name: emp.name, department: emp.department || '',
      designation: emp.designation || '', grade: emp.grade || '',
      joined: emp.joined_on || '', left: emp.left_on || '',
      status: emp.status || 'working',
      payMode: f.pay_mode || emp.pay_mode || 'bank',
      bank: emp.bank_account || '',
      virtual: !!emp.virtual,

      basic: n2(basic), workDays, monthDays: mdays,
      otMin, lateMin, lateDays, lateCut: lateDaysLost(sheet),
      extraDays: sheet.extraOvertimeDays,
      absent: count.absent, half: count.half, ahalf: count.ahalf,
      leaves: count.leave, present: count.present, wfh: count.wfh,
      holiday: count.holiday, pending: count.pending,
      otAllowed, bonusAllowed,
      lateRule, lateRuleName: lateRuleNamed(lateRule).name,

      auto, amount,
      // Each rule's own arithmetic, in words, with this person's numbers in it.
      // A figure nobody can see the sum behind is a figure nobody can argue
      // with - and a payroll is argued with every month.
      why: explainAll(sheet),
      // Which heads the calculation is not allowed to touch, and which of those
      // a person typed as against which came out of the old sheet - the screen
      // says so, because "this is your figure" and "this is last year's book"
      // are two different things to be looking at.
      hand: Object.keys(held).filter(h => held[h].source !== 'auto'),
      typed: Object.keys(held).filter(h => held[h].source === 'hand'),
      imported: Object.keys(held).filter(h => held[h].source === 'import'),

      earn: n2(earn), deduct: n2(ded), paid: n2(paid),
      // Report C5 =Q5+Y5 - the salary less what was taken off it
      net: n2(earn + ded),
      // Report E5 =Q5+SUM(T5:X5)-D5 - and less what was already handed over
      payable: n2(earn + ded - paid)
    };
  });

  rows.sort((a, b) => (a.department || '').localeCompare(b.department || '') ||
                      String(a.code).localeCompare(String(b.code)));

  return { month: m, cycle, policy, run, pools, rows, frozen,
           shut: whyShut(run), totals: totalsOf(rows) };
}

function paidDuring(policy) {
  const named = Array.isArray(policy && policy.paidDuringMonth)
    ? policy.paidDuringMonth : ['Food Allowance'];
  return [...new Set([...named, 'Advance Salary Paid'])];
}

function sameWord(a, b) {
  const n = s => String(s || '').trim().toLowerCase().replace(/s$/, '');
  return !!a && n(a) === n(b);
}

function totalsOf(rows) {
  const t = { people: rows.length, earn: 0, deduct: 0, paid: 0, net: 0, payable: 0,
              bank: 0, cash: 0, heads: {} };
  HEADS.forEach(h => { t.heads[h] = 0; });
  rows.forEach(r => {
    t.earn += r.earn; t.deduct += r.deduct; t.paid += r.paid;
    t.net += r.net; t.payable += r.payable;
    if (r.payMode === 'cash') t.cash += r.payable; else t.bank += r.payable;
    HEADS.forEach(h => { t.heads[h] += (r.amount[h] || 0); });
  });
  ['earn', 'deduct', 'paid', 'net', 'payable', 'bank', 'cash'].forEach(k => { t[k] = n2(t[k]); });
  HEADS.forEach(h => { t.heads[h] = n2(t.heads[h]); });
  return t;
}

/* ==================== the ledger ==================== */

export async function linesOf(realmId, month, code) {
  const m = monthText(month);
  const args = [realmId, m];
  let extra = '';
  if (code) { args.push(String(code)); extra = ' AND emp_code = $3'; }
  const r = await pool.query(
    `SELECT * FROM hr_pay_lines WHERE realm_id = $1 AND month = $2${extra}
      ORDER BY emp_code, head`, args);
  return r.rows;
}

// Writing the month down. The calculated heads are written as 'auto' and a head
// somebody typed is left exactly as it is - so figuring the month again after a
// leave is approved does not throw away an evening's typing.
export async function figureMonth(realmId, month) {
  const w = await workingOf(realmId, month);
  const shut = whyShut(w.run);
  if (shut) return { error: shut };

  // Working the month out is the first thing that happens to it, so this is
  // where the run row is made.
  await runOf(realmId, w.month, true);

  const client = await pool.connect();
  let wrote = 0, kept = 0;
  try {
    await client.query('BEGIN');
    for (const r of w.rows) {
      for (const head of HEADS) {
        const isAuto = r.auto[head] !== undefined;
        if (!isAuto) continue;
        // typed, or brought in from the old sheet: either way not ours to move
        if (r.hand.indexOf(head) >= 0) { kept++; continue; }
        const amt = n2(r.auto[head]);
        if (!amt) {
          await client.query(
            `DELETE FROM hr_pay_lines
              WHERE realm_id = $1 AND month = $2 AND emp_code = $3 AND head = $4
                AND source = 'auto'`, [realmId, w.month, r.code, head]);
          continue;
        }
        await client.query(
          `INSERT INTO hr_pay_lines (realm_id, month, emp_code, head, amount, source)
           VALUES ($1,$2,$3,$4,$5,'auto')
           ON CONFLICT (realm_id, month, emp_code, head) DO UPDATE SET
             amount = $5, source = 'auto', updated_at = NOW()
             WHERE hr_pay_lines.source = 'auto'`,
          [realmId, w.month, r.code, head, amt]);
        wrote++;
      }
    }
    await client.query(
      `UPDATE hr_pay_runs SET figured_at = NOW(), updated_at = NOW()
        WHERE realm_id = $1 AND month = $2`, [realmId, w.month]);
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* over anyway */ }
    throw e;
  } finally {
    client.release();
  }

  return { ok: true, month: w.month, people: w.rows.length, wrote, kept,
           totals: w.totals };
}

// One figure, typed by a person. It stays until they change it or clear it.
export async function setLine(realmId, month, code, head, amount, note) {
  const m = monthText(month);
  if (!m) return { error: 'That is not a month.' };
  if (HEADS.indexOf(head) < 0) return { error: 'That is not a head.' };
  const run = await runOf(realmId, m);
  const shut = whyShut(run);
  if (shut) return { error: shut };


  if (amount === '' || amount === null) {
    await pool.query(
      `DELETE FROM hr_pay_lines
        WHERE realm_id = $1 AND month = $2 AND emp_code = $3 AND head = $4`,
      [realmId, m, String(code), head]);
    return { ok: true, cleared: true };
  }
  const amt = Number(amount);
  if (!isFinite(amt)) return { error: 'That is not an amount.' };
  // A deduction is a deduction whichever way it was typed: the sheet keeps them
  // negative, and a positive late fine on one row and a negative one on another
  // is a total nobody can read.
  const kind = HEAD_KIND[head];
  const value = kind === 'deduct' ? -Math.abs(amt) : (kind === 'earn' ? Math.abs(amt) : amt);
  await pool.query(
    `INSERT INTO hr_pay_lines (realm_id, month, emp_code, head, amount, source, note)
     VALUES ($1,$2,$3,$4,$5,'hand',$6)
     ON CONFLICT (realm_id, month, emp_code, head) DO UPDATE SET
       amount = $5, source = 'hand', note = $6, updated_at = NOW()`,
    [realmId, m, String(code), head, n2(value), note || null]);
  return { ok: true, amount: n2(value) };
}

export async function monthFacts(realmId, month) {
  const m = monthText(month);
  const r = await pool.query(
    `SELECT * FROM hr_month_facts WHERE realm_id = $1 AND month = $2`, [realmId, m]);
  const out = new Map();
  r.rows.forEach(x => out.set(String(x.emp_code), x));
  return out;
}

export async function setFacts(realmId, month, code, body) {
  const m = monthText(month);
  if (!m) return { error: 'That is not a month.' };
  const shut = whyShut(await runOf(realmId, m));
  if (shut) return { error: shut };
  const num = v => (v === '' || v == null ? null : Number(v));
  await pool.query(
    `INSERT INTO hr_month_facts
       (realm_id, month, emp_code, work_days, ot_extra_days, basic, pay_mode, note)
     VALUES ($1,$2,$3,$4,COALESCE($5,0),$6,$7,$8)
     ON CONFLICT (realm_id, month, emp_code) DO UPDATE SET
       work_days     = COALESCE($4, hr_month_facts.work_days),
       ot_extra_days = COALESCE($5, hr_month_facts.ot_extra_days),
       basic         = COALESCE($6, hr_month_facts.basic),
       pay_mode      = COALESCE($7, hr_month_facts.pay_mode),
       note          = COALESCE($8, hr_month_facts.note),
       updated_at    = NOW()`,
    [realmId, m, String(code), num(body.work_days), num(body.ot_extra_days),
     num(body.basic), body.pay_mode || null, body.note || null]);
  return { ok: true };
}

// The ledger as their workbook keeps it: date, month, employee, head, the side
// it falls on, and the amount. This is what goes to the management and what
// QuickBooks is built from, and it is one row per figure so nothing is hidden
// inside a subtotal.
export async function ledgerOf(realmId, month) {
  const w = await workingOf(realmId, month);
  const rows = [];
  w.rows.forEach(r => {
    HEADS.forEach(h => {
      const amt = r.amount[h] || 0;
      if (!amt) return;
      const kind = HEAD_KIND[h];
      rows.push({
        day: w.cycle.to, month: w.month,
        employee: r.name + ' (' + r.code + ')', code: r.code,
        department: r.department,
        head: h, kind,
        side: kind === 'earn' ? 'Payable' : kind === 'deduct' ? 'Receivable' : 'Information',
        amount: amt
      });
    });
  });
  return { month: w.month, cycle: w.cycle, rows, totals: w.totals };
}

/* ==================== the report the management gets ==================== */
//
// "Salary Summary For The Month Of September-2026", column for column: the net,
// what was paid during the month, what is payable, split between bank and cash,
// then every salary head, then the fines and deductions, then the total. The
// one thing this does that the working sheet does not is roll the half-day fine
// into the absent fine, because that is how their own report prints it and the
// two have to tie.

export const REPORT_EARN = EARN;
export const REPORT_DEDUCT = ['Late Fine', 'Parcel Fine', 'Absent Fine',
                              'Loan Deduction', 'Employee Adjustments'];

/* ---------- the advance and the credit purchase are balances ---------- */
//
// These two are not the month's own figures and were wrong as such. On their
// report they are **running balances**, and the formula says so:
//
//   Advance         = every advance up to and including this month
//                     less every loan deduction in the months before it
//   Credit Purchase = every credit purchase up to and including this month
//                     less every employee adjustment in the months before it
//
// So they answer "what does this person still owe", which is why a slip can
// show an advance of fifty thousand against a ten thousand deduction in the
// same month. Worked out from the
// ledger rather than stored, because a balance that is stored is a balance that
// goes out of date the moment anything behind it changes.
export async function balancesOf(realmId, month) {
  const m = monthText(month);
  const out = new Map();
  if (!m) return out;
  const r = await pool.query(
    `SELECT emp_code, head, month, SUM(amount) AS amt
       FROM hr_pay_lines
      WHERE realm_id = $1 AND month <= $2
        AND head IN ('Advance', 'Credit Purchase', 'Loan Deduction',
                     'Employee Adjustments')
      GROUP BY emp_code, head, month`, [realmId, m]);

  const got = new Map();
  r.rows.forEach(x => {
    const o = got.get(x.emp_code) ||
      { advance: 0, credit: 0, loanBefore: 0, adjBefore: 0 };
    const a = Number(x.amt) || 0;
    if (x.head === 'Advance') o.advance += a;
    else if (x.head === 'Credit Purchase') o.credit += a;
    else if (x.month < m) {
      // only the months **before** this one, which is what their "<" does
      if (x.head === 'Loan Deduction') o.loanBefore += Math.abs(a);
      else o.adjBefore += Math.abs(a);
    }
    got.set(x.emp_code, o);
  });

  got.forEach((o, code) => out.set(String(code), {
    advance: n2(o.advance - o.loanBefore),
    credit: n2(o.credit - o.adjBefore)
  }));
  return out;
}

function reportRow(r, bal) {
  const b = bal || { advance: 0, credit: 0 };
  const d = {};
  REPORT_DEDUCT.forEach(h => { d[h] = r.amount[h] || 0; });
  // their Absent Fine column carries the half days too
  d['Absent Fine'] = n2((r.amount['Absent Fine'] || 0) + (r.amount['Half Day Fine'] || 0));
  const total = REPORT_DEDUCT.reduce((a, h) => a + d[h], 0);
  return {
    code: r.code, name: r.name + ' (' + r.code + ')', department: r.department,
    net: r.net, paid: r.paid, payable: r.payable,
    bank: r.payMode === 'cash' ? 0 : r.payable,
    cash: r.payMode === 'cash' ? r.payable : 0,
    earn: REPORT_EARN.reduce((o, h) => { o[h] = r.amount[h] || 0; return o; }, {}),
    totalSalary: r.earn,
    advance: b.advance || 0,
    credit: b.credit || 0,
    deduct: d, totalDeduct: n2(total)
  };
}

// Their report splits the staff from the management and subtotals each, because
// two of the forty-four rows are the directors and a staff cost that includes
// them answers no question anybody asks.
export async function reportOf(realmId, month) {
  const w = await workingOf(realmId, month);
  const policy = w.policy;
  const mgmt = (policy.managementDepts || ['Management']).map(x => String(x).toLowerCase());
  const isMgmt = r => mgmt.indexOf(String(r.department || '').toLowerCase()) >= 0;

  const bal = await balancesOf(realmId, w.month);
  const staff = w.rows.filter(r => !isMgmt(r)).map(r => reportRow(r, bal.get(r.code)));
  const management = w.rows.filter(isMgmt).map(r => reportRow(r, bal.get(r.code)));

  return {
    month: w.month, cycle: w.cycle, run: w.run,
    heads: REPORT_EARN, deducts: REPORT_DEDUCT,
    staff, management,
    subtotal: { staff: sumReport(staff), management: sumReport(management) },
    total: sumReport([...staff, ...management])
  };
}

function sumReport(rows) {
  const t = { people: rows.length, net: 0, paid: 0, payable: 0, bank: 0, cash: 0,
              totalSalary: 0, advance: 0, credit: 0, totalDeduct: 0,
              earn: {}, deduct: {} };
  REPORT_EARN.forEach(h => { t.earn[h] = 0; });
  REPORT_DEDUCT.forEach(h => { t.deduct[h] = 0; });
  rows.forEach(r => {
    ['net', 'paid', 'payable', 'bank', 'cash', 'totalSalary', 'advance', 'credit',
     'totalDeduct'].forEach(k => { t[k] += r[k] || 0; });
    REPORT_EARN.forEach(h => { t.earn[h] += r.earn[h] || 0; });
    REPORT_DEDUCT.forEach(h => { t.deduct[h] += r.deduct[h] || 0; });
  });
  ['net', 'paid', 'payable', 'bank', 'cash', 'totalSalary', 'advance', 'credit',
   'totalDeduct'].forEach(k => { t[k] = n2(t[k]); });
  REPORT_EARN.forEach(h => { t.earn[h] = n2(t.earn[h]); });
  REPORT_DEDUCT.forEach(h => { t.deduct[h] = n2(t.deduct[h]); });
  return t;
}

/* ==================== the slip each person gets ==================== */
//
// Their slip, line for line: the salary heads down the left, the deductions
// down the middle with the advance and the credit purchase stated but not
// taken off, and on the right the gross, what was deducted, and the net
// payable. Income Tax and EOBI are on the printed slip with nothing against
// them, so they are here with nothing against them: a slip that quietly drops
// a line is a slip somebody has to ask about.

export const SLIP_DEDUCT = ['Advance', 'Credit Purchase', 'Loan Deduction',
                            'Late Fine', 'Parcel Fine', 'Absent Fine',
                            'Employee Adjustments'];

export async function slipsOf(realmId, month, code) {
  const w = await workingOf(realmId, month);
  const rows = code ? w.rows.filter(r => String(r.code) === String(code)) : w.rows;
  const people = await listEmployees(realmId, { all: true });
  const by = new Map(people.map(p => [String(p.emp_code), p]));
  const bal = await balancesOf(realmId, w.month);

  return {
    month: w.month, cycle: w.cycle, run: w.run,
    slips: rows.map(r => {
      const emp = by.get(r.code) || {};
      const b = bal.get(r.code) || { advance: 0, credit: 0 };
      const d = {};
      SLIP_DEDUCT.forEach(h => { d[h] = r.amount[h] || 0; });
      d['Advance'] = b.advance;
      d['Credit Purchase'] = b.credit;
      d['Absent Fine'] = n2((r.amount['Absent Fine'] || 0) + (r.amount['Half Day Fine'] || 0));
      // the advance and the credit purchase are said, not deducted
      const net = n2(['Loan Deduction', 'Late Fine', 'Parcel Fine', 'Absent Fine',
                      'Employee Adjustments'].reduce((a, h) => a + d[h], 0));
      return {
        code: r.code, name: r.name, department: r.department,
        designation: emp.designation || '', grade: emp.grade || '',
        joined: emp.joined_on || '',
        earn: EARN.reduce((o, h) => { o[h] = r.amount[h] || 0; return o; }, {}),
        totalSalary: r.earn,
        deduct: d, netDeduct: net,
        paid: r.paid,
        gross: r.earn,
        netPayable: n2(r.earn + net - r.paid)
      };
    })
  };
}

/* ==================== the time sheet each person gets ==================== */
//
// "TIME SHEET OF STAFF", and it is a calendar, not a summary: every day of the
// cycle down the page with the day of the week beside it, the mark, the two
// clock times and a remarks column, then the tally underneath - total days,
// working days, weekends, leave, holidays, absent, half leave, and the man
// month. Their marks are single letters and are kept: X worked, W weekend,
// H holiday, L leave, A absent, HF half leave.

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const MARK = {
  present: 'X', late: 'X', ahalf: 'HF', half: 'HF', leave: 'L', absent: 'A',
  wfh: 'X', holiday: 'H', weekend: 'W', pending: 'N/A', thirdparty: 'N/A'
};

export async function timeSheetOf(realmId, month, code) {
  const policy = await hrPolicy(realmId);
  const m = monthText(month) || thisMonth();
  const cycle = cycleOf(m, policy);
  const emp = (await listEmployees(realmId, { code })) [0];
  if (!emp) return { error: 'No such employee.' };

  const rows = await daysOf(realmId, cycle.from, cycle.to, code);
  const by = new Map(rows.map(r => [r.day, r]));

  const out = [];
  const tally = { days: 0, worked: 0, weekend: 0, na: 0, leave: 0, holiday: 0,
                  absent: 0, half: 0 };

  for (const day of eachDay(cycle.from, cycle.to)) {
    const r = by.get(day) || null;
    const [y, mo, d] = day.split('-').map(Number);
    const wd = WEEKDAY[new Date(y, mo - 1, d).getDay()];
    // No row is no roster. A Sunday the machine never printed is a weekend; a
    // weekday it never printed is a day nobody has accounted for, and saying
    // N/A is the truth about it rather than marking it present or absent.
    const status = r ? r.status : (wd === 'Sunday' ? 'weekend' : 'pending');
    const mark = MARK[status] || 'N/A';

    out.push({
      day, dayNo: d, weekday: wd, status, mark,
      inAt: r && r.clock_in ? pretty(r.clock_in) : (mark === 'X' ? '' : mark),
      outAt: r && r.clock_out ? pretty(r.clock_out) : (mark === 'X' ? '' : mark),
      remarks: (r && (r.note || r.words)) || ''
    });

    tally.days++;
    if (mark === 'X') tally.worked++;
    else if (mark === 'W') tally.weekend++;
    else if (mark === 'H') tally.holiday++;
    else if (mark === 'L') tally.leave++;
    else if (mark === 'A') tally.absent++;
    else if (mark === 'HF') tally.half++;
    else tally.na++;
    if (day >= cycle.to) break;
  }

  // Their Man Month: the working days against the month's own days, to two
  // decimals, which is what a client is billed on.
  const mdays = Number(policy.monthDays) || 30;
  const manMonth = mdays ? Math.round((tally.worked / mdays) * 100) / 100 : 0;

  return {
    month: m, cycle,
    employee: {
      code: emp.emp_code, name: emp.name, designation: emp.designation || '',
      department: emp.department || '', station: emp.note || '',
      dutyFrom: emp.duty_from || policy.dutyFrom, dutyTo: emp.duty_to || policy.dutyTo
    },
    rows: out, tally, manMonth
  };
}

function pretty(hhmm) {
  const min = minutesOf(hhmm);
  if (min == null) return String(hhmm || '');
  let h = Math.floor(min / 60), m = min % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12; else if (h > 12) h -= 12;
  return h + ':' + String(m).padStart(2, '0') + ' ' + ap;
}

/* ==================== into QuickBooks ==================== */
//
// The last step of their own process - "final entries hum QBO mein krty hy" -
// and it is one journal entry for the month, not forty-four.
//
//   Dr each salary head        what the month cost
//   Cr each deduction's account what was taken back out of it
//   Cr salary payable          what is owed to the staff
//
// It balances by construction: the deductions are kept negative, so the debits
// are the gross and the credits are the deductions plus the payable. Where the
// money then goes is a payment against that payable, in the books, by hand -
// paying people is not something this app should be able to do by itself.

export function journalFor(working, policy) {
  const acc = (policy && policy.accounts) || {};
  const payable = (policy && policy.payableAccount) || '';
  const lines = [];
  const missing = [];

  EARN.forEach(h => {
    const amt = n2(working.totals.heads[h] || 0);
    if (!amt) return;
    if (!acc[h]) { missing.push(h); return; }
    lines.push({ head: h, side: 'Debit', account: acc[h], amount: Math.abs(amt) });
  });

  DEDUCT.forEach(h => {
    const amt = n2(working.totals.heads[h] || 0);
    if (!amt) return;
    if (!acc[h]) { missing.push(h); return; }
    lines.push({ head: h, side: 'Credit', account: acc[h], amount: Math.abs(amt) });
  });

  // What is still owed to everybody: the gross less the deductions less
  // whatever was handed over during the month.
  const owed = n2(working.totals.net - working.totals.paid);
  if (owed) {
    if (!payable) missing.push('Salary payable');
    else lines.push({ head: 'Salary payable', side: 'Credit', account: payable,
                      amount: Math.abs(owed) });
  }
  // And what was handed over during the month has already left the company, so
  // it is credited to wherever it came from rather than to the payable.
  const paid = n2(working.totals.paid);
  if (paid) {
    const from = acc['Paid During Month'] || '';
    if (!from) missing.push('Paid during the month');
    else lines.push({ head: 'Paid during the month', side: 'Credit', account: from,
                      amount: Math.abs(paid) });
  }

  const dr = n2(lines.filter(l => l.side === 'Debit').reduce((a, l) => a + l.amount, 0));
  const cr = n2(lines.filter(l => l.side === 'Credit').reduce((a, l) => a + l.amount, 0));

  return { lines, missing: [...new Set(missing)], debit: dr, credit: cr,
           balanced: Math.abs(dr - cr) < 0.02 };
}

export async function journalOf(realmId, month) {
  const w = await workingOf(realmId, month);
  const j = journalFor(w, w.policy);
  return Object.assign({ month: w.month, cycle: w.cycle, run: w.run,
                         totals: w.totals }, j);
}

// Writing it. The month has to be approved first, and a month already posted is
// never posted twice - the journal id on the run is the only record of it and
// is what stops a second entry.
export async function postMonth(realmId, month, poster) {
  const w = await workingOf(realmId, month);
  const run = w.run;
  if (run.state === 'posted') {
    return { error: 'That month is already in QuickBooks as entry ' +
                    (run.qb_journal_id || '?') + '.' };
  }
  if (run.state !== 'approved') {
    return { error: 'The month has to be approved before it is posted.' };
  }
  const j = journalFor(w, w.policy);
  if (j.missing.length) {
    return { error: 'No QuickBooks account set for: ' + j.missing.join(', ') +
                    '. Set them under How it runs.' };
  }
  if (!j.balanced) {
    return { error: 'The entry does not balance: ' + j.debit + ' against ' + j.credit +
                    '. Nothing was sent.' };
  }

  const token = await poster.getAccessToken(realmId);
  const payload = {
    TxnDate: w.cycle.to,
    DocNumber: 'SAL-' + w.month,
    PrivateNote: 'Salaries for ' + w.month + ' (' + w.cycle.from + ' to ' +
                 w.cycle.to + '), ' + w.totals.people + ' people',
    Line: j.lines.map(l => ({
      DetailType: 'JournalEntryLineDetail',
      Amount: l.amount,
      Description: l.head,
      JournalEntryLineDetail: {
        PostingType: l.side,
        AccountRef: { value: String(l.account) }
      }
    }))
  };

  const res = await poster.postJournalEntry(realmId, token, payload);
  if (!res.ok) return { error: res.msg || 'QuickBooks refused the entry.', tid: res.tid };

  const saved = await pool.query(
    `UPDATE hr_pay_runs
        SET state = 'posted', qb_journal_id = $3, qb_doc_number = $4,
            posted_at = NOW(), updated_at = NOW()
      WHERE realm_id = $1 AND month = $2 RETURNING *`,
    [realmId, w.month, String(res.id), payload.DocNumber]);

  return { ok: true, id: res.id, docNumber: payload.DocNumber, run: saved.rows[0],
           lines: j.lines.length };
}
