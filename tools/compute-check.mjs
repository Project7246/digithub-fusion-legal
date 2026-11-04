// The month's compute meter is what holds the background sweep back, so an
// hours figure that is wrong in the wrong direction costs real money. These
// are the shapes that broke it, with known figures. Synthetic only - no
// database, no network.
import assert from 'node:assert/strict';
import { spellOf } from '../compute.js';

const IDLE = 5 * 60;                       // NEON_IDLE_MINUTES, in seconds
const t = (ms) => 1793233368000 + ms;      // some instant, in epoch ms

// an ordinary spell: the work, plus the idle tail Neon stays up for
assert.equal(spellOf(t(0), t(0)), IDLE);
assert.equal(spellOf(t(0), t(60000)), 60 + IDLE);
assert.equal(spellOf(t(0), t(3600000)), 3600 + IDLE);

// November 2026 read -498,120 hours, which is -(the epoch in seconds): a
// spell closed with lastAt reset to 0 while wokeAt still held a timestamp.
// A duration is never negative, and a used figure that is hugely negative can
// never reach the stop-at line - so the guard stays open all month.
assert.equal(spellOf(t(0), 0), IDLE);
assert.ok(spellOf(t(0), 0) > 0);

// the same shape the other way round, and both ends missing
assert.equal(spellOf(t(60000), t(0)), IDLE);
assert.equal(spellOf(0, t(0)), IDLE);
assert.equal(spellOf(0, 0), IDLE);

// a clock that jumps forward cannot charge the month more than the month holds
assert.equal(spellOf(t(0), t(400 * 24 * 3600 * 1000)), 31 * 24 * 3600);

// nothing this function returns can ever be negative
for (const [a, b] of [[t(0), 0], [0, t(0)], [t(5000), t(1)], [0, 0],
                      [t(0), t(10)], [t(0), t(-99999999)]]) {
  assert.ok(spellOf(a, b) >= 0, 'spellOf(' + a + ',' + b + ') went negative');
}

console.log('Compute meter spell arithmetic checks passed (synthetic data only).');
