import test from 'node:test';
import assert from 'node:assert/strict';
import { isReminderDue, pluralRu } from './scheduler';

const base = {
  nowHHMM: '09:30',
  reviewHHMM: '09:00',
  lastReviewedOn: null as string | null,
  today: '2026-06-08',
};

test('fires once the time has come and today is not handled yet', () => {
  assert.equal(isReminderDue(base), true);
});

test('fires exactly at review_time (>= boundary is inclusive)', () => {
  assert.equal(isReminderDue({ ...base, nowHHMM: '09:00' }), true);
});

test('does not fire before review_time', () => {
  assert.equal(isReminderDue({ ...base, nowHHMM: '08:59' }), false);
});

test('does not fire again once today is stamped', () => {
  assert.equal(isReminderDue({ ...base, lastReviewedOn: '2026-06-08' }), false);
});

test('fires when last review was a previous day', () => {
  assert.equal(isReminderDue({ ...base, lastReviewedOn: '2026-06-07' }), true);
});

test('self-healing: still fires hours later if today was missed', () => {
  // Bot was down at 09:00; it is now 14:00 and today is still not handled.
  assert.equal(isReminderDue({ ...base, nowHHMM: '14:00' }), true);
});

test('pluralRu picks the right Russian form, incl. the 11–14 exception', () => {
  const f: [string, string, string] = ['слово', 'слова', 'слов'];
  const p = (n: number): string => pluralRu(n, f);
  // one
  assert.equal(p(1), 'слово');
  assert.equal(p(21), 'слово');
  assert.equal(p(101), 'слово');
  // few (2–4)
  assert.equal(p(2), 'слова');
  assert.equal(p(4), 'слова');
  assert.equal(p(22), 'слова');
  // many (5–20, and the 11–14 exception that overrides the digit rule)
  assert.equal(p(5), 'слов');
  assert.equal(p(0), 'слов');
  assert.equal(p(11), 'слов');
  assert.equal(p(12), 'слов');
  assert.equal(p(14), 'слов');
  assert.equal(p(111), 'слов');
  assert.equal(p(112), 'слов');
});
