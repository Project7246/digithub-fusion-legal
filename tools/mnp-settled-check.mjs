// A courier's "settled" flag against a payment cover we hold that says the
// payment is still open. M&P hand over a PaymentID the moment a payment is
// generated, long before it is paid, so the flag alone is a promise of money
// and not money. Synthetic only - the SQL is read, never run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../dashdata.js', import.meta.url), 'utf8');

// the guard exists, and it is the courier_cprs status that drives it
const open = src.slice(src.indexOf('const CPR_OPEN'), src.indexOf('const GOT_SQL'));
assert.match(open, /FROM courier_cprs c/);
assert.match(open, /c\.realm_id = o\.realm_id/, 'the cover must be this company\'s');
assert.match(open, /c\.account_id = o\.account_id/, 'and this account\'s');
assert.match(open, /c\.cpr_number = o\.cpr_number/);
assert.match(open, /NOT IN \$\{PAID_WORDS\}/,
  'open means any status that is not one of the paid words');

// The paid words are the ones the owner settled on for Banking, and each
// courier has its own: PostEx says CLOSED, Trax's payments screen says Paid.
// With CLOSED alone every Trax receipt would read as unpaid for ever.
const words = src.slice(src.indexOf('const PAID_WORDS'), src.indexOf('const CPR_CLOSED'));
for (const w of ['CLOSED', 'PAID', 'CLEARED', 'CONFIRMED', 'TRANSFERRED', 'PROCESSED']) {
  assert.ok(words.includes("'" + w + "'"), w + ' must count as money received');
}
// and nothing that means the opposite crept in
for (const w of ['PENDING', 'OPEN', 'GENERATED', 'APPROVED']) {
  assert.ok(!words.includes("'" + w + "'"), w + ' must NOT count as money received');
}

const got = src.slice(src.indexOf('const GOT_SQL'), src.indexOf('const PENDING_SQL'));
assert.match(got, /o\.settled IS TRUE AND NOT/,
  'the settled flag must be suppressed by a cover we know is still open');
assert.match(got, /CPR_OPEN/);
assert.match(got, /CPR_CLOSED/, 'a closed cover still counts as received');

// and the flag must still stand on its own where no cover is held, or every
// parcel whose payment was never pulled would turn back into a receivable
assert.ok(!/o\.settled IS TRUE AND EXISTS/.test(got),
  'a missing cover must not take the courier\'s own flag away');

// the three buckets stay mutually exclusive: received, on an unpaid cover, and
// no cover at all
const pending = src.slice(src.indexOf('const PENDING_SQL'), src.indexOf('const PAID_SQL'));
assert.match(pending, /PENDING_SQL\s*=\s*`\(NOT \$\{GOT_SQL\} AND \$\{HAS_CPR\}\)`/);
assert.match(pending, /NOCPR_SQL\s*=\s*`\(NOT \$\{GOT_SQL\} AND NOT \$\{HAS_CPR\}\)`/);

// The CPR side must ask the same question in the same words. It had its own
// `= 'CLOSED'`, so a Trax receipt marked Paid counted as received on the
// parcel side and as still owed on this one, at the same moment.
const closed = src.slice(src.indexOf('const CLOSED ='), src.indexOf('async function cprMoney'));
assert.match(closed, /IN \$\{PAID_WORDS\}/,
  'the cover side must use the same paid words, not a list of its own');
assert.ok(!/=\s*'CLOSED'/.test(closed),
  'the cover side must not test for CLOSED on its own');

console.log('M&P settled-against-open-cover checks passed (synthetic data only).');
