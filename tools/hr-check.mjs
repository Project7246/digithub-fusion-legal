// Every figure in here is a figure off the company's own September sheet, so the
// formulas can be checked against it rather than taken on trust. Run it before
// pushing anything that touches hr.js or hrpay.js:
//
//   npm run check:hr
//
// It touches no database - the arithmetic is deliberately pure, which is what
// makes it checkable at all.
import { figurePool, workDaysOf, journalFor, isFinal, whyShut } from '../hrpay.js';
import { dayFigures, cycleOf, dayText, minutesOf, eachDay, HR_POLICY, lateRuleFor } from '../hr.js';
import { worksheet, figureAll, explainAll, RULES, lateDaysLost,
         exampleSheet } from '../hrrules.js';

let fails = 0;
function is(label, got, want) {
  const ok = String(got) === String(want);
  if (!ok) fails++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label + ' -> ' + got + (ok ? '' : ' (wanted ' + want + ')'));
}

// ---- dates, as the biometric export writes them ----
is('8/26/2026', dayText('8/26/2026'), '2026-08-26');
is('02 Nov style ISO', dayText('2026-09-05'), '2026-09-05');
is('26/08/2026 (day first)', dayText('26/08/2026'), '2026-08-26');
is('not a date', dayText('Public holiday'), 'null');
// what a spreadsheet actually hands over when its cells are left raw
is('serial 45292 is 1 Jan 2024', dayText(45292), '2024-01-01');
is('serial 46260 is 26 Aug 2026', dayText(46260), '2026-08-26');
is('serial 0 is not a date', dayText(0), 'null');
is('a date in a clock column is not midnight', minutesOf(46260), 'null');
is('a time as a fraction', minutesOf(0.3763888888888889), 542);
is('a date and time together', minutesOf(46260.3763888888888889), 542);
is('09:02:00', minutesOf('09:02:00'), 542);
is('5:04 PM', minutesOf('5:04 PM'), 1024);
is('Public holiday is no time', minutesOf('Public holiday'), 'null');

// ---- the cycle: 26th to 25th ----
const c = cycleOf('2026-09', HR_POLICY);
is('cycle from', c.from, '2026-08-26');
is('cycle to', c.to, '2026-09-25');
is('cycle days', eachDay(c.from, c.to).length, 31);

// ---- one day, against the sheet's own rows ----
const p = HR_POLICY;
const csr = { department: 'CSR' };
// off their log: in at 09:07 is under the 09:10 grace, so no lateness
is('09:07 is not late', dayFigures({ status:'present', clock_in:'09:07', clock_out:'17:11' }, p, csr).late, 0);
// 09:13 is three minutes late
is('09:13 is 3 late', dayFigures({ status:'present', clock_in:'09:13', clock_out:'17:00' }, p, csr).late, 3);
// out 17:27 -> 12 minutes of overtime (their S column said 00:12)
is('17:27 is 12 OT', dayFigures({ status:'present', clock_in:'09:02', clock_out:'17:27' }, p, csr).ot, 12);
// out 18:30 -> capped at 17:45, so 30 minutes and no more
is('OT caps at 30', dayFigures({ status:'present', clock_in:'09:00', clock_out:'18:30' }, p, csr).ot, 30);
// logistics get no overtime at all
is('no OT for logistics', dayFigures({ status:'present', clock_in:'09:00', clock_out:'17:40' }, p, { department:'Logistic' }).ot, 0);
// an absence is not a punctual day
is('absent has no lateness', dayFigures({ status:'absent', clock_in:'Absent' }, p, csr).late, 0);
is('half day is half', dayFigures({ status:'ahalf', clock_in:'08:54', clock_out:'13:59' }, p, csr).days, 0.5);
is('logistics late rule', lateRuleFor(p, { department:'Logistic' }), 'minutes2x');
is('CSR late rule', lateRuleFor(p, { department:'CSR' }), 'days');


// ---- the rules, each against a figure off their September sheet ----
//
// This is the proof that moving the arithmetic into hrrules.js moved no money.
// Every expected number below is one the company's own working sheet printed,
// and the person it belonged to is deliberately not named.

function sheetOf(o) { return worksheet(Object.assign({ monthDays: 30, dutyMinutes: 480 }, o)); }
const money = (o, head) => figureAll(sheetOf(o))[head];

// an office salary, a full clear month, an hour and three quarters of overtime
const office = { basic: 40000, workDays: 30, overtimeMinutes: 103,
                 overtimePaid: true, bonusPaid: true, lateRule: 'days' };
is('basic for a full month', money(office, 'Basic Salary'), 40000);
is('overtime at the minute rate', money(office, 'Overtime'), 287);
is('one clear month is one day of basic',
   Math.round(money(office, 'Attendance Bonus') * 100) / 100, 1333.33);

// the same month with one day absent: the bonus goes entirely
is('one absence takes the whole bonus',
   money(Object.assign({}, office, { absentDays: 1 }), 'Attendance Bonus'), 0);
is('one day of leave takes it too',
   money(Object.assign({}, office, { leaveDays: 1 }), 'Attendance Bonus'), 0);
is('a part month does not earn it',
   money(Object.assign({}, office, { workDays: 19 }), 'Attendance Bonus'), 0);

// the logistics floor: by the minute, doubled past the first hour
const floor = { basic: 27500, workDays: 30, lateRule: 'minutes2x', lateMinutes: 90,
                absentDays: 3, halfDays: 1 };
is('late by the minute, doubled past an hour', money(floor, 'Late Fine'), 230);
is('three days absent', money(floor, 'Absent Fine'), 2750);
is('one unapproved half day',
   Math.round(money(floor, 'Half Day Fine') * 100) / 100, 458.33);
is('seventeen minutes late on the floor',
   money({ basic: 25000, workDays: 30, lateRule: 'minutes2x', lateMinutes: 17 }, 'Late Fine'), 30);

// the office rule: a whole day of basic after every third late arrival
const three = { basic: 100000, workDays: 30, lateRule: 'days', lateDays: 3 };
is('three late days cost one day', money(three, 'Late Fine'), 3334);
is('two late days cost nothing yet',
   money(Object.assign({}, three, { lateDays: 2 }), 'Late Fine'), 0);
is('six late days cost two',
   money(Object.assign({}, three, { lateDays: 6 }), 'Late Fine'), 6667);
is('the whole days lost are counted, not the remainder',
   lateDaysLost(sheetOf({ lateDays: 8, latePer: 3 })), 2);

// an office salary with two absences and a half day
const two = { basic: 25000, workDays: 30, lateRule: 'days', absentDays: 2, halfDays: 1 };
is('two days absent', money(two, 'Absent Fine'), 1667);
is('and the half day',
   Math.round(money(two, 'Half Day Fine') * 100) / 100, 416.67);

// no overtime unless the department is paid for it
is('a floor packer is paid no overtime',
   money({ basic: 25000, workDays: 30, overtimeMinutes: 200, overtimePaid: false }, 'Overtime'), 0);
is('an extra day granted is paid whatever the department',
   money({ basic: 30000, workDays: 30, overtimePaid: false, extraOvertimeDays: 1 }, 'Overtime'), 1000);

// **Every rule gives a positive amount.** The sign is the head's kind and is
// applied in one place - their sheet put a minus inside some fine formulas and
// not others, which is how a fine gets added on one row and taken off the next.
const everything = sheetOf({ basic: 30000, workDays: 30, lateMinutes: 90, lateDays: 3,
  overtimeMinutes: 60, absentDays: 1, halfDays: 1, overtimePaid: true,
  bonusPaid: true, lateRule: 'days', parcelFineShare: 500 });
const all = figureAll(everything);
is('no rule returns a negative', Object.keys(all).every(h => all[h] >= 0), true);
is('every rule answered', Object.keys(all).length, RULES.length);

// every rule can say what it is and show its own sum, for any employee
const why = explainAll(everything);
is('every rule says what it is', why.every(x => x.what && x.what.length > 20), true);
is('every rule shows its sum', why.every(x => x.sum && x.sum.length > 3), true);
is('every rule says how', why.every(x => x.how && x.how.length > 10), true);

// and the policy screen's made-up example works out without throwing
const ex = explainAll(exampleSheet(HR_POLICY));
is('the worked example is complete', ex.length, RULES.length);
is('the worked example has figures', ex.some(x => x.amount > 0), true);

// ---- the pools, against their September sheet ----
const parcel = figurePool('parcel', {
  sources: [{ name:'PC', count:250 }, { name:'MR', count:34792 }],
  slabs: [{ upto:6000, rate:1.5 }, { upto:null, rate:2 }],
  persons: ['1','2','3','4','5','6']
});
is('parcels counted', parcel.count, 35042);
is('parcel bonus total', parcel.total, 67084);
is('parcel bonus each (sheet: 11181)', parcel.each, 11181);

const fine = figurePool('parcelfine', {
  cats: [{ name:'Damaged', count:99, rate:500 },
         { name:'Missing', count:159, rate:250 },
         { name:'Wrong', count:25, rate:250 }],
  share: 0.5,
  persons: ['1','2','3','4','5','6']
});
is('fine total', fine.total, 95500);
is('parcel fine each (sheet: 7959)', fine.each, 7959);

const order = figurePool('order', {
  brands: [{ name:'MissRose', orders:946, amount:2812087.55 },
           { name:'PureClans', orders:0, amount:0 }],
  rate: 0.02,
  persons: ['1','2','3','4','5','6']
});
is('order bonus total', order.total, 56241.75);
is('order bonus each (sheet: 9373.63)', Math.round(order.each * 100) / 100, 9373.63);

// ---- the days somebody was on the payroll ----
is('full cycle is the month days, not 31',
   workDaysOf({ joined_on:'2019-10-19' }, c, 30), 30);
is('joined on the 7th', workDaysOf({ joined_on:'2026-09-07' }, c, 30), 19);
is('left mid cycle', workDaysOf({ joined_on:'2020-01-01', left_on:'2026-09-07' }, c, 30), 13);
is('joined after the cycle', workDaysOf({ joined_on:'2026-11-01' }, c, 30), 0);

// ---- a month that has been signed off is shut ----
// The figures of a finished month are the figures. A policy changed in November
// must not move October's slips, and that is what these two answer.
is('an open month is not final', isFinal({ state: 'open' }), false);
is('a signed-off month is final', isFinal({ state: 'approved' }), true);
is('a posted month is final', isFinal({ state: 'posted' }), true);
is('an open month has nothing to say', whyShut({ state: 'open' }), 'null');
is('a signed-off month says why it is shut',
   /signed off/.test(whyShut({ state: 'approved' })), true);
is('a posted month names its entry',
   /SAL-2026-09/.test(whyShut({ state: 'posted', qb_doc_number: 'SAL-2026-09' })), true);
is('nothing at all is not a month', whyShut(null), 'null');

// ---- the journal balances ----
// earn 128304, deductions -20500, so net 107804 and 100000 still owed
const w = { totals: { people:2, net:107804, paid:7804,
  heads: { 'Basic Salary':120000, 'Overtime':500, 'Late Fine':-300,
           'Food Allowance':7804, 'Loan Deduction':-20200 } } };
const pol = { accounts: { 'Basic Salary':'1', 'Overtime':'2', 'Late Fine':'3',
  'Food Allowance':'4', 'Loan Deduction':'5', 'Paid During Month':'6' },
  payableAccount:'7' };
const j = journalFor(w, pol);
is('journal balances', j.balanced, true);
is('journal nothing missing', j.missing.length, 0);
is('journal debit', j.debit, 128304);
is('journal credit', j.credit, 128304);
const j2 = journalFor(w, { accounts:{}, payableAccount:'' });
is('journal names what is missing', j2.missing.length > 0, true);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall good');
process.exit(fails ? 1 : 0);
