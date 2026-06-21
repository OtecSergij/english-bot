import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampIndex,
  intervalDays,
  composeSession,
  nextReviewDate,
  promote,
  reset,
  reviewSessionSize,
} from './srs';

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

test('reviewSessionSize caps by deck, floors at 1, guards a bad session size', () => {
  assert.equal(reviewSessionSize(10, 23), 10); // session_size < deck → session_size
  assert.equal(reviewSessionSize(10, 4), 4); // deck < session_size → deck
  assert.equal(reviewSessionSize(10, 1), 1); // single-card deck
  assert.equal(reviewSessionSize(0, 23), 1); // bad session_size floored to 1
  assert.equal(reviewSessionSize(10, 0), 1); // empty deck floored (gated elsewhere)
});

const ids = (cards: { id: number }[]): number[] => cards.map((c) => c.id);
const c = (id: number): { id: number } => ({ id });

test('composeSession fills new (≤ cap) then learned, always N — the owner example', () => {
  // 100 learned (ids 1..100 by maturity), 3 new (201..203), N=5, cap=2 → 3 learned + 2 new.
  const learned = Array.from({ length: 100 }, (_, i) => c(i + 1));
  assert.deepEqual(ids(composeSession(learned, [c(201), c(202), c(203)], 5, 2)), [1, 2, 3, 201, 202]);
});

test('composeSession: as the new pile shrinks, learned fill grows to keep N', () => {
  const learned = [c(1), c(2), c(3), c(4), c(5)];
  assert.deepEqual(ids(composeSession(learned, [c(201)], 5, 2)), [1, 2, 3, 4, 201]); // 4 + 1
  assert.deepEqual(ids(composeSession(learned, [], 5, 2)), [1, 2, 3, 4, 5]); // pile empty → all learned
});

test('composeSession caps new intake at new_per_day even with a big pile', () => {
  assert.deepEqual(ids(composeSession([c(1), c(2), c(3)], [c(201), c(202), c(203), c(204)], 5, 2)), [
    1, 2, 3, 201, 202,
  ]);
});

test('composeSession is bounded by what exists (fresh / small / empty deck)', () => {
  assert.deepEqual(ids(composeSession([], [c(201), c(202), c(203)], 5, 2)), [201, 202]); // fresh: only cap new
  assert.deepEqual(ids(composeSession([c(1), c(2)], [], 5, 2)), [1, 2]); // 2-word deck < N
  assert.deepEqual(composeSession([], [], 5, 2), []); // empty deck
});

test('composeSession never exceeds N (new_per_day ≥ N)', () => {
  assert.deepEqual(ids(composeSession([], [c(201), c(202), c(203)], 2, 5)), [201, 202]);
});
