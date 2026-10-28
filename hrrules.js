// ==================== The rules the salary is worked out by ====================
//
// One rule, one entry. Each carries its own name, what it is in a sentence
// anybody can read, how it is worked out in words, and the same sum with real
// numbers in it. The **screen is drawn from this list** - `/payroll` → How it
// runs renders exactly what is below - so what the app does and what the app
// says it does cannot drift apart.
//
// Why it is a list rather than a page of arithmetic: *"system ko itna complex na
// bnao, simple bnao, taky koi layman bhe dkh kr smjh jay ky ye function kis chez
// ka hy"*. A rule you can point at, name, and see a worked example of is a rule
// a manager can argue with. Two hundred lines of nested `if` is not.
//
// And the company's own spreadsheet is **where these came from, not what they
// are**: *"formula sheet calculation mein mistake hu skti hy q ky man made hy"*.
// So each rule is written the standard way and the sheet's own cell is named
// beside it for checking. Where the sheet does something that is plainly an
// accident rather than a policy, the note says so and the rule does the right
// thing instead.

/* ---------- the two things every rule is allowed to do ---------- */
// Round up to whole rupees, which is what their sheet's ROUNDUP does, and keep
// two decimals. Nothing else rounds anywhere.
const up = v => Math.ceil(Number(v) || 0);
const n2 = v => Math.round((Number(v) || 0) * 100) / 100;

// Figures the way they are read aloud: 30,000 and 1,000.00
const r = v => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

/* ==================== the worksheet ==================== */
//
// What a rule is handed. Every name in it is the plain word for the thing, so a
// rule reads as a sentence: `sheet.dayRate * sheet.workDays`. No cell
// references, no abbreviations, nothing a reader has to look up.

export function worksheet(o) {
  const monthDays = Number(o.monthDays) || 30;
  const dutyMinutes = Number(o.dutyMinutes) || 480;
  const basic = Number(o.basic) || 0;
  const dayRate = monthDays ? basic / monthDays : 0;

  return {
    // what they are paid, and over how many days
    basic,
    monthDays,
    workDays: Number(o.workDays) || 0,
    dayRate,
    dutyMinutes,
    minuteRate: dutyMinutes ? dayRate / dutyMinutes : 0,

    // what the attendance says
    //
    // `daysRecorded` is how many days of this cycle anything is known about at
    // all, and it has to be here because **nothing recorded is not a clear
    // month**. Without it the attendance bonus was handed to everybody in a
    // month whose biometric report had not been brought in yet - seventy-four
    // people, most of them with no attendance in the system at any time.
    daysRecorded: Number(o.daysRecorded) || 0,
    lateMinutes: Number(o.lateMinutes) || 0,
    lateDays: Number(o.lateDays) || 0,
    overtimeMinutes: Number(o.overtimeMinutes) || 0,
    absentDays: Number(o.absentDays) || 0,
    halfDays: Number(o.halfDays) || 0,
    approvedHalfDays: Number(o.approvedHalfDays) || 0,
    leaveDays: Number(o.leaveDays) || 0,

    // what somebody decided about this person
    overtimePaid: !!o.overtimePaid,
    bonusPaid: !!o.bonusPaid,
    lateRule: o.lateRule || 'days',
    extraOvertimeDays: Number(o.extraOvertimeDays) || 0,

    // their share of the month's pools, nought where they are not in one
    parcelBonusShare: Number(o.parcelBonusShare) || 0,
    orderBonusShare: Number(o.orderBonusShare) || 0,
    parcelFineShare: Number(o.parcelFineShare) || 0,

    // the few numbers the policy sets that a rule needs
    latePer: Number(o.latePer) || 3,
    halfDayFine: o.halfDayFine !== false
  };
}

// How many whole days of basic the lateness costs. Their sheet calls it
// "Late Day Deduction" and it is `INT(late days / 3)`.
export function lateDaysLost(sheet) {
  return Math.floor(sheet.lateDays / (sheet.latePer || 3));
}

/* ==================== the late fine, which is three rules ==================== */
//
// The company charges lateness three different ways and all three are real
// policy, not an accident: the office loses a whole day after every third late
// arrival, while the logistics floor is charged by the minute because a packer
// twenty minutes late is twenty minutes of parcels nobody packed. The third is
// the same by the minute but doubled past the first hour.
//
// They are named in plain words here, and the plain words are what the policy
// screen offers - not `days` / `minutes` / `minutes2x`, which mean nothing to
// anybody reading them for the first time.

export const LATE_RULES = [
  { key: 'days',
    name: 'A whole day, after every third late arrival',
    how: 'late days ÷ 3, the whole number of them, × one day of basic',
    minutes: false },
  { key: 'minutes',
    name: 'By the minute',
    how: 'minutes late × the basic for one minute',
    minutes: true },
  { key: 'minutes2x',
    name: 'By the minute, doubled past the first hour',
    how: 'the first 60 minutes once, everything after it twice, × the basic for one minute',
    minutes: true }
];

export function lateRuleNamed(key) {
  return LATE_RULES.filter(x => x.key === key)[0] || LATE_RULES[0];
}

function lateFine(sheet) {
  if (sheet.lateRule === 'minutes') return up(sheet.minuteRate * sheet.lateMinutes);
  if (sheet.lateRule === 'minutes2x') {
    const charged = Math.min(sheet.lateMinutes, 60) +
                    Math.max(sheet.lateMinutes - 60, 0) * 2;
    return up(sheet.minuteRate * charged);
  }
  return up(sheet.dayRate * lateDaysLost(sheet));
}

function lateFineSum(sheet) {
  if (sheet.lateRule === 'minutes') {
    return r(sheet.lateMinutes) + ' minutes late x ' + r(n2(sheet.minuteRate)) +
           ' a minute = ' + r(lateFine(sheet));
  }
  if (sheet.lateRule === 'minutes2x') {
    const over = Math.max(sheet.lateMinutes - 60, 0);
    return r(Math.min(sheet.lateMinutes, 60)) + ' minutes at the normal rate' +
           (over ? ' and ' + r(over) + ' doubled' : '') + ' x ' +
           r(n2(sheet.minuteRate)) + ' a minute = ' + r(lateFine(sheet));
  }
  return r(sheet.lateDays) + ' late days / ' + sheet.latePer + ' = ' +
         r(lateDaysLost(sheet)) + ' day' + (lateDaysLost(sheet) === 1 ? '' : 's') +
         ' x ' + r(n2(sheet.dayRate)) + ' = ' + r(lateFine(sheet));
}

/* ==================== the rules ==================== */
//
// `figure(sheet)` is the amount, always as a **positive magnitude**. Whether it
// is added or taken off is the head's own kind and is applied in one place
// (`hrpay.js`), not written into each rule - their sheet puts a minus sign
// inside some formulas and not others, which is how a fine ends up added on one
// row and subtracted on the next.

export const RULES = [
  {
    head: 'Basic Salary',
    what: 'The salary itself, for the days somebody was on the payroll.',
    how: 'basic / days in the month x days on the payroll',
    cell: 'P991',
    figure: s => n2(s.dayRate * s.workDays),
    sum: s => r(s.basic) + ' / ' + s.monthDays + ' x ' + s.workDays + ' days = ' +
              r(n2(s.dayRate * s.workDays))
  },

  {
    head: 'Overtime',
    what: 'The half hour after the duty ends, for the departments that are paid for it.',
    how: 'minutes of overtime x the basic for one minute, rounded up',
    cell: 'Q991',
    note: 'Nobody is paid overtime unless their department is named in the ' +
          'policy. An extra day somebody was granted is added here too.',
    figure: s => n2((s.overtimePaid ? up(s.minuteRate * s.overtimeMinutes) : 0) +
                    s.dayRate * s.extraOvertimeDays),
    sum: s => !s.overtimePaid
      ? 'no overtime for this department' +
        (s.extraOvertimeDays ? ', but ' + s.extraOvertimeDays + ' extra day(s) granted = ' +
          r(n2(s.dayRate * s.extraOvertimeDays)) : '')
      : r(s.overtimeMinutes) + ' minutes x ' + r(n2(s.minuteRate)) + ' a minute = ' +
        r(up(s.minuteRate * s.overtimeMinutes)) +
        (s.extraOvertimeDays ? ' plus ' + s.extraOvertimeDays + ' extra day(s) = ' +
          r(n2(s.dayRate * s.extraOvertimeDays)) : '')
  },

  {
    head: 'Attendance Bonus',
    what: 'One day of basic for a month with nothing missed - no absence, no leave, ' +
          'and the whole month worked.',
    how: 'one day of basic, or nothing at all',
    cell: 'R991',
    note: 'Any single absence or approved leave takes the whole bonus, which is ' +
          'the point of it. Departments named in the policy do not get it, and ' +
          'neither does a month whose attendance has not been brought in yet - ' +
          'nothing recorded is not a clear month.',
    figure: s => (s.bonusPaid && s.daysRecorded && !s.absentDays && !s.leaveDays &&
                  s.workDays >= s.monthDays && s.workDays)
      ? n2(s.basic / s.workDays) : 0,
    sum: s => !s.bonusPaid ? 'this department does not get the bonus'
      : !s.daysRecorded ? 'no attendance recorded for this month, so none of it'
      : s.absentDays ? r(s.absentDays) + ' day(s) absent, so none of it'
      : s.leaveDays ? r(s.leaveDays) + ' day(s) leave, so none of it'
      : s.workDays < s.monthDays ? 'only ' + s.workDays + ' days on the payroll, so none of it'
      : 'a clear month: one day of basic = ' + r(n2(s.basic / s.workDays))
  },

  {
    head: 'Parcel / Order Bonus',
    what: 'Their share of the month\'s parcel bonus, order bonus, or both.',
    how: 'the pool, divided between the people the management ticked',
    cell: 'T991',
    note: 'The figures and the list of who shares in it are typed in on ' +
          'Bonuses and fines. Nothing works them out by itself.',
    figure: s => n2(s.parcelBonusShare + s.orderBonusShare),
    sum: s => !(s.parcelBonusShare + s.orderBonusShare)
      ? 'not in either pool this month'
      : [s.parcelBonusShare ? 'parcel bonus ' + r(s.parcelBonusShare) : null,
         s.orderBonusShare ? 'order bonus ' + r(s.orderBonusShare) : null]
          .filter(Boolean).join(' plus ') + ' = ' +
        r(n2(s.parcelBonusShare + s.orderBonusShare))
  },

  {
    head: 'Late Fine',
    what: 'What coming in late costs, charged the way their department is charged.',
    how: s => lateRuleNamed(s.lateRule).how,
    cell: 'AA991',
    note: 'Lateness only begins after the grace the policy gives, and a day only ' +
          'counts as late once it is past the minutes the policy allows.',
    figure: s => n2(lateFine(s)),
    sum: lateFineSum
  },

  {
    head: 'Parcel Fine',
    what: 'Their share of what went wrong with the month\'s parcels.',
    how: 'the month\'s fines, the share the policy charges, divided between the ' +
         'people the management ticked',
    cell: 'AB991',
    figure: s => n2(s.parcelFineShare),
    sum: s => s.parcelFineShare ? 'share of the month\'s parcel fines = ' +
      r(s.parcelFineShare) : 'not in the parcel fine this month'
  },

  {
    head: 'Absent Fine',
    what: 'A day of basic for every day somebody was absent with no approved leave.',
    how: 'days absent x one day of basic, rounded up',
    cell: 'AC991',
    note: 'An approved leave is not an absence and costs nothing. That one ' +
          'difference is what the whole approval screen exists for.',
    figure: s => n2(up(s.dayRate * s.absentDays)),
    sum: s => !s.absentDays ? 'nothing - no unapproved absence'
      : r(s.absentDays) + ' day(s) x ' + r(n2(s.dayRate)) + ' = ' +
        r(up(s.dayRate * s.absentDays))
  },

  {
    head: 'Half Day Fine',
    what: 'Half a day of basic for each half day nobody approved.',
    how: 'half days not approved x half of one day of basic',
    cell: 'AD991',
    figure: s => s.halfDayFine ? n2(s.halfDays * (s.dayRate / 2)) : 0,
    sum: s => !s.halfDays ? 'nothing - no unapproved half day'
      : r(s.halfDays) + ' x half of ' + r(n2(s.dayRate)) + ' = ' +
        r(n2(s.halfDays * (s.dayRate / 2)))
  }
];

// The heads this list works out, which is what `hrpay.js` calls the auto heads.
export const RULE_HEADS = RULES.map(x => x.head);

export function ruleFor(head) {
  return RULES.filter(x => x.head === head)[0] || null;
}

// Every rule, worked out for one person. Returns head -> positive magnitude.
export function figureAll(sheet) {
  const out = {};
  RULES.forEach(rule => { out[rule.head] = rule.figure(sheet); });
  return out;
}

// The same, with the arithmetic written out beside each figure, for the screen.
// This is what makes a wrong figure arguable instead of mysterious: the person
// looking at it can see the numbers that made it.
export function explainAll(sheet) {
  return RULES.map(rule => ({
    head: rule.head,
    what: rule.what,
    how: typeof rule.how === 'function' ? rule.how(sheet) : rule.how,
    note: rule.note || '',
    cell: rule.cell || '',
    amount: rule.figure(sheet),
    sum: rule.sum ? rule.sum(sheet) : ''
  }));
}

/* ==================== a worked example for the policy screen ==================== */
//
// Somebody opening How it runs has no employee in front of them, so the rules
// are shown against a made-up one: a round salary, a full month, and one of
// everything going wrong. Round numbers on purpose - the point is to read the
// arithmetic, not to check it.

export function exampleSheet(policy) {
  return worksheet({
    basic: 30000,
    monthDays: (policy && policy.monthDays) || 30,
    workDays: (policy && policy.monthDays) || 30,
    dutyMinutes: (policy && policy.dutyMinutes) || 480,
    daysRecorded: (policy && policy.monthDays) || 30,
    lateMinutes: 90,
    lateDays: 3,
    overtimeMinutes: 60,
    absentDays: 1,
    halfDays: 1,
    leaveDays: 0,
    overtimePaid: true,
    bonusPaid: true,
    lateRule: (policy && policy.lateRule) || 'days',
    parcelBonusShare: 0,
    orderBonusShare: 0,
    parcelFineShare: 0,
    latePer: (policy && policy.latePer) || 3,
    halfDayFine: !(policy && policy.halfDayFine === false)
  });
}

export const EXAMPLE_SAYS =
  'A salary of 30,000 over a full month, with 3 late arrivals totalling 90 ' +
  'minutes, an hour of overtime, one day absent and one half day nobody approved.';
