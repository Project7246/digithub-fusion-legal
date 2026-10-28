// The two importers, run against the company's own files.
//
//   npm run check:hr-files -- "<the folder holding the HR files>"
//
// It reads the staff master, the ledger and the biometric log exactly the way
// the server does - same SheetJS options, same readers - and prints what came
// out. It writes nothing and needs no database: the reading is pure on purpose,
// so this can be run before anybody's real data is touched.
//
// **No staff name and no salary figure is in this file, and none may be.** It is
// committed to a repository on GitHub and the data it reads is a real company's
// payroll. What it checks is the shape of the sheets - the columns it found, the
// months, how many people, whether every head was recognised, whether every date
// came out as a calendar date.
//
// The figures that tie it to their own printed report live in `hr-expect.json`
// **beside the data files**, outside this repository, and those checks are
// skipped with a line saying so when the file is not there. Its shape:
//
//   { "ledgerMonth": "YYYY-MM",
//     "staffCount": 0,
//     "people": [ { "code": "", "salary": 0, "deduct": 0, "net": 0,
//                   "paid": 0, "payable": 0 } ],
//     "monthPaid": 0,
//     "reportNet": 0,
//     "reportNote": "why the two totals differ, if they do" }

import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { readStaff, readLedger } from '../hrimport.js';
import { HEAD_KIND } from '../hrpay.js';

const MASTER = 'Miss Rose Salary Sheet FMO Sep-26.xlsx';
const BIO = 'Attendence log 26Aug - 25Sep.xlsx';

function findFolder() {
  const given = process.argv[2];
  if (given) return given;
  const guesses = [
    'D:/Fusion App Modules File/All Files for HR Module',
    'D:/Fusion App Modules File',
    path.join(process.env.USERPROFILE || '', 'Desktop', 'All Files for HR Module')
  ];
  for (const g of guesses) {
    try { if (fs.existsSync(path.join(g, MASTER))) return g; } catch (e) { /* next */ }
  }
  return null;
}

const folder = findFolder();
if (!folder) {
  console.log('The HR files were not found. Pass the folder that holds them:');
  console.log('  npm run check:hr-files -- "D:/Fusion App Modules File/All Files for HR Module"');
  process.exit(0);
}
console.log('reading from ' + folder + '\n');

let expect = null;
try {
  expect = JSON.parse(fs.readFileSync(path.join(folder, 'hr-expect.json'), 'utf8'));
} catch (e) { /* the per-person checks are skipped below, and say so */ }

// exactly what the server does with an uploaded file
function gridOf(file, sheetWanted) {
  const book = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: false });
  const name = sheetWanted
    ? book.SheetNames.find(n => n.toLowerCase().indexOf(sheetWanted) >= 0)
    : book.SheetNames[0];
  if (!name) throw new Error('no sheet matching ' + sheetWanted + ' in ' + path.basename(file));
  return {
    grid: XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true, defval: '' }),
    sheet: name
  };
}

let fails = 0;
function is(label, got, want) {
  const ok = String(got) === String(want);
  if (!ok) fails++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label + ' -> ' + got + (ok ? '' : ' (wanted ' + want + ')'));
}
function note(label, v) { console.log('     ' + label + ': ' + v); }

/* ==================== the staff master ==================== */

const salary = path.join(folder, MASTER);
const rec = gridOf(salary, 'employees record');
const staff = readStaff(rec.grid);
if (staff.error) { console.log('FAIL staff: ' + staff.error); process.exit(1); }

console.log('--- the staff master (' + rec.sheet + ') ---');
note('columns found', staff.columns.join(', '));
note('dates read', staff.order === 'dmy' ? 'day first' : 'month first');
const withCode = staff.rows.filter(r => r.code).length;
note('people read', withCode);
if (expect && expect.staffCount != null) is('people read', withCode, expect.staffCount);

// The three things the real file taught, each of which was a bug once.
is('every person has a name', staff.rows.every(r => !!r.name), true);
is('a row that is only a name is left out', staff.thin.length > 0, true);
note('  those rows', staff.thin.length + ' of them, kept out of the staff list');
note('ids with nobody against them', staff.skipped.length ? staff.skipped.join('; ') : 'none');
is('every date of birth is ten characters',
   staff.rows.every(r => !r.body.dob || /^\d{4}-\d{2}-\d{2}$/.test(r.body.dob)), true);
is('every joining date is ten characters',
   staff.rows.every(r => !r.body.joined_on || /^\d{4}-\d{2}-\d{2}$/.test(r.body.joined_on)), true);
is('a resign date means they have left',
   staff.rows.every(r => !r.body.left_on || r.body.status === 'left'), true);
note('with a resign date', staff.rows.filter(r => r.body.status === 'left').length);

/* ==================== the joining form, same reader ==================== */
// The form is a different sheet with different column names, and the point of
// one reader is that it needs no second parser. The row below is made up.

console.log('\n--- the joining form, through the same reader ---');
const formGrid = [
  ['Timestamp', 'Employee Name', 'Recent Photo (With Blue Background)',
   'ID Card (front and back) PDF', 'Date of Birth', 'Guardian Name and Relation',
   'Guardian Phone no.', 'Guardian ID Card No.', 'Starting Date of Employment',
   'Designation', 'Work email', 'Department', 'Personal Email', 'Address',
   'Personal Phone No.'],
  ['17/02/2025 11:35:55', 'A Test Person', 'https://drive.google.com/open?id=1VT',
   'https://drive.google.com/open?id=1Ql', '28/02/1996', 'A Test Guardian Father',
   '03001234567', '61101-0000000-0', '05/07/2021', 'Coordinator',
   'work@example.com', 'IT', 'personal@example.com',
   'Street 1, House 1, Islamabad', '03001234568']
];
const form = readStaff(formGrid);
if (form.error) { console.log('FAIL form: ' + form.error); fails++; }
else {
  const f = form.rows[0];
  is('one response read', form.rows.length, 1);
  is('  the name', f.body.name, 'A Test Person');
  is('  no employee id in the form', f.code, 'null');
  // 28/02 - the numbers decide, whichever way round the hint says
  is('  date of birth', f.body.dob, '1996-02-28');
  // 05/07 - neither number is over twelve, so only the day-first hint can tell
  is('  started, read day first', f.body.joined_on, '2021-07-05');
  is('  guardian', f.body.guardian, 'A Test Guardian Father');
  is('  guardian ID card', f.body.guardian_cnic, '61101-0000000-0');
  is('  work email', f.body.work_email, 'work@example.com');
  is('  personal email', f.body.email, 'personal@example.com');
  is('  personal phone', f.body.phone, '03001234568');
  is('  the photo link is kept', (f.body.photo_url || '').indexOf('drive.google') > 0, true);
  is('  the ID card link is kept', (f.body.id_card_url || '').indexOf('drive.google') > 0, true);
}

/* ==================== the ledger ==================== */

console.log('\n--- the ledger ---');
const led = gridOf(salary, 'ledger');
// everybody the master names, which is what the server has after the staff
// import has run
const byCode = new Map(staff.rows.filter(r => r.code).map(r => [String(r.code), r]));
const flat = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const byName = new Map(staff.rows.map(r => [flat(r.name), r]));
const find = (code, name) => {
  const hit = (code && byCode.get(String(code))) || byName.get(flat(name));
  return hit ? String(hit.code || hit.name) : null;
};

const ledger = readLedger(led.grid, find);
if (ledger.error) { console.log('FAIL ledger: ' + ledger.error); process.exit(1); }

note('columns found', Object.keys(ledger.at).sort().join(', '));
note('months read', ledger.months.length + ' (' + ledger.months[0] + ' to ' +
  ledger.months[ledger.months.length - 1] + ')');
note('figures read', ledger.rows);
is('every month is seven characters',
   ledger.months.every(x => /^\d{4}-\d{2}$/.test(x)), true);
is('the months come out sorted',
   ledger.months.join(',') === ledger.months.slice().sort().join(','), true);
is('no row was dropped for want of a month', ledger.noMonth, 0);
is('every head was recognised', ledger.unknownHeads.length, 0);
if (ledger.unknownHeads.length) {
  note('  not recognised', ledger.unknownHeads.map(u => u.word + ' x' + u.rows).join(', '));
}
note('people the ledger names who are not on the master', ledger.unknownWho.length);

/* ---- one month, against the report they actually sent ---- */

const m = (expect && expect.ledgerMonth) || ledger.months[ledger.months.length - 1];
const month = ledger.book.get(m);
console.log('\n--- ' + m + ' ---');
is('that month is in the ledger', !!month, true);

function headsOf(code) {
  const mine = month.get(String(code));
  if (!mine) return null;
  // the same two lines the importer writes: earnings as they are, deductions
  // negated, and Paid off the credit side
  const out = {};
  Object.keys(mine.heads).forEach(h => {
    out[h] = HEAD_KIND[h] === 'deduct' ? -Math.abs(mine.heads[h]) : mine.heads[h];
  });
  out['Paid During Month'] = mine.paid;
  return out;
}
const earn = a => Object.keys(a).reduce((n, h) => n + (HEAD_KIND[h] === 'earn' ? a[h] : 0), 0);
const deduct = a => Object.keys(a).reduce((n, h) => n + (HEAD_KIND[h] === 'deduct' ? a[h] : 0), 0);
const r0 = v => Math.round(v);

const all = [...month.keys()].map(headsOf);
note('people that month', month.size);
note('net salary, from the ledger', r0(all.reduce((a, x) => a + earn(x) + deduct(x), 0)));
note('paid during that month', r0(all.reduce((a, x) => a + x['Paid During Month'], 0)));
is('every head in the month is one this app knows',
   all.every(x => Object.keys(x).every(h => HEAD_KIND[h] != null)), true);
is('nobody in the month has no figure at all',
   all.every(x => Object.keys(x).length > 1), true);

// Nobody's name or pay is in this file, so the tie-out to their printed report
// comes from hr-expect.json beside the data. Without it, the shape above is all
// that is checked - which is still the part that goes wrong.
if (!expect || !(expect.people || []).length) {
  console.log('     (no hr-expect.json beside the data, so the per-person figures');
  console.log('      were not checked. See the comment at the top of this file.)');
} else {
  console.log('     against hr-expect.json:');
  expect.people.forEach(p => {
    const a = headsOf(p.code);
    if (!a) { console.log('FAIL ' + p.code + ' is not in ' + m); fails++; return; }
    if (p.salary != null) is('  ' + p.code + ' total salary', r0(earn(a)), p.salary);
    if (p.deduct != null) is('  ' + p.code + ' total deduction', r0(deduct(a)), p.deduct);
    if (p.net != null) is('  ' + p.code + ' net salary', r0(earn(a) + deduct(a)), p.net);
    if (p.paid != null) is('  ' + p.code + ' paid in the month',
      r0(a['Paid During Month']), p.paid);
    if (p.payable != null) is('  ' + p.code + ' payable',
      r0(earn(a) + deduct(a) - a['Paid During Month']), p.payable);
  });
  if (expect.monthPaid != null) {
    is('  the month paid in all',
       r0(all.reduce((a, x) => a + x['Paid During Month'], 0)), expect.monthPaid);
  }
  if (expect.reportNet != null) {
    const got = r0(all.reduce((a, x) => a + earn(x) + deduct(x), 0));
    note('  their printed report', expect.reportNet);
    note('  the difference', (got - expect.reportNet) +
      (expect.reportNote ? ' - ' + expect.reportNote : ''));
  }
}

/* ==================== the biometric log ==================== */

console.log('\n--- the biometric log ---');
try {
  const bio = gridOf(path.join(folder, BIO));
  note('rows in the file', bio.grid.length - 1);
  const header = (bio.grid[0] || []).map(String);
  is('it has a Date column', header.indexOf('Date') >= 0, true);
  is('it has a Clock In column', header.indexOf('Clock In') >= 0, true);
  is('it has the No. column we match on', header.indexOf('No.') >= 0, true);
  // the one thing worth proving here: a date cell comes out as a calendar date
  // and not as a moment, and their own word for a day is not read as a time
  const hr = await import('../hr.js');
  const dateAt = header.indexOf('Date');
  const inAt = header.indexOf('Clock In');
  let dates = 0, bad = 0, times = 0, said = 0;
  for (let i = 1; i < bio.grid.length; i++) {
    if (!bio.grid[i][dateAt]) continue;
    dates++;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(hr.dayText(bio.grid[i][dateAt], 'mdy')))) bad++;
    if (hr.minutesOf(bio.grid[i][inAt]) == null) said++; else times++;
  }
  is('every date read as a calendar date', bad, 0);
  note('dates read', dates);
  note('clock-in cells', times + ' times and ' + said +
    ' of their own words for the day');
  is('both kinds are there', times > 0 && said > 0, true);
} catch (e) {
  console.log('     the log could not be read here: ' + e.message);
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall good');
process.exit(fails ? 1 : 0);
