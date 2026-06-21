import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampIndex,
  intervalDays,
  nextReviewDate,
  planSession,
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

test('planSession fills reviews-first, then new, then top-up, in priority order', () => {
  assert.deepEqual(ids(planSession([c(1), c(2)], [c(3)], [c(4)], 10)), [1, 2, 3, 4]);
});

test('planSession slices to the budget N (reviews can crowd out new/top-up)', () => {
  assert.deepEqual(ids(planSession([c(1), c(2), c(3)], [c(4)], [c(5)], 2)), [1, 2]);
});

test('planSession dedupes by id across buckets', () => {
  assert.deepEqual(ids(planSession([c(1)], [c(1)], [c(2)], 10)), [1, 2]);
});

test('planSession top-up only fills the leftover budget', () => {
  assert.deepEqual(ids(planSession([c(1)], [], [c(2), c(3)], 2)), [1, 2]);
});

test('planSession returns empty when all buckets are empty (no phantom cards)', () => {
  assert.deepEqual(planSession([], [], [], 5), []);
});
