import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, hhmm, timeInTz, todayInTz } from './dates';

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

test('timeInTz returns zero-padded 24h HH:MM in the target zone', () => {
  const instant = new Date('2026-06-06T06:05:00Z');
  // Moscow is UTC+3 -> 09:05; zero-padded both fields.
  assert.equal(timeInTz(instant, 'Europe/Moscow'), '09:05');
  assert.equal(timeInTz(instant, 'UTC'), '06:05');
});

test('timeInTz uses h23 (midnight is 00, not 24)', () => {
  const instant = new Date('2026-06-06T21:00:00Z');
  // Moscow is UTC+3 -> 00:00 of the next day (not 24:00).
  assert.equal(timeInTz(instant, 'Europe/Moscow'), '00:00');
});

test('hhmm truncates a Postgres time to HH:MM and is idempotent', () => {
  assert.equal(hhmm('09:00:00'), '09:00');
  assert.equal(hhmm('21:30:45'), '21:30');
  assert.equal(hhmm('09:00'), '09:00'); // already HH:MM
});
