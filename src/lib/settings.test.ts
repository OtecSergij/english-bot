import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampInt,
  effectiveNewPerDay,
  sessionSizeMax,
  COUNT_MIN,
  NEW_PER_DAY_MAX,
} from './settings';

test('clampInt bounds a value into [min, max]', () => {
  assert.equal(clampInt(5, 1, 10), 5);
  assert.equal(clampInt(-3, 1, 10), 1);
  assert.equal(clampInt(99, 1, 10), 10);
  assert.equal(clampInt(1, 1, 1), 1); // degenerate range
});

test('sessionSizeMax is the deck size, floored at 1', () => {
  assert.equal(sessionSizeMax(23), 23);
  assert.equal(sessionSizeMax(1), 1);
  assert.equal(sessionSizeMax(0), COUNT_MIN); // empty deck still allows the floor
});

test('effectiveNewPerDay clamps the stored value into [0, NEW_PER_DAY_MAX]', () => {
  assert.equal(effectiveNewPerDay(5), 5);
  assert.equal(effectiveNewPerDay(0), 0); // 0 is valid — pause new words
  assert.equal(effectiveNewPerDay(-5), 0); // floor
  assert.equal(effectiveNewPerDay(999), NEW_PER_DAY_MAX); // ceiling
});
