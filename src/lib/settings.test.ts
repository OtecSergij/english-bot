import test from 'node:test';
import assert from 'node:assert/strict';
import { clampInt, effectiveTestCount, reviewCountMax, COUNT_MIN, TEST_COUNT_MAX } from './settings';

test('clampInt bounds a value into [min, max]', () => {
  assert.equal(clampInt(5, 1, 10), 5);
  assert.equal(clampInt(-3, 1, 10), 1);
  assert.equal(clampInt(99, 1, 10), 10);
  assert.equal(clampInt(1, 1, 1), 1); // degenerate range
});

test('reviewCountMax is the deck size, floored at 1', () => {
  assert.equal(reviewCountMax(23), 23);
  assert.equal(reviewCountMax(1), 1);
  assert.equal(reviewCountMax(0), COUNT_MIN); // empty deck still allows the floor
});

test('effectiveTestCount clamps the stored value into [1, TEST_COUNT_MAX]', () => {
  assert.equal(effectiveTestCount(10), 10);
  assert.equal(effectiveTestCount(0), COUNT_MIN); // floor
  assert.equal(effectiveTestCount(-5), COUNT_MIN);
  assert.equal(effectiveTestCount(999), TEST_COUNT_MAX); // ceiling
});
