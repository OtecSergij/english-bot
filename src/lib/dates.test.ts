import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, todayInTz } from './dates';

test('addDays handles simple, month and year rollover', () => {
  assert.equal(addDays('2026-06-06', 1), '2026-06-07');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('todayInTz respects the timezone at the day boundary', () => {
  const instant = new Date('2026-06-06T23:30:00Z');
  // Moscow is UTC+3 -> 02:30 of the next day.
  assert.equal(todayInTz(instant, 'Europe/Moscow'), '2026-06-07');
  assert.equal(todayInTz(instant, 'UTC'), '2026-06-06');
});
