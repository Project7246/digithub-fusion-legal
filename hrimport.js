import { pool } from './db.js';
import {
  dayText, monthText, listEmployees, addEmployee, saveEmployee, nextEmpCode,
  hrPolicy
} from './hr.js';
import { HEADS, HEAD_KIND } from './hrpay.js';

// ==================== Bringing the old books in ====================
//
// The company has been running this by hand for years, and the files are the
// files: a staff master with everybody's details on it, a Google form each new
// joiner fills in, and a ledger holding every rupee paid to every person since
// February 2025. None of that is history to be thrown away - it is what the
// module has to be able to show before anybody will trust it.
//
// Two importers, and both of them **read their sheets, they do not reshape
// them**. Where a column is named differently in the two staff files, the alias
// is in the hints below; where a word in the ledger is not a head this app
// knows, it is handed back by name rather than guessed at.
//
// **The reading is pure and the writing is not**, and they are two functions on
// purpose: `readStaff()` and `readLedger()` take a grid and give back what is in
// it, touching no database, which is what makes them testable against the
// company's own September files (`npm run check:hr`). A parser nobody can run
// against the real file is a parser nobody can trust.

const CLEAN = v => {
  if (v == null) return null;
  const s = String(v).trim();
  return s && s !== 'null' && s !== 'undefined' ? s : null;
};

const words = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase();
const loose = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

// A column is claimed once. Without that, 'ID Card (front and back) PDF' and
// 'Employee ID' fight over the same hints and one of them loses silently.
export function mapColumns(header, hints) {
  const low = (header || []).map(words);
  const at = {};
  const used = new Set();

  // the whole name first, for every field, before anything is matched loosely
  Object.keys(hints).forEach(field => {
    for (const want of hints[field]) {
      const i = low.indexOf(want);
      if (i >= 0 && !used.has(i)) { at[field] = i; used.add(i); return; }
    }
  });
  // then a column that merely starts with one of the names
  Object.keys(hints).forEach(field => {
    if (at[field] != null) return;
    for (const want of hints[field]) {
      const i = low.findIndex((h, j) => h && !used.has(j) && h.indexOf(want) === 0);
      if (i >= 0) { at[field] = i; used.add(i); return; }
    }
  });
  return at;
}

// The header is the row that answers to the most of the names, not row one -
// their ledger keeps a title above it and their staff master keeps two.
function findHeader(grid, hints, need) {
  let best = 0, score = -1;
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const at = mapColumns(grid[r] || [], hints);
    const has = (need || []).every(k => at[k] != null);
    const s = Object.keys(at).length + (has ? 100 : 0);
    if (s > score) { score = s; best = r; }
  }
  return best;
}

/* ==================== the staff master ==================== */
//
// Reads both files the company already has:
//
//   Employees Record  - Employee ID, Name, Department, Bank Account No.,
//                       Designation, Grade, DOB, Joining Date, Phone, both
//                       emails, Guardian and their phone and ID, Address,
//                       Resign Date
//   the Google form   - Employee Name, Recent Photo, ID Card PDF, Date of
//                       Birth, Guardian Name and Relation, Guardian Phone no.,
//                       Guardian ID Card No., Starting Date of Employment,
//                       Designation, Work email, Department, Personal Email,
//                       Address, Personal Phone No.
//
// The form has no employee id and the same person often filled it twice, so a
// row with no id is matched on the name and the later row simply corrects the
// earlier one - which is what a second form submission means.

export const STAFF_HINTS = {
  code:          ['employee id', 'emp id', 'employee no', 'employee code', 'emp no.', 'emp no'],
  name:          ['employee name', 'name', 'full name', 'staff name'],
  dept:          ['department', 'dept'],
  designation:   ['designation', 'job title', 'position'],
  grade:         ['grade', 'pay scale'],
  bank:          ['bank account no.', 'bank account no', 'bank account', 'iban', 'account no'],
  dob:           ['dob', 'date of birth'],
  joined:        ['joining date', 'starting date of employment', 'date of joining', 'joined on'],
  resign:        ['resign date', 'resignation date', 'date of leaving', 'left on'],
  phone:         ['phone number', 'personal phone no.', 'personal phone no', 'phone', 'mobile', 'contact no'],
  email:         ['personal email', 'personal email address', 'email address', 'email'],
  workEmail:     ['work email', 'official email', 'company email'],
  guardian:      ['guardian name and relation', 'guardian name', 'guardian', 'father name'],
  guardianPhone: ['guardian phone no.', 'guardian phone no', 'guardian phone', 'guardian contact'],
  guardianCnic:  ['guardian id card no.', 'guardian id card', 'guardian cnic', 'guardian id'],
  cnic:          ['id card no.', 'id card no', 'cnic', 'nic', 'id card number'],
  photo:         ['recent photo (with blue background)', 'recent photo', 'photo', 'picture'],
  idCard:        ['id card (front and back) pdf', 'id card (front and back)', 'id card pdf'],
  address:       ['address', 'home address', 'house address', 'residential address'],
  basic:         ['basic salary', 'basic pay', 'basic']
};

// The grid, read. No database, no decisions - what each row says about a person
// and nothing else.
//
// Dates in both staff files are written **day first** - the Google form stamps
// `17/02/2025` and the master sheet is filled in by the same people - so that is
// what a slash date is read as here. Where the sheet carries real date cells,
// which the master does, nothing is being guessed at all.
export function readStaff(grid, opts) {
  const order = (opts && opts.dateOrder) || 'dmy';
  if (!grid || !grid.length) return { error: 'That sheet is empty.' };

  const h = findHeader(grid, STAFF_HINTS, ['name']);
  const at = mapColumns(grid[h] || [], STAFF_HINTS);
  if (at.name == null) return { error: 'No Employee Name column in that sheet.' };

  const rows = [];
  const skipped = [];
  const thin = [];

  for (let r = h + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const name = CLEAN(row[at.name]);
    const code = at.code != null ? CLEAN(row[at.code]) : null;
    // A row with neither is the blank space under the table, or one of the
    // dropdown lists they keep off to the side of it.
    if (!name && !code) continue;
    if (!name) { skipped.push('row ' + (r + 1) + ': an id with no name'); continue; }

    const body = {
      name,
      department:     at.dept != null ? CLEAN(row[at.dept]) : undefined,
      designation:    at.designation != null ? CLEAN(row[at.designation]) : undefined,
      grade:          at.grade != null ? CLEAN(row[at.grade]) : undefined,
      bank_account:   at.bank != null ? CLEAN(row[at.bank]) : undefined,
      dob:            at.dob != null ? dayText(row[at.dob], order) : undefined,
      joined_on:      at.joined != null ? dayText(row[at.joined], order) : undefined,
      phone:          at.phone != null ? CLEAN(row[at.phone]) : undefined,
      email:          at.email != null ? CLEAN(row[at.email]) : undefined,
      work_email:     at.workEmail != null ? CLEAN(row[at.workEmail]) : undefined,
      guardian:       at.guardian != null ? CLEAN(row[at.guardian]) : undefined,
      guardian_phone: at.guardianPhone != null ? CLEAN(row[at.guardianPhone]) : undefined,
      guardian_cnic:  at.guardianCnic != null ? CLEAN(row[at.guardianCnic]) : undefined,
      cnic:           at.cnic != null ? CLEAN(row[at.cnic]) : undefined,
      photo_url:      at.photo != null ? CLEAN(row[at.photo]) : undefined,
      id_card_url:    at.idCard != null ? CLEAN(row[at.idCard]) : undefined,
      address:        at.address != null ? CLEAN(row[at.address]) : undefined
    };
    if (at.basic != null && Number(row[at.basic])) body.basic = Number(row[at.basic]);

    // Somebody with a resign date has left, and the date is when. Nothing about
    // them is deleted - every day they worked and every slip they were paid
    // stays exactly where it is.
    const left = at.resign != null ? dayText(row[at.resign], order) : null;
    if (left) { body.left_on = left; body.status = 'left'; }

    // Nothing is thrown away by an import: a box that is empty in the sheet
    // leaves whatever is in the database alone.
    Object.keys(body).forEach(k => {
      if (body[k] === undefined || body[k] === null) delete body[k];
    });
    body.name = name;

    // **A row that is nothing but a name is not a person.** The tail of their
    // staff master is a hundred and fifty names kept there to fill a dropdown
    // with, and importing those would have made a hundred and fifty employees
    // with new ids and nothing in them. A real row carries an employee id, or
    // at least one detail besides the name.
    const detail = Object.keys(body).filter(k => k !== 'name').length;
    if (!code && !detail) {
      thin.push(name);
      continue;
    }

    rows.push({ code, name, body, row: r + 1 });
  }

  return { at, columns: Object.keys(at).sort(), rows, skipped, thin, order,
           header: (grid[h] || []).map(x => String(x == null ? '' : x)) };
}

export async function importStaff(realmId, grid, opts) {
  const o = opts || {};
  const read = readStaff(grid, o);
  if (read.error) return read;

  const policy = await hrPolicy(realmId);
  const already = await listEmployees(realmId, { all: true });
  const byCode = new Map(already.map(p => [String(p.emp_code), p]));
  const byName = new Map(already.map(p => [loose(p.name), p]));

  const made = [], changed = [], trouble = [];
  let next = Number(await nextEmpCode(realmId, policy));

  for (const r of read.rows) {
    const known = (r.code && byCode.get(String(r.code))) || byName.get(loose(r.name));
    try {
      if (known) {
        if (o.dryRun) { changed.push(known.emp_code + ' ' + r.name); continue; }
        const out = await saveEmployee(realmId, known.emp_code, r.body);
        if (out.error) { trouble.push(r.name + ': ' + out.error); continue; }
        byName.set(loose(r.name), out.employee);
        byCode.set(String(out.employee.emp_code), out.employee);
        changed.push(known.emp_code + ' ' + r.name);
      } else {
        const give = r.code || String(next++);
        if (o.dryRun) { made.push(give + ' ' + r.name); continue; }
        // An imported record is **not** verified. Every one of these people
        // confirms their own details the first time they sign in, which is
        // exactly what was asked for.
        const out = await addEmployee(realmId,
          Object.assign({ emp_code: give, form_state: 'pending' }, r.body), policy);
        if (out.error) { trouble.push(r.name + ': ' + out.error); continue; }
        byName.set(loose(r.name), out.employee);
        byCode.set(String(out.employee.emp_code), out.employee);
        made.push(out.employee.emp_code + ' ' + r.name);
      }
    } catch (e) {
      trouble.push(r.name + ': ' + e.message);
    }
  }

  return { ok: true, dryRun: !!o.dryRun, columns: read.columns,
           header: read.header, dateOrder: read.order,
           made, changed, skipped: read.skipped, thin: read.thin, trouble };
}

/* ==================== the ledger ==================== */
//
// Their ledger is the whole of the money, and its shape is:
//
//   Date | Month | Employees | Debit Head | Parameter | Parameter 2 |
//   Credit Head | Amount
//
// Two columns carry the meaning and both are needed:
//
//   **Debit Head** is the salary head - Basic Salary, Late Fine, Food Allowance
//   **Credit Head** is the side: Payable (owed to them), Receivable (owed by
//   them) or **Paid** (handed over during the month)
//
// Their own report reads it as `SUMIF` on the debit head for the salary
// columns, `-SUMIF` for the deduction columns, and `SUMIF` on the **credit**
// head for the Paid column. This reads it the same way, so the figures that
// come out are the figures on the report they already send.

export const LEDGER_HINTS = {
  month:    ['month'],
  day:      ['date'],
  employee: ['employees', 'employee', 'employee name', 'staff'],
  head:     ['debit head', 'head', 'salary head', 'description'],
  credit:   ['credit head', 'credit', 'side'],
  amount:   ['amount', 'amt', 'rs.', 'rs'],
  note:     ['remarks', 'discription', 'note']
};

// Their words for a head, against this app's. Nothing is guessed: a word that
// is not here is handed back by name and its rows are left out, because a rupee
// filed under the wrong head is worse than a rupee nobody imported.
export const HEAD_WORDS = {
  'basic salary': 'Basic Salary',
  'overtime': 'Overtime',
  'ot': 'Overtime',
  'attendance bonus': 'Attendance Bonus',
  'regular bonus': 'Attendance Bonus',
  'performance bonus': 'Performance Bonus',
  'parcel / order bonus': 'Parcel / Order Bonus',
  'parcel/order bonus': 'Parcel / Order Bonus',
  'parcel bonus': 'Parcel / Order Bonus',
  'order bonus': 'Parcel / Order Bonus',
  'managerial allowance': 'Managerial Allowance',
  'managerial bonus': 'Managerial Allowance',
  'travelling allowance': 'Travelling Allowance',
  'travel allowance': 'Travelling Allowance',
  'food allowance': 'Food Allowance',
  'occasional bonus': 'Occasional Bonus',
  'late fine': 'Late Fine',
  'parcel fine': 'Parcel Fine',
  'absent fine': 'Absent Fine',
  'half day fine': 'Half Day Fine',
  'loan deduction': 'Loan Deduction',
  'employee adjustments': 'Employee Adjustments',
  'employee adjustment': 'Employee Adjustments',
  'advance': 'Advance',
  'advance salary / loan': 'Advance',
  'advance salary/loan': 'Advance',
  'credit purchase': 'Credit Purchase',
  // Their debit head "Paid" is not a head at all - it is salary handed over,
  // and the credit side is what says so. It counts towards Paid During Month
  // and towards no salary column, which is how their own report reads it.
  'paid': null,
  'advance salary paid': 'Advance Salary Paid'
};

// 'A Name (15101)' -> { code: '15101', name: 'A Name' }
//
// The id in the brackets is what is matched on, which is why the same person
// written two different ways in their ledger - a full name one month and a short
// one the next, against the same id - comes out as one person and not two.
export function whoFrom(cell) {
  const s = CLEAN(cell);
  if (!s) return null;
  const m = s.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    const code = m[2].replace(/[^0-9A-Za-z-]/g, '');
    return { code: code || null, name: m[1].trim() || s };
  }
  return { code: null, name: s };
}

// Which way a row moves the money, and it is the **credit side that says so** -
// not the head.
//
// This is where their sheet is wrong, and it is wrong by accident rather than
// by policy. Their report reads every salary column as `SUMIF` on the *debit
// head* and ignores the credit side entirely, so a `Parcel Fine | Payable` row -
// a fine being given back - is added to the fine instead of taken off it, and
// an `Advance | Receivable` row - an advance being recovered - makes the advance
// bigger. Sixty-five rows in their ledger are of the first kind.
//
// A ledger has three sides and they mean what they say:
//
//   Payable     the company owes it to them        adds
//   Receivable  they owe it to the company         takes off
//   Paid        it was handed over in the month    adds, and counts as paid
//
// One rule, no exceptions per head, which is also why nothing downstream has to
// know which heads are fines.
export function sideOf(credit) {
  return credit === 'receivable' ? -1 : 1;
}

// What one month of one person comes to. The amounts are already signed by the
// side, so this is a plain sum - an information head (the advance, the credit
// purchase) is left out, because it is a balance worked out later and not part
// of this month's pay.
function netOf(heads) {
  let n = 0;
  Object.keys(heads).forEach(h => {
    if (HEAD_KIND[h] === 'earn' || HEAD_KIND[h] === 'deduct') n += heads[h];
  });
  return n;
}

// The grid, read. `find(code, name)` says which employee a row belongs to and
// is the only thing this needs from outside - so the whole of the parsing can
// be run against the real file without a database anywhere near it.
export function readLedger(grid, find) {
  if (!grid || !grid.length) return { error: 'That sheet is empty.' };

  const h = findHeader(grid, LEDGER_HINTS, ['employee', 'head', 'amount']);
  const at = mapColumns(grid[h] || [], LEDGER_HINTS);
  if (at.employee == null || at.head == null || at.amount == null) {
    return { error: 'That sheet needs an Employees, a Debit Head and an Amount column. ' +
      'This one has: ' + (grid[h] || []).filter(Boolean).join(', ') };
  }

  // month -> code -> { heads: {head: sum}, paid: sum }
  const book = new Map();
  const unknownHead = new Map();
  const unknownWho = new Map();
  const months = new Set();
  let read = 0, noMonth = 0;

  for (let r = h + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const who = whoFrom(row[at.employee]);
    const amt = Number(row[at.amount]);
    // A row with no amount is a heading, a blank, or a line somebody started
    // and left. None of them is a figure.
    if (!who || !isFinite(amt) || !amt) continue;

    const month = monthText(at.month != null ? dayText(row[at.month]) : null) ||
                  monthText(at.day != null ? dayText(row[at.day]) : null);
    if (!month) { noMonth++; continue; }

    const code = find(who.code, who.name);
    if (!code) {
      const key = who.code ? who.name + ' (' + who.code + ')' : who.name;
      const u = unknownWho.get(key) || { name: who.name, code: who.code, rows: 0 };
      u.rows++;
      unknownWho.set(key, u);
      continue;
    }

    const headWord = words(row[at.head]);
    let head;
    if (Object.prototype.hasOwnProperty.call(HEAD_WORDS, headWord)) {
      head = HEAD_WORDS[headWord];
    } else if (HEADS.indexOf(CLEAN(row[at.head])) >= 0) {
      head = CLEAN(row[at.head]);          // already spelled the way we spell it
    } else {
      const u = unknownHead.get(headWord) || { word: CLEAN(row[at.head]), rows: 0 };
      u.rows++;
      unknownHead.set(headWord, u);
      continue;
    }

    months.add(month);
    read++;

    const credit = at.credit != null ? words(row[at.credit]) : '';
    const signed = amt * sideOf(credit);

    const atMonth = book.get(month) || new Map();
    const mine = atMonth.get(String(code)) || { heads: {}, paid: 0 };
    if (head) mine.heads[head] = (mine.heads[head] || 0) + signed;
    if (credit === 'paid') mine.paid += amt;
    atMonth.set(String(code), mine);
    book.set(month, atMonth);
  }

  const monthList = [...months].sort();
  const summary = monthList.map(m => ({
    month: m,
    people: book.get(m).size,
    net: Math.round([...book.get(m).values()].reduce((a, x) => a + netOf(x.heads), 0))
  }));

  return { at, book, rows: read, months: monthList, summary, noMonth,
           unknownHeads: [...unknownHead.values()],
           unknownWho: [...unknownWho.values()] };
}

export async function importLedger(realmId, grid, opts) {
  const o = opts || {};
  const people = await listEmployees(realmId, { all: true });
  const byCode = new Map(people.map(p => [String(p.emp_code), p]));
  const byName = new Map(people.map(p => [loose(p.name), p]));
  const find = (code, name) => {
    const hit = (code && byCode.get(String(code))) || byName.get(loose(name));
    return hit ? String(hit.emp_code) : null;
  };

  const read = readLedger(grid, find);
  if (read.error) return read;

  const out = {
    rows: read.rows, months: read.months, summary: read.summary,
    noMonth: read.noMonth, unknownHeads: read.unknownHeads,
    unknownWho: read.unknownWho
  };

  if (o.dryRun) return Object.assign({ ok: true, dryRun: true }, out);
  if (!read.rows) {
    return { error: 'No row in that sheet matched anybody on the staff list.',
             unknownWho: read.unknownWho };
  }

  // One transaction a month. Twenty months in one is a long lock on a table
  // other people are reading, and a month that fails is a month to do again -
  // not a reason to lose the nineteen that worked.
  let written = 0, kept = 0;
  const done = [];
  for (const month of read.months) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [code, mine] of read.book.get(month)) {
        const lines = Object.assign({}, mine.heads);
        if (mine.paid) lines['Paid During Month'] = mine.paid;

        for (const head of Object.keys(lines)) {
          // Already signed by the credit side (see sideOf). Nothing re-signs it
          // here: a fine that was given back stays given back.
          const amount = lines[head];
          if (!amount) continue;

          // A figure somebody has typed in Fusion is theirs and an import does
          // not overrule it. Anything else - a blank month, or a month brought
          // in before - takes the sheet's figure.
          const r = await client.query(
            `INSERT INTO hr_pay_lines
               (realm_id, month, emp_code, head, amount, source, note)
             VALUES ($1,$2,$3,$4,$5,'import','brought in from the old ledger')
             ON CONFLICT (realm_id, month, emp_code, head) DO UPDATE SET
               amount = $5, source = 'import', updated_at = NOW()
               WHERE hr_pay_lines.source <> 'hand'
             RETURNING head`,
            [realmId, month, code, head, Math.round(amount * 100) / 100]);
          if (r.rowCount) written++; else kept++;
        }
      }
      await client.query('COMMIT');
      done.push(month);
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) { /* over anyway */ }
      client.release();
      return { error: 'Stopped at ' + month + ': ' + e.message,
               months: done, written };
    }
    client.release();
  }

  // Everybody whose basic salary is still nought gets it from the newest month
  // the ledger holds for them. It is the one figure the staff master does not
  // carry and the one the whole calculation turns on, so leaving it at nought
  // would mean every figure worked out after this import came to nothing.
  const basics = await fillBasics(realmId);

  return Object.assign({ ok: true, written, kept, basics }, out, { months: done });
}

async function fillBasics(realmId) {
  const r = await pool.query(
    `UPDATE hr_employees e
        SET basic = sub.amount, updated_at = NOW()
       FROM (
         SELECT DISTINCT ON (emp_code) emp_code, amount
           FROM hr_pay_lines
          WHERE realm_id = $1 AND head = 'Basic Salary' AND amount > 0
          ORDER BY emp_code, month DESC
       ) sub
      WHERE e.realm_id = $1 AND e.emp_code = sub.emp_code
        AND COALESCE(e.basic, 0) = 0`, [realmId]);
  return r.rowCount;
}

/* ==================== taking an import back off ==================== */
//
// A month brought in from the old sheet has to be removable, or there is no way
// to try the calculation on a month the sheet already answered. It takes only
// the rows the import wrote: a figure anybody typed here stays.
export async function clearImported(realmId, month) {
  const m = monthText(month);
  if (!m) return { error: 'That is not a month.' };
  const r = await pool.query(
    `DELETE FROM hr_pay_lines
      WHERE realm_id = $1 AND month = $2 AND source = 'import'`, [realmId, m]);
  return { ok: true, cleared: r.rowCount };
}

// What was brought in, per month, so the screen can say so without guessing.
export async function importedMonths(realmId) {
  const r = await pool.query(
    `SELECT month, COUNT(*)::int AS lines, COUNT(DISTINCT emp_code)::int AS people
       FROM hr_pay_lines
      WHERE realm_id = $1 AND source = 'import'
      GROUP BY month ORDER BY month`, [realmId]);
  return r.rows;
}
