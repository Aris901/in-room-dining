'use strict';

const test = require('node:test');
const assert = require('node:assert');
const t = require('../src/time');

const TZ = 'Europe/Moscow'; // UTC+3, no DST

/** Build an instant from Moscow wall-clock time. */
function msk(dateStr, hh, mm) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return t.wallTimeToInstant({ year, month, day, hour: hh, minute: mm }, TZ);
}

test('Moscow wall time maps to the correct UTC instant', () => {
  assert.strictEqual(msk('2026-03-10', 22, 0).toISOString(), '2026-03-10T19:00:00.000Z');
});

test('breakfast closes at 22:00 the day before service', () => {
  const cutoff = t.cutoffInstant('2026-03-11', 'breakfast', TZ);
  assert.strictEqual(cutoff.toISOString(), msk('2026-03-10', 22, 0).toISOString());
});

test('lunch closes at 11:00 on the service day', () => {
  const cutoff = t.cutoffInstant('2026-03-11', 'lunch', TZ);
  assert.strictEqual(cutoff.toISOString(), msk('2026-03-11', 11, 0).toISOString());
});

test('dinner closes at 16:00 on the service day', () => {
  const cutoff = t.cutoffInstant('2026-03-11', 'dinner', TZ);
  assert.strictEqual(cutoff.toISOString(), msk('2026-03-11', 16, 0).toISOString());
});

test('ordering is open one minute before the deadline and shut one minute after', () => {
  const date = '2026-03-11';
  const openAt = t.mealStatus(date, 'lunch', TZ, msk(date, 10, 59));
  const shutAt = t.mealStatus(date, 'lunch', TZ, msk(date, 11, 1));

  assert.strictEqual(openAt.open, true);
  assert.strictEqual(shutAt.open, false);
  assert.strictEqual(shutAt.reason, 'cutoff_passed');
});

test('the deadline instant itself is closed, not open', () => {
  const date = '2026-03-11';
  const exactly = t.mealStatus(date, 'lunch', TZ, msk(date, 11, 0));
  assert.strictEqual(exactly.open, false, 'a guest at exactly 11:00:00 must be too late');
});

test('a guest in another timezone gets the hotel deadline, not their own', () => {
  // 09:30 in London on the service day is already 12:30 in Moscow: lunch shut.
  const londonMorning = new Date('2026-03-11T09:30:00.000Z');
  const status = t.mealStatus('2026-03-11', 'lunch', TZ, londonMorning);
  assert.strictEqual(status.open, false);
});

test('breakfast for tomorrow is still open during today’s afternoon', () => {
  const now = msk('2026-03-10', 15, 0);
  assert.strictEqual(t.mealStatus('2026-03-11', 'breakfast', TZ, now).open, true);
});

test('breakfast for today is shut once the day has started', () => {
  const now = msk('2026-03-11', 7, 0);
  assert.strictEqual(t.mealStatus('2026-03-11', 'breakfast', TZ, now).open, false);
});

test('serviceHasFinished flips only after the window closes', () => {
  const date = '2026-03-11';
  assert.strictEqual(t.serviceHasFinished(date, 'lunch', TZ, msk(date, 14, 59)), false);
  assert.strictEqual(t.serviceHasFinished(date, 'lunch', TZ, msk(date, 15, 1)), true);
});

test('calendar helpers roll across month boundaries', () => {
  assert.strictEqual(t.addDays('2026-03-01', -1), '2026-02-28');
  assert.strictEqual(t.addDays('2024-03-01', -1), '2024-02-29'); // leap year
  assert.strictEqual(t.diffDays('2026-03-01', '2026-03-04'), 3);
  assert.strictEqual(t.diffDays('2026-03-04', '2026-03-01'), -3);
});

test('invalid dates are rejected rather than silently coerced', () => {
  assert.strictEqual(t.isValidDateString('2026-02-30'), false);
  assert.strictEqual(t.isValidDateString('2026-13-01'), false);
  assert.strictEqual(t.isValidDateString('26-01-01'), false);
  assert.strictEqual(t.isValidDateString(''), false);
  assert.strictEqual(t.isValidDateString('2026-03-11'), true);
});

test('a DST zone still resolves cutoffs correctly', () => {
  // Europe/Berlin springs forward 2026-03-29. A dinner cutoff after the
  // transition must be 16:00 local, i.e. 14:00 UTC (CEST = UTC+2).
  const cutoff = t.cutoffInstant('2026-03-30', 'dinner', 'Europe/Berlin');
  assert.strictEqual(cutoff.toISOString(), '2026-03-30T14:00:00.000Z');
});
