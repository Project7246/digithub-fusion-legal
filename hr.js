import { pool } from './db.js';
import { getSetting, setSetting } from './settings.js';

// ==================== HR: the people, their days, their leave ====================
//
// This module holds three things and nothing else: who works here, what each of
// them did on each day, and which of those days was approved. What any of it is
// worth is hrpay.js' business - the line between the two is the same line the
// company already draws by hand, where the biometric report is one sheet and the
// salary working is another.
//
// Every table here carries realm_id, like everything else in Fusion, so one
// client's staff are never readable from another's company.

/* ==================== a date is not a moment ==================== */
// The couriers taught this once already (day() in statuses.js) and the
// biometric export teaches it again: these columns hold calendar dates and
// clock times somebody's machine printed, not instants. A date read through
// toISOString() moves back a day for five hours every night in Pakistan, so
// nothing here is ever parsed into a Date and converted. The characters are
// kept as they were typed.

const pad2 = n => String(n).padStart(2, '0');

// Ten characters, YYYY-MM-DD, or null. Not sliced, not guessed.
//
// `order` is which way round a slash date is written, and it is needed because
// the two files this reads disagree: the biometric machine exports `8/26/2026`
// (month first) and the Google joining form writes `17/02/2025` (day first).
// Where one of the numbers is over twelve the numbers decide and the hint is
// ignored; where neither is - `05/07/2021` - only the hint can tell, and
// getting it wrong moves somebody's joining date by two months. The default is
// month-first, which is what the machine sends.
export function dayText(v, order) {
  if (v == null) return null;
  if (typeof v === 'number') return fromSerial(v);
  if (v instanceof Date) {
    return v.getFullYear() + '-' + pad2(v.getMonth() + 1) + '-' + pad2(v.getDate());
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return inRange(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) {
    const a = +m[1], b = +m[2];
    let mo, d;
    if (a > 12 && b <= 12) { mo = b; d = a; }          // 26/08 - the numbers say
    else if (b > 12 && a <= 12) { mo = a; d = b; }     // 8/26  - the numbers say
    else if (order === 'dmy') { d = a; mo = b; }       // 05/07 - only the hint can
    else { mo = a; d = b; }
    return inRange(+m[3], mo, d);
  }
  return null;
}

// A spreadsheet's own number for a day: 45292 is the 1st of January 2024. It is
// read with Date.UTC and getUTC*, which is the one way of using a Date that has
// no timezone in it at all - the point being that the 26th of August is the
// 26th of August on a server in Bangalore and on a laptop in Rawalpindi.
//
// The shift is 25569 because the 1st of January 1970 is serial 25569, and one
// less below 61 because Excel believes 1900 was a leap year and 1904 is handled
// nowhere here - a biometric export is never dated 1900.
function fromSerial(n) {
  if (!isFinite(n) || n < 1 || n > 60000) return null;
  const days = Math.floor(n);
  const d = new Date((days - (days > 60 ? 25569 : 25568)) * 86400000);
  if (isNaN(d.getTime())) return null;
  return inRange(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function inRange(y, mo, d) {
  if (!(y >= 1900 && y <= 2100) || !(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  return y + '-' + pad2(mo) + '-' + pad2(d);
}

export function todayText() {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

// 'YYYY-MM' or null.
export function monthText(v) {
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})/);
  if (!m) return null;
  const y = +m[1], mo = +m[2];
  if (!(y >= 1900 && y <= 2100) || !(mo >= 1 && mo <= 12)) return null;
  return y + '-' + pad2(mo);
}

export function thisMonth() { return todayText().slice(0, 7); }

// Minutes since midnight from whatever a sheet hands over: a real time, a
// fraction of a day, '09:02:00', '9:02 AM'. null when it is not a time at all -
// which is the answer that matters, because 'Public holiday' lives in the same
// column as 09:02.
export function minutesOf(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.getHours() * 60 + v.getMinutes();
  if (typeof v === 'number') {
    if (!isFinite(v) || v < 0) return null;
    const frac = v % 1;                       // an Excel date carries the day too
    // A whole number in a clock column is a date that has ended up in the wrong
    // column, not midnight. Reading it as 00:00 would mark somebody present at
    // midnight, which is worse than saying nothing.
    if (v >= 1 && frac === 0) return null;
    return Math.round(frac * 24 * 60);
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|AM|PM)?$/);
  if (!m) return null;
  let h = +m[1];
  const mi = +m[2];
  const ap = (m[4] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

// 'HH:MM' from minutes, for putting a figure back on a screen.
export function clockOf(min) {
  if (min == null || !isFinite(min)) return '';
  const m = Math.max(0, Math.round(min));
  return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
}

// '09:10' -> 550. A policy setting is typed by a person, so it is read the same
// forgiving way a sheet cell is.
export function clockMinutes(s, fallback) {
  const v = minutesOf(s);
  return v == null ? fallback : v;
}

/* ==================== the policy ==================== */
//
// Every number the salary depends on is here, and nowhere else. It is read on
// the HR screen in plain English, the way the Shopify connector states its own
// rules - a rule that cannot be put on that page in one sentence is a special
// case, and special cases are what make a payroll impossible to argue with.
//
// Only Fusion's own admin changes it ("policy check policy change ky access
// super admin yani ky Saim set kry ga"), and it is kept in app_settings, which
// is already scoped per company.

export const HR_POLICY = {
  // The month is the 26th of one month to the 25th of the next - the date the
  // biometric report is cut on, written on their own sheet.
  cycleStart: 26,
  // The divisor every per-day rate is worked out on. Thirty, always, whatever
  // the calendar says - which is what makes two months comparable.
  monthDays: 30,
  dutyFrom: '09:00',
  dutyTo: '17:00',
  dutyMinutes: 480,

  // Late begins after the grace, not at the duty time.
  graceMinutes: 10,
  // A day only counts towards "late days" when the lateness passed this.
  lateCountOver: 10,
  // Every this many late days, one day's basic salary goes.
  latePer: 3,

  // Overtime is the half hour after the duty ends and not a minute more.
  otFrom: '17:15',
  otTo: '17:45',
  // And only these departments are paid for it at all.
  otDepts: ['CSR', 'Accounts'],

  // The regular (attendance) bonus is one day's basic for a month with no
  // absence and no leave. Everybody except these departments.
  noBonusDepts: ['IT'],

  // How the late fine is worked out, per department. 'days' cuts whole days
  // after every latePer late days; 'minutes' charges the minutes at the minute
  // rate; 'minutes2x' charges the first hour once and everything after it
  // twice, which is the logistics floor's own rule.
  lateRule: 'days',
  lateRuleByDept: { Logistic: 'minutes2x', Logistics: 'minutes2x' },

  // Half of an unapproved half day's basic goes.
  halfDayFine: true,

  // Who may approve a leave. Named logins; Fusion's own admin always may.
  approvers: [],

  // What the year allows, for the leave chart. Nought means it is not counted.
  yearLeaves: 0,

  // Where each head lands in QuickBooks. Filled in on the HR screen, read by
  // hrpay.js when the month is posted.
  accounts: {},
  payableAccount: ''
};

export async function hrPolicy(realmId) {
  const saved = (await getSetting(realmId, 'hr', null)) || {};
  const p = Object.assign({}, HR_POLICY, saved);
  // the two maps are merged rather than replaced, so a saved half is not a
  // policy with half its departments missing
  p.lateRuleByDept = Object.assign({}, HR_POLICY.lateRuleByDept, saved.lateRuleByDept || {});
  p.accounts = Object.assign({}, saved.accounts || {});
  return p;
}

export async function saveHrPolicy(realmId, patch) {
  const now = await hrPolicy(realmId);
  const out = Object.assign({}, now, patch || {});
  // numbers typed into a box arrive as text
  ['cycleStart', 'monthDays', 'dutyMinutes', 'graceMinutes', 'lateCountOver',
   'latePer', 'yearLeaves'].forEach(k => {
    if (out[k] != null && out[k] !== '') out[k] = Number(out[k]) || 0;
  });
  if (!(out.cycleStart >= 1 && out.cycleStart <= 28)) out.cycleStart = HR_POLICY.cycleStart;
  if (!(out.monthDays >= 28 && out.monthDays <= 31)) out.monthDays = HR_POLICY.monthDays;
  if (!(out.latePer >= 1)) out.latePer = HR_POLICY.latePer;
  if (!Array.isArray(out.otDepts)) out.otDepts = HR_POLICY.otDepts;
  if (!Array.isArray(out.noBonusDepts)) out.noBonusDepts = HR_POLICY.noBonusDepts;
  if (!Array.isArray(out.approvers)) out.approvers = [];
  await setSetting(realmId, 'hr', out);
  return out;
}

// The dates one payroll month covers, which is not the calendar month: the 26th
// of the month before to the 25th of this one. Both ends inclusive, both plain
// text, so a query is a string comparison and nothing is converted.
export function cycleOf(month, policy) {
  const m = monthText(month);
  if (!m) return null;
  const start = Number((policy && policy.cycleStart) || HR_POLICY.cycleStart);
  const y = +m.slice(0, 4), mo = +m.slice(5, 7);
  if (start <= 1) {
    const endDay = new Date(y, mo, 0).getDate();     // last day of this month
    return { from: m + '-01', to: m + '-' + pad2(endDay) };
  }
  const py = mo === 1 ? y - 1 : y;
  const pm = mo === 1 ? 12 : mo - 1;
  return {
    from: py + '-' + pad2(pm) + '-' + pad2(start),
    to: m + '-' + pad2(start - 1)
  };
}

/* ==================== the tables ==================== */

export async function initHr() {
  // Who works here. The columns are the ones the company's own joining form
  // asks for, because that form is what fills this in - name, photo, ID card,
  // date of birth, guardian and their phone and ID, joining date, designation,
  // both emails, department, phone and home address. None of those are
  // optional on purpose: "kuch chezy hum us mein optional ni rkhy gy jasy
  // house address guardian contact name phone number".
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hr_employees (
      id            SERIAL PRIMARY KEY,
      realm_id      TEXT NOT NULL,
      emp_code      TEXT NOT NULL,
      name          TEXT NOT NULL,
      department    TEXT,
      designation   TEXT,
      grade         TEXT,
      dob           TEXT,
      joined_on     TEXT,
      left_on       TEXT,
      status        TEXT DEFAULT 'working',
      employment    TEXT,
      phone         TEXT,
      email         TEXT,
      work_email    TEXT,
      cnic          TEXT,
      guardian      TEXT,
      guardian_phone TEXT,
      guardian_cnic TEXT,
      address       TEXT,
      bank_name     TEXT,
      bank_account  TEXT,
      pay_mode      TEXT DEFAULT 'bank',
      photo_url     TEXT,
      id_card_url   TEXT,
      basic         NUMERIC(14,2) DEFAULT 0,
      scale         TEXT,
      duty_from     TEXT,
      duty_to       TEXT,
      timetable     TEXT,
      ac_no         TEXT,
      virtual       BOOLEAN DEFAULT FALSE,
      ot_allowed    BOOLEAN,
      late_rule     TEXT,
      late_count_over INTEGER,
      user_sub      TEXT,
      form_state    TEXT DEFAULT 'pending',
      verified_at   TIMESTAMPTZ,
      next_increment TEXT,
      note          TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS hr_employees_code
      ON hr_employees (realm_id, emp_code)
  `);
  // The login an employee signs in with, looked up often enough to be worth it.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS hr_employees_user
      ON hr_employees (realm_id, user_sub)
  `);

  // One row per employee per day, and the day is text. A day nobody was
  // rostered for has no row at all - the biometric export leaves Sundays out
  // entirely, and inventing a row for one would be inventing a weekend that
  // might have been a working day.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hr_days (
      realm_id    TEXT NOT NULL,
      emp_code    TEXT NOT NULL,
      day         TEXT NOT NULL,
      timetable   TEXT,
      on_duty     TEXT,
      off_duty    TEXT,
      clock_in    TEXT,
      clock_out   TEXT,
      status      TEXT NOT NULL DEFAULT 'present',
      words       TEXT,
      source      TEXT DEFAULT 'biometric',
      note        TEXT,
      decided_by  TEXT,
      updated_at  TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (realm_id, emp_code, day)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS hr_days_month
      ON hr_days (realm_id, day)
  `);

  // A leave is a question waiting on a person, so it keeps everything until one
  // of them answers it. Approved, it becomes a leave on the day; refused, the
  // day is an absence and is deducted - which is the whole of why this table
  // exists rather than a tick on the day row.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hr_leaves (
      id            SERIAL PRIMARY KEY,
      realm_id      TEXT NOT NULL,
      emp_code      TEXT NOT NULL,
      kind          TEXT NOT NULL DEFAULT 'leave',
      from_day      TEXT NOT NULL,
      to_day        TEXT NOT NULL,
      reason        TEXT,
      state         TEXT NOT NULL DEFAULT 'asked',
      asked_by      TEXT,
      asked_at      TIMESTAMPTZ DEFAULT NOW(),
      decided_by    TEXT,
      decided_at    TIMESTAMPTZ,
      decision_note TEXT,
      email_ref     TEXT
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS hr_leaves_who
      ON hr_leaves (realm_id, emp_code, from_day)
  `);

  // The month itself: open while it is being worked out, approved once the
  // three who approve have said so, posted once it is in QuickBooks. A month
  // that has been posted is not calculated over again by accident.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hr_pay_runs (
      id            SERIAL PRIMARY KEY,
      realm_id      TEXT NOT NULL,
      month         TEXT NOT NULL,
      state         TEXT NOT NULL DEFAULT 'open',
      approvals     JSONB DEFAULT '[]'::jsonb,
      qb_journal_id TEXT,
      qb_doc_number TEXT,
      posted_at     TIMESTAMPTZ,
      note          TEXT,
      figured_at    TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS hr_pay_runs_month
      ON hr_pay_runs (realm_id, month)
  `);

  // The ledger, and it is the only copy of the month's money.
  //
  // Their own workbook ends as exactly this shape - employee, head, amount -
  // because the report, the slips and the QuickBooks entry are each a different
  // reading of it. Anything that wants a figure asks these rows; nothing keeps
  // a second total of its own, which is how two numbers for one thing end up
  // disagreeing on one screen.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hr_pay_lines (
      realm_id    TEXT NOT NULL,
      month       TEXT NOT NULL,
      emp_code    TEXT NOT NULL,
      head        TEXT NOT NULL,
      amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
      source      TEXT NOT NULL DEFAULT 'auto',
      note        TEXT,
      updated_at  TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (realm_id, month, emp_code, head)
    )
  `);

  // What the month knows about an employee that the employee row does not:
  // the days they were actually on the payroll, an extra day somebody was
  // granted, a basic that changed mid-month.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hr_month_facts (
      realm_id      TEXT NOT NULL,
      month         TEXT NOT NULL,
      emp_code      TEXT NOT NULL,
      work_days     NUMERIC,
      ot_extra_days NUMERIC DEFAULT 0,
      basic         NUMERIC(14,2),
      pay_mode      TEXT,
      note          TEXT,
      updated_at    TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (realm_id, month, emp_code)
    )
  `);

  // The pools: the parcel bonus, the parcel fine and the order bonus. The
  // figures are typed by the management and the recipients are ticked by them,
  // because who gets a bonus is their decision and it changes - "selection hu
  // kis ki sko dena hy ki skis ko ni dena ye hamrai choice apni hti hy".
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hr_pools (
      realm_id    TEXT NOT NULL,
      month       TEXT NOT NULL,
      kind        TEXT NOT NULL,
      data        JSONB,
      updated_at  TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (realm_id, month, kind)
    )
  `);

  console.log('HR ready');
}

/* ==================== the people ==================== */

const CLEAN = s => (s == null ? null : String(s).trim() || null);

// The columns a person may actually set, so a stray key in a form body cannot
// write to a column it has no business in.
const FIELDS = [
  'name', 'department', 'designation', 'grade', 'dob', 'joined_on', 'left_on',
  'status', 'employment', 'phone', 'email', 'work_email', 'cnic', 'guardian',
  'guardian_phone', 'guardian_cnic', 'address', 'bank_name', 'bank_account',
  'pay_mode', 'photo_url', 'id_card_url', 'scale', 'duty_from', 'duty_to',
  'timetable', 'ac_no', 'late_rule', 'next_increment', 'note'
];

// What an employee may change about themselves. Their pay, their grade and
// their department are not on this list: a form somebody fills in about
// themselves is their own details, not their terms.
export const SELF_FIELDS = [
  'dob', 'phone', 'email', 'cnic', 'guardian', 'guardian_phone', 'guardian_cnic',
  'address', 'bank_name', 'bank_account', 'photo_url', 'id_card_url'
];

// Every one of these has to be filled in before a form counts as verified.
export const MUST_FILL = [
  'name', 'dob', 'phone', 'cnic', 'guardian', 'guardian_phone', 'guardian_cnic',
  'address'
];

export function missingFrom(emp) {
  return MUST_FILL.filter(k => !String((emp && emp[k]) || '').trim());
}

// The next employee id. Theirs run 15101 upward and a new person always gets a
// new one, never a returned one - "her new employee ki id new generate hu" -
// so it is the highest that has ever existed plus one, not a gap being filled.
export async function nextEmpCode(realmId, policy) {
  const r = await pool.query(
    `SELECT emp_code FROM hr_employees WHERE realm_id = $1`, [realmId]);
  let top = 0;
  for (const row of r.rows) {
    const n = parseInt(String(row.emp_code).replace(/[^0-9]/g, ''), 10);
    if (isFinite(n) && n > top) top = n;
  }
  const from = Number((policy && policy.codeFrom) || 15101);
  return String(Math.max(top + 1, from));
}

export async function listEmployees(realmId, opts) {
  const o = opts || {};
  const where = ['realm_id = $1'];
  const args = [realmId];
  if (o.code) { args.push(o.code); where.push('emp_code = $' + args.length); }
  if (o.userSub) { args.push(o.userSub); where.push('user_sub = $' + args.length); }
  if (!o.all && !o.code && !o.userSub) where.push(`COALESCE(status,'working') <> 'left'`);
  const r = await pool.query(
    `SELECT * FROM hr_employees WHERE ${where.join(' AND ')}
      ORDER BY department NULLS LAST, emp_code`, args);
  return r.rows;
}

export async function employeeByCode(realmId, code) {
  const rows = await listEmployees(realmId, { code: String(code || '') });
  return rows[0] || null;
}

export async function employeeOfUser(realmId, sub) {
  if (!sub) return null;
  const rows = await listEmployees(realmId, { userSub: sub });
  return rows[0] || null;
}

export async function addEmployee(realmId, body, policy) {
  const name = CLEAN(body && body.name);
  if (!name) return { error: 'A name is needed.' };
  const code = CLEAN(body.emp_code) || await nextEmpCode(realmId, policy);
  const taken = await employeeByCode(realmId, code);
  if (taken) return { error: 'Employee id ' + code + ' is already ' + taken.name + '.' };

  const cols = ['realm_id', 'emp_code'];
  const vals = [realmId, code];
  FIELDS.forEach(f => {
    if (body[f] !== undefined) { cols.push(f); vals.push(CLEAN(body[f])); }
  });
  if (body.basic !== undefined) { cols.push('basic'); vals.push(Number(body.basic) || 0); }
  if (body.virtual !== undefined) { cols.push('virtual'); vals.push(!!body.virtual); }
  if (body.ot_allowed !== undefined && body.ot_allowed !== '') {
    cols.push('ot_allowed'); vals.push(!!body.ot_allowed);
  }
  if (body.late_count_over !== undefined && body.late_count_over !== '') {
    cols.push('late_count_over'); vals.push(Number(body.late_count_over) || null);
  }
  const holes = vals.map((_, i) => '$' + (i + 1)).join(',');
  const r = await pool.query(
    `INSERT INTO hr_employees (${cols.join(',')}) VALUES (${holes}) RETURNING *`, vals);
  return { ok: true, employee: r.rows[0] };
}

export async function saveEmployee(realmId, code, body, only) {
  const emp = await employeeByCode(realmId, code);
  if (!emp) return { error: 'No such employee.' };
  const allowed = only || FIELDS;
  const sets = [];
  const args = [realmId, String(code)];
  allowed.forEach(f => {
    if (body[f] === undefined) return;
    args.push(CLEAN(body[f]));
    sets.push(f + ' = $' + args.length);
  });
  if (!only) {
    if (body.basic !== undefined) { args.push(Number(body.basic) || 0); sets.push('basic = $' + args.length); }
    if (body.virtual !== undefined) { args.push(!!body.virtual); sets.push('virtual = $' + args.length); }
    if (body.ot_allowed !== undefined) {
      args.push(body.ot_allowed === '' || body.ot_allowed === null ? null : !!body.ot_allowed);
      sets.push('ot_allowed = $' + args.length);
    }
    if (body.late_count_over !== undefined) {
      args.push(body.late_count_over === '' ? null : Number(body.late_count_over) || null);
      sets.push('late_count_over = $' + args.length);
    }
  }
  if (!sets.length) return { ok: true, employee: emp };
  const r = await pool.query(
    `UPDATE hr_employees SET ${sets.join(',')}, updated_at = NOW()
      WHERE realm_id = $1 AND emp_code = $2 RETURNING *`, args);
  return { ok: true, employee: r.rows[0] };
}

// Hiring and firing both happen here, and neither deletes anything. Somebody
// who has left keeps every day they worked and every slip they were paid,
// because the month they left in still has to be able to be read next year.
export async function setEmployeeStatus(realmId, code, status, day, note) {
  const st = ['working', 'probation', 'notice', 'left', 'suspended'].indexOf(String(status)) >= 0
    ? String(status) : null;
  if (!st) return { error: 'That is not a status.' };
  const left = st === 'left' ? (dayText(day) || todayText()) : null;
  const r = await pool.query(
    `UPDATE hr_employees
        SET status = $3, left_on = CASE WHEN $3 = 'left' THEN $4 ELSE NULL END,
            note = COALESCE($5, note), updated_at = NOW()
      WHERE realm_id = $1 AND emp_code = $2 RETURNING *`,
    [realmId, String(code), st, left, CLEAN(note)]);
  if (!r.rowCount) return { error: 'No such employee.' };
  return { ok: true, employee: r.rows[0] };
}

// The login and the employee row are two different things and this is the one
// place they are tied together. An employee with no login simply has no
// self-service screen; nothing else about them changes.
export async function linkEmployeeUser(realmId, code, sub) {
  const r = await pool.query(
    `UPDATE hr_employees SET user_sub = $3, updated_at = NOW()
      WHERE realm_id = $1 AND emp_code = $2 RETURNING *`,
    [realmId, String(code), sub || null]);
  if (!r.rowCount) return { error: 'No such employee.' };
  return { ok: true, employee: r.rows[0] };
}

// The first sign-in is a verification, not a blank form: everything known is
// already in the boxes and the employee corrects what is wrong. Nothing is
// verified while a must-fill is empty, because a form signed off with no home
// address is the exact thing that was asked not to happen.
export async function verifyOwnForm(realmId, code) {
  const emp = await employeeByCode(realmId, code);
  if (!emp) return { error: 'No such employee.' };
  const missing = missingFrom(emp);
  if (missing.length) return { missing };
  const r = await pool.query(
    `UPDATE hr_employees SET form_state = 'verified', verified_at = NOW(), updated_at = NOW()
      WHERE realm_id = $1 AND emp_code = $2 RETURNING *`, [realmId, String(code)]);
  return { ok: true, employee: r.rows[0] };
}

/* ==================== the days ==================== */

export const DAY_STATUS = {
  present:    'Present',
  late:       'Late',
  half:       'Half day (not approved)',
  ahalf:      'Half day (approved)',
  leave:      'Leave (approved)',
  absent:     'Absent',
  wfh:        'Work from home',
  holiday:    'Public holiday',
  weekend:    'Weekend',
  pending:    'Verification pending',
  thirdparty: 'Third party'
};

// What one day is worth in minutes and in days, read from the day row and the
// policy together. Nothing derived is stored: the policy can change and last
// month can be read again without a migration.
export function dayFigures(row, policy, emp) {
  const p = policy || HR_POLICY;
  const inMin = minutesOf(row.clock_in);
  const outMin = minutesOf(row.clock_out);
  const grace = clockMinutes(p.dutyFrom, 540) + Number(p.graceMinutes || 0);
  const otFrom = clockMinutes(p.otFrom, 1035);
  const otTo = clockMinutes(p.otTo, 1065);

  let late = 0, ot = 0, work = 0;
  if (inMin != null && inMin > grace) late = inMin - grace;
  if (outMin != null && outMin > otFrom) ot = Math.min(outMin, otTo) - otFrom;
  if (inMin != null && outMin != null && outMin > inMin) work = outMin - inMin;

  // A day nobody was at work is not a day with nought minutes of lateness; it
  // is a day with no clock at all, and must not be counted as punctual either.
  const worked = ['present', 'late', 'half', 'ahalf'].indexOf(row.status) >= 0;
  if (!worked) { late = 0; ot = 0; }

  // Overtime is a department's to have, and an employee may be set either way.
  const allowed = emp && emp.ot_allowed != null
    ? !!emp.ot_allowed
    : (p.otDepts || []).some(d => sameDept(d, emp && emp.department));
  if (!allowed) ot = 0;

  const lateOver = emp && emp.late_count_over != null
    ? Number(emp.late_count_over)
    : Number(p.lateCountOver || 0);

  return {
    late, ot, work,
    lateDay: worked && late > lateOver,
    // how much of a day this was, which is what the basic is paid on
    days: row.status === 'half' || row.status === 'ahalf' ? 0.5 : (worked || row.status === 'wfh' ? 1 : 0)
  };
}

function sameDept(a, b) {
  const n = s => String(s || '').trim().toLowerCase().replace(/s$/, '');
  return !!a && n(a) === n(b);
}

export function lateRuleFor(policy, emp) {
  if (emp && emp.late_rule) return emp.late_rule;
  const byDept = (policy && policy.lateRuleByDept) || {};
  for (const k of Object.keys(byDept)) {
    if (sameDept(k, emp && emp.department)) return byDept[k];
  }
  return (policy && policy.lateRule) || 'days';
}

export async function daysOf(realmId, from, to, code) {
  const args = [realmId, from, to];
  let extra = '';
  if (code) { args.push(String(code)); extra = ' AND emp_code = $4'; }
  const r = await pool.query(
    `SELECT * FROM hr_days
      WHERE realm_id = $1 AND day >= $2 AND day <= $3${extra}
      ORDER BY emp_code, day`, args);
  return r.rows;
}

export async function putDay(realmId, code, day, patch, who) {
  const d = dayText(day);
  if (!d) return { error: 'That is not a date.' };
  const st = patch.status && DAY_STATUS[patch.status] ? patch.status : null;
  const r = await pool.query(
    `INSERT INTO hr_days
       (realm_id, emp_code, day, timetable, on_duty, off_duty, clock_in, clock_out,
        status, words, source, note, decided_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'present'),$10,$11,$12,$13)
     ON CONFLICT (realm_id, emp_code, day) DO UPDATE SET
       timetable  = COALESCE(EXCLUDED.timetable, hr_days.timetable),
       on_duty    = COALESCE(EXCLUDED.on_duty, hr_days.on_duty),
       off_duty   = COALESCE(EXCLUDED.off_duty, hr_days.off_duty),
       clock_in   = COALESCE(EXCLUDED.clock_in, hr_days.clock_in),
       clock_out  = COALESCE(EXCLUDED.clock_out, hr_days.clock_out),
       status     = COALESCE($9, hr_days.status),
       words      = COALESCE(EXCLUDED.words, hr_days.words),
       source     = EXCLUDED.source,
       note       = COALESCE(EXCLUDED.note, hr_days.note),
       decided_by = COALESCE(EXCLUDED.decided_by, hr_days.decided_by),
       updated_at = NOW()
     RETURNING *`,
    [realmId, String(code), d, CLEAN(patch.timetable), CLEAN(patch.on_duty),
     CLEAN(patch.off_duty), CLEAN(patch.clock_in), CLEAN(patch.clock_out),
     st, CLEAN(patch.words), patch.source || 'hand', CLEAN(patch.note), who || null]);
  return { ok: true, day: r.rows[0] };
}

/* ==================== bringing the biometric report in ==================== */
//
// The export is one row per employee per day and its own words live in the
// clock-in column: 'Public holiday', 'WFH', 'Leave', 'Absent' sit where 09:02
// otherwise would. So the status is read from those words first and from the
// clock only when there is one - and where there is neither, the day is
// **Verification pending**, which is their own term for a day somebody has to
// look at. It is not an absence until somebody says it is.

const HEAD_HINTS = {
  code:      ['no.', 'no', 'emp no.', 'emp no', 'employee id', 'employee no', 'id'],
  acNo:      ['ac-no.', 'ac-no', 'ac no', 'acno'],
  name:      ['name', 'employee name'],
  day:       ['date', 'att date', 'attendance date'],
  timetable: ['timetable', 'time table', 'shift'],
  onDuty:    ['on duty', 'onduty', 'duty start'],
  offDuty:   ['off duty', 'offduty', 'duty end'],
  clockIn:   ['clock in', 'clockin', 'check in', 'in'],
  clockOut:  ['clock out', 'clockout', 'check out', 'out'],
  real:      ['real time', 'realtime'],
  absent:    ['absent'],
  dept:      ['department', 'dept']
};

function headerIndex(header, list) {
  const low = header.map(h => String(h == null ? '' : h).trim().toLowerCase());
  for (const want of list) { const i = low.indexOf(want); if (i >= 0) return i; }
  for (const want of list) {
    const i = low.findIndex(h => h && h.indexOf(want) === 0);
    if (i >= 0) return i;
  }
  return -1;
}

// The header is the row that answers to the most of the names above - the
// export has a title row above it often enough that guessing row 1 is wrong.
function findHeader(grid) {
  let best = 0, score = -1;
  for (let r = 0; r < Math.min(grid.length, 12); r++) {
    const row = grid[r] || [];
    let s = 0;
    Object.values(HEAD_HINTS).forEach(list => {
      if (headerIndex(row, list) >= 0) s++;
    });
    if (s > score) { score = s; best = r; }
  }
  return best;
}

function statusFromWords(ci, co, real, absentCell) {
  const w = String(ci == null ? '' : ci).trim();
  const low = w.toLowerCase();
  const rl = String(real == null ? '' : real).trim().toLowerCase();

  if (/public\s*holiday|gazetted|holiday/.test(low)) return { status: 'holiday', words: w };
  if (/wfh|work\s*from\s*home/.test(low)) return { status: 'wfh', words: w };
  if (/^leave|approved\s*leave|annual|casual|sick/.test(low)) return { status: 'leave', words: w };
  if (/^absent|^abs\b/.test(low)) return { status: 'absent', words: w };
  if (/weekend|week\s*off|rest\s*day|off\s*day/.test(low)) return { status: 'weekend', words: w };
  if (/third\s*party|3rd\s*party/.test(low)) return { status: 'thirdparty', words: w };

  if (minutesOf(ci) != null || minutesOf(co) != null) {
    // 'A. Half Day' is their mark for a half day somebody approved; a plain
    // 'Half Day' is one nobody did, and those two are paid differently.
    if (/^a\.?\s*half/.test(rl)) return { status: 'ahalf', words: String(real) };
    if (/half/.test(rl)) return { status: 'half', words: String(real) };
    return { status: 'present', words: '' };
  }

  if (String(absentCell == null ? '' : absentCell).trim().toLowerCase() === 'true') {
    return { status: 'absent', words: 'Absent' };
  }
  return { status: 'pending', words: w };
}

// Read the grid, match each row to an employee, and write the days. Nothing
// about an employee is changed except the two things the machine knows better
// than we do - their biometric number and their timetable.
export async function importDays(realmId, grid, opts) {
  const o = opts || {};
  if (!grid || !grid.length) return { error: 'That sheet is empty.' };
  const h = findHeader(grid);
  const header = grid[h] || [];
  const at = {};
  Object.keys(HEAD_HINTS).forEach(k => { at[k] = headerIndex(header, HEAD_HINTS[k]); });

  if (at.day < 0) return { error: 'No Date column in that sheet.' };
  if (at.code < 0 && at.name < 0) {
    return { error: 'No employee column in that sheet - it needs a No. or a Name.' };
  }

  const people = await listEmployees(realmId, { all: true });
  const byCode = new Map(people.map(p => [String(p.emp_code), p]));
  const byName = new Map(people.map(p => [looseName(p.name), p]));
  const byAc = new Map(people.filter(p => p.ac_no).map(p => [String(p.ac_no), p]));

  const seen = new Map();          // emp_code -> { timetable, acNo, dept }
  const rows = [];
  const unknown = new Map();       // what the sheet named that we do not have
  let skipped = 0, from = null, to = null;

  for (let r = h + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const day = dayText(at.day >= 0 ? row[at.day] : null);
    if (!day) { continue; }

    const codeCell = at.code >= 0 ? String(row[at.code] == null ? '' : row[at.code]).trim() : '';
    const nameCell = at.name >= 0 ? String(row[at.name] == null ? '' : row[at.name]).trim() : '';
    let emp = codeCell ? byCode.get(codeCell) : null;
    if (!emp && at.acNo >= 0) emp = byAc.get(String(row[at.acNo] == null ? '' : row[at.acNo]).trim());
    if (!emp && nameCell) emp = byName.get(looseName(nameCell));

    if (!emp) {
      const key = nameCell || codeCell || '(no name)';
      const u = unknown.get(key) || { name: nameCell, code: codeCell, days: 0 };
      u.days++;
      unknown.set(key, u);
      skipped++;
      continue;
    }

    const ci = at.clockIn >= 0 ? row[at.clockIn] : null;
    const co = at.clockOut >= 0 ? row[at.clockOut] : null;
    const st = statusFromWords(ci, co, at.real >= 0 ? row[at.real] : null,
                               at.absent >= 0 ? row[at.absent] : null);

    rows.push({
      code: String(emp.emp_code),
      day,
      timetable: at.timetable >= 0 ? CLEAN(row[at.timetable]) : null,
      onDuty: at.onDuty >= 0 ? clockOf(minutesOf(row[at.onDuty])) || null : null,
      offDuty: at.offDuty >= 0 ? clockOf(minutesOf(row[at.offDuty])) || null : null,
      clockIn: clockOf(minutesOf(ci)) || null,
      clockOut: clockOf(minutesOf(co)) || null,
      status: st.status,
      words: st.words || null
    });

    if (!from || day < from) from = day;
    if (!to || day > to) to = day;
    const s = seen.get(String(emp.emp_code)) || {};
    if (rows[rows.length - 1].timetable) s.timetable = rows[rows.length - 1].timetable;
    if (at.acNo >= 0 && row[at.acNo] != null && String(row[at.acNo]).trim()) {
      s.acNo = String(row[at.acNo]).trim();
    }
    if (at.dept >= 0 && CLEAN(row[at.dept])) s.dept = CLEAN(row[at.dept]);
    seen.set(String(emp.emp_code), s);
  }

  if (!rows.length) {
    return { error: 'No row in that sheet matched anybody on the staff list.', unknown: [...unknown.values()] };
  }
  if (o.dryRun) {
    return { ok: true, dryRun: true, rows: rows.length, people: seen.size, from, to,
             unknown: [...unknown.values()] };
  }

  // **Two queries for the whole report, not two a day.**
  //
  // The first version asked whether each day had been ruled on and then wrote
  // it, one day at a time - for a month's report that is nearly two thousand
  // round trips to Neon, and the import simply never came back. A thousand days
  // go in as a handful of statements now.
  const client = await pool.connect();
  let written = 0, kept = 0;
  try {
    await client.query('BEGIN');

    // Every day in this span that a person has already ruled on, in one ask.
    // Those are not overwritten by the machine: that is the whole point of the
    // approval - the report says Absent, the leave email says it was approved,
    // and the person's answer wins.
    const ruled = new Set();
    if (!o.force) {
      const held = await client.query(
        `SELECT emp_code, day FROM hr_days
          WHERE realm_id = $1 AND day >= $2 AND day <= $3 AND source = 'hand'`,
        [realmId, from, to]);
      held.rows.forEach(x => ruled.add(x.emp_code + '|' + x.day));
    }

    const mine = rows.filter(d => {
      if (ruled.has(d.code + '|' + d.day)) { kept++; return false; }
      return true;
    });

    // In chunks, because one statement carrying ten thousand parameters is a
    // statement Postgres has to be talked into rather than handed.
    const CHUNK = 250;
    for (let at = 0; at < mine.length; at += CHUNK) {
      const lot = mine.slice(at, at + CHUNK);
      const args = [realmId];
      const holes = lot.map(d => {
        args.push(d.code, d.day, d.timetable, d.onDuty, d.offDuty, d.clockIn,
                  d.clockOut, d.status, d.words);
        const n = args.length;
        // every placeholder cast: a VALUES list carries no types of its own
        return '($1::text,$' + (n - 8) + '::text,$' + (n - 7) + '::text,$' +
               (n - 6) + '::text,$' + (n - 5) + '::text,$' + (n - 4) + '::text,$' +
               (n - 3) + '::text,$' + (n - 2) + '::text,$' + (n - 1) + '::text,$' +
               n + '::text)';
      }).join(',');

      const out = await client.query(
        `INSERT INTO hr_days
           (realm_id, emp_code, day, timetable, on_duty, off_duty, clock_in,
            clock_out, status, words, source)
         SELECT v.realm_id, v.emp_code, v.day, v.timetable, v.on_duty, v.off_duty,
                v.clock_in, v.clock_out, v.status, v.words, 'biometric'
           FROM (VALUES ${holes}) AS v(realm_id, emp_code, day, timetable, on_duty,
                                       off_duty, clock_in, clock_out, status, words)
         ON CONFLICT (realm_id, emp_code, day) DO UPDATE SET
           timetable = EXCLUDED.timetable, on_duty = EXCLUDED.on_duty,
           off_duty = EXCLUDED.off_duty, clock_in = EXCLUDED.clock_in,
           clock_out = EXCLUDED.clock_out, status = EXCLUDED.status,
           words = EXCLUDED.words, source = 'biometric', updated_at = NOW()`,
        args);
      written += out.rowCount;
    }

    for (const [code, s] of seen) {
      if (!s.timetable && !s.acNo && !s.dept) continue;
      await client.query(
        `UPDATE hr_employees
            SET timetable = COALESCE($3, timetable),
                ac_no     = COALESCE($4, ac_no),
                department = COALESCE(department, $5),
                updated_at = NOW()
          WHERE realm_id = $1 AND emp_code = $2`,
        [realmId, code, s.timetable || null, s.acNo || null, s.dept || null]);
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* the trip is over */ }
    throw e;
  } finally {
    client.release();
  }

  // Whatever leave was approved for those dates is put back on top, because an
  // approval made last week has to survive this week's import.
  const applied = await applyApprovedLeave(realmId, from, to);

  return { ok: true, rows: written, kept, skipped, people: seen.size, from, to,
           leaveApplied: applied, unknown: [...unknown.values()] };
}

function looseName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
}

/* ==================== leave, and what it does to a day ==================== */

export async function listLeaves(realmId, opts) {
  const o = opts || {};
  const where = ['realm_id = $1'];
  const args = [realmId];
  if (o.state) { args.push(o.state); where.push('state = $' + args.length); }
  if (o.code) { args.push(String(o.code)); where.push('emp_code = $' + args.length); }
  if (o.from) { args.push(o.from); where.push('to_day >= $' + args.length); }
  if (o.to) { args.push(o.to); where.push('from_day <= $' + args.length); }
  const r = await pool.query(
    `SELECT * FROM hr_leaves WHERE ${where.join(' AND ')}
      ORDER BY (state = 'asked') DESC, from_day DESC, id DESC
      LIMIT ${Number(o.limit) || 500}`, args);
  return r.rows;
}

export async function askLeave(realmId, body, who) {
  const code = String((body && body.emp_code) || '').trim();
  if (!code) return { error: 'Whose leave is it?' };
  const from = dayText(body.from_day);
  const to = dayText(body.to_day) || from;
  if (!from || !to) return { error: 'A leave needs a date.' };
  if (to < from) return { error: 'That ends before it starts.' };
  const kind = ['leave', 'half', 'late', 'wfh'].indexOf(String(body.kind)) >= 0
    ? String(body.kind) : 'leave';
  const r = await pool.query(
    `INSERT INTO hr_leaves
       (realm_id, emp_code, kind, from_day, to_day, reason, asked_by, email_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [realmId, code, kind, from, to, CLEAN(body.reason), who || null, CLEAN(body.email_ref)]);
  return { ok: true, leave: r.rows[0] };
}

// Approving is the thing the whole module turns on: an approved day is a leave
// and costs nothing, a refused one is an absence and is deducted. So the
// decision is written on the leave and then straight onto the days it covers,
// rather than being worked out again at payroll time from two places.
export async function decideLeave(realmId, id, state, who, note) {
  const st = state === 'approved' || state === 'refused' ? state : null;
  if (!st) return { error: 'Approved or refused - nothing else.' };
  const r = await pool.query(
    `UPDATE hr_leaves
        SET state = $3, decided_by = $4, decided_at = NOW(), decision_note = $5
      WHERE realm_id = $1 AND id = $2 RETURNING *`,
    [realmId, Number(id), st, who || null, CLEAN(note)]);
  if (!r.rowCount) return { error: 'No such leave.' };
  const lv = r.rows[0];
  const touched = await writeLeaveDays(realmId, lv, who);
  return { ok: true, leave: lv, days: touched };
}

// One leave onto its days. 'hand' is written as the source so the next
// biometric import leaves these alone - see importDays.
async function writeLeaveDays(realmId, lv, who) {
  const want = lv.state === 'approved'
    ? (lv.kind === 'half' ? 'ahalf' : lv.kind === 'wfh' ? 'wfh' : lv.kind === 'late' ? null : 'leave')
    : (lv.kind === 'leave' ? 'absent' : lv.kind === 'half' ? 'half' : null);
  if (!want) return 0;                 // an approved late changes no status

  let n = 0;
  for (const day of eachDay(lv.from_day, lv.to_day)) {
    await pool.query(
      `INSERT INTO hr_days (realm_id, emp_code, day, status, source, note, decided_by)
       VALUES ($1,$2,$3,$4,'hand',$5,$6)
       ON CONFLICT (realm_id, emp_code, day) DO UPDATE SET
         status = $4, source = 'hand', note = COALESCE($5, hr_days.note),
         decided_by = $6, updated_at = NOW()`,
      [realmId, lv.emp_code, day, want,
       (lv.state === 'approved' ? 'Approved' : 'Not approved') +
         (lv.reason ? ': ' + lv.reason : ''), who || lv.decided_by || null]);
    n++;
  }
  return n;
}

// Every approved leave across a span, put back onto the days. Run after an
// import, because the machine has just overwritten the days it covers.
export async function applyApprovedLeave(realmId, from, to) {
  const rows = await listLeaves(realmId, { from, to, state: 'approved' });
  let n = 0;
  for (const lv of rows) n += await writeLeaveDays(realmId, lv, lv.decided_by);
  const refused = await listLeaves(realmId, { from, to, state: 'refused' });
  for (const lv of refused) n += await writeLeaveDays(realmId, lv, lv.decided_by);
  return n;
}

export function eachDay(from, to) {
  const out = [];
  let [y, m, d] = String(from).split('-').map(Number);
  const stop = String(to);
  for (let i = 0; i < 400; i++) {
    const day = y + '-' + pad2(m) + '-' + pad2(d);
    out.push(day);
    if (day >= stop) break;
    d++;
    const last = new Date(y, m, 0).getDate();
    if (d > last) { d = 1; m++; if (m > 12) { m = 1; y++; } }
  }
  return out;
}

/* ==================== the people who may approve ==================== */
// Three names, said once: "ye approve wala kam Sarmad Umer Saim krty hy... is
// pory project ky final approval authority in 3 ky pass hti hy". They are kept
// in the policy as logins rather than hard-coded, because a person leaves and a
// name in a source file does not.
export function mayApprove(policy, who) {
  if (!who) return false;
  if (who.admin) return true;                       // Fusion's own admin always
  const list = (policy && policy.approvers) || [];
  if (!list.length) return !!who.runsCompany;       // nobody named yet: the company's admin
  return list.some(a => String(a).toLowerCase() === String(who.sub || '').toLowerCase() ||
                        String(a).toLowerCase() === String(who.email || '').toLowerCase());
}

/* ==================== housekeeping ==================== */
// Nothing here is a log, so nothing here is trimmed by age. A day worked three
// years ago is what a salary dispute is settled with, and a day row is a few
// dozen bytes. What is not kept is anything the biometric machine sent that we
// did not read - the raw export is never stored, the way an uploaded invoice
// file never is.
export async function hrSize(realmId) {
  const r = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM hr_employees WHERE realm_id = $1) AS people,
       (SELECT COUNT(*) FROM hr_days      WHERE realm_id = $1) AS days,
       (SELECT COUNT(*) FROM hr_leaves    WHERE realm_id = $1) AS leaves,
       (SELECT COUNT(*) FROM hr_pay_lines WHERE realm_id = $1) AS lines`, [realmId]);
  return r.rows[0];
}
