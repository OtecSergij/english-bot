import test from 'node:test';
import assert from 'node:assert/strict';
import { clampIndex, intervalDays, nextReviewDate, promote, reset } from './srs';

test('clampIndex keeps the index within ladder bounds', () => {
  assert.equal(clampIndex(-5), 0);
  assert.equal(clampIndex(2), 2);
  assert.equal(clampIndex(999), 7);
});

test('intervalDays returns ladder values and caps at the top', () => {
  assert.equal(intervalDays(0), 1);
  assert.equal(intervalDays(2), 7);
  assert.equal(intervalDays(999), 240);
});

test('promote advances and caps; reset returns to 0', () => {
  assert.equal(promote(0), 1);
  assert.equal(promote(7), 7);
  assert.equal(promote(100), 7);
  assert.equal(reset(), 0);
});

test('nextReviewDate adds the ladder interval to a date string', () => {
  assert.equal(nextReviewDate('2026-06-06', 0), '2026-06-07');
  assert.equal(nextReviewDate('2026-06-06', 2), '2026-06-13');
});
