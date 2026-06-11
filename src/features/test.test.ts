import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOutcome,
  renderQuestion,
  renderResult,
  renderSummary,
  revealFeedback,
  testComplete,
  wrongFeedback,
} from './test';
import type { TestCard } from '../db/words';

const CORRECT = { failed: false, retry: false };
const WRONG = { failed: true, retry: true };
const REVEAL = { failed: true, retry: false };

test('applyOutcome: a correct answer removes the current card, no failure', () => {
  assert.deepEqual(applyOutcome({ queue: [1, 2, 3], failedIds: [] }, CORRECT), {
    queue: [2, 3],
    failedIds: [],
  });
});

test('applyOutcome: a wrong answer re-queues the card at the back and records the failure', () => {
  assert.deepEqual(applyOutcome({ queue: [1, 2, 3], failedIds: [] }, WRONG), {
    queue: [2, 3, 1],
    failedIds: [1],
  });
});

test('applyOutcome: reveal removes the card (no re-queue) and records the failure', () => {
  assert.deepEqual(applyOutcome({ queue: [1, 2, 3], failedIds: [] }, REVEAL), {
    queue: [2, 3],
    failedIds: [1],
  });
});

test('applyOutcome: failedIds is deduped across repeated failures of the same card', () => {
  assert.deepEqual(applyOutcome({ queue: [1, 2], failedIds: [1] }, WRONG), {
    queue: [2, 1],
    failedIds: [1],
  });
});

test('applyOutcome: a correct answer after an earlier failure keeps the failure on record', () => {
  assert.deepEqual(applyOutcome({ queue: [1, 2], failedIds: [1] }, CORRECT), {
    queue: [2],
    failedIds: [1],
  });
});

test('applyOutcome: an empty queue is a no-op', () => {
  assert.deepEqual(applyOutcome({ queue: [], failedIds: [3] }, WRONG), {
    queue: [],
    failedIds: [3],
  });
});

test('testComplete is true only when the queue is empty', () => {
  assert.equal(testComplete([1]), false);
  assert.equal(testComplete([]), true);
});

test('renderQuestion counts 1-based: first card is 1/N, last is N/N', () => {
  // done = cards CLOSED so far; the counter shows the position being closed (§6).
  assert.equal(renderQuestion(0, 10, 'дом'), '1/10\n\n<b>дом</b>\nНапиши перевод на английский:');
  assert.match(renderQuestion(9, 10, 'дом'), /^10\/10\n/);
});

test('renderQuestion inserts a ⚠️ note above the prompt', () => {
  assert.equal(
    renderQuestion(0, 10, 'кот', '⚠️ Отвечай на английском.'),
    '1/10\n\n⚠️ Отвечай на английском.\n\n<b>кот</b>\nНапиши перевод на английский:',
  );
});

test('renderQuestion escapes HTML in the prompt', () => {
  assert.equal(renderQuestion(0, 1, 'a<b'), '1/1\n\n<b>a&lt;b</b>\nНапиши перевод на английский:');
});

const card = (id: number, russian: string, english: string): TestCard => ({ id, russian, english });

test('renderResult shows the same 1-based counter as its question', () => {
  assert.equal(
    renderResult(2, 10, '❌ Не правильно. «идти» — «walk»'),
    '3/10\n\n❌ Не правильно. «идти» — «walk»',
  );
});

test('wrongFeedback shows the answer (both sides quoted, learning mode)', () => {
  assert.equal(wrongFeedback(card(1, 'идти', 'walk')), '❌ Не правильно. «идти» — «walk»');
});

test('revealFeedback shows the answer without an icon', () => {
  assert.equal(revealFeedback(card(1, 'идти', 'walk')), 'Ответ: «идти» — «walk»');
});

test('feedback escapes HTML in both sides', () => {
  assert.equal(wrongFeedback(card(1, 'a<b', 'x&y')), '❌ Не правильно. «a&lt;b» — «x&amp;y»');
});

test('renderSummary celebrates a clean run', () => {
  assert.equal(renderSummary(10, []), '✅ Тест пройден: 10/10. Отлично!');
});

test('renderSummary lists the failed words (which went back to review)', () => {
  assert.equal(
    renderSummary(3, [card(1, 'дом', 'house'), card(2, 'кот', 'cat')]),
    'Тест завершён: 1/3 верно.\nНа повторение ушли:\n• дом → house\n• кот → cat',
  );
});

test('renderSummary escapes HTML in the failed list', () => {
  assert.equal(
    renderSummary(1, [card(1, 'a<b', 'x&y')]),
    'Тест завершён: 0/1 верно.\nНа повторение ушли:\n• a&lt;b → x&amp;y',
  );
});
