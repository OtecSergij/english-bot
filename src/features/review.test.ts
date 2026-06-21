import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOutcome, renderQuestion, renderStep, renderSummary, sessionComplete } from './review';
import type { SessionCard } from '../db/words';

const CORRECT = { failed: false, retry: false };
const WRONG = { failed: true, retry: true };
const REVEAL = { failed: true, retry: false };

// ── The queue cycle (re-homed from the test flow; logic unchanged) ────────────

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

test('sessionComplete is true only when the queue is empty', () => {
  assert.equal(sessionComplete([1]), false);
  assert.equal(sessionComplete([]), true);
});

// ── Renders ───────────────────────────────────────────────────────────────

const card = (
  id: number,
  russian: string,
  english: string,
  exampleRu: string | null = null,
  exampleEn: string | null = null,
): SessionCard => ({ id, russian, english, exampleRu, exampleEn, intervalIndex: 0 });

test('renderQuestion shows just the bold word (no counter, no prompt line)', () => {
  assert.equal(renderQuestion(card(1, 'дом', 'house')), '<b>дом</b>');
});

test('renderQuestion keeps the Russian example as a hint (never the English)', () => {
  assert.equal(
    renderQuestion(card(1, 'дом', 'house', 'Мой дом большой.', 'My house is big.')),
    '<b>дом</b>\nМой дом большой.',
  );
});

test('renderQuestion inserts a ⚠️ note above the prompt', () => {
  assert.equal(
    renderQuestion(card(1, 'кот', 'cat'), '⚠️ Отвечай на английском.'),
    '⚠️ Отвечай на английском.\n\n<b>кот</b>',
  );
});

test('renderQuestion escapes HTML in the prompt', () => {
  assert.equal(renderQuestion(card(1, 'a<b', 'x')), '<b>a&lt;b</b>');
});

test('renderStep shows the verdict + full card, then the next word (no counter)', () => {
  const graded = card(1, 'собака', 'dog', 'Собака бежит.', 'The dog runs.');
  const next = card(2, 'кот', 'cat');
  assert.equal(
    renderStep(graded, 'correct', next),
    '✅ Верно! «собака» — «dog»\nСобака бежит.\nThe dog runs.\n— — —\n<b>кот</b>',
  );
});

test('renderStep marks a wrong answer and a reveal differently', () => {
  const graded = card(1, 'идти', 'walk');
  const next = card(2, 'кот', 'cat');
  assert.match(renderStep(graded, 'wrong', next), /^❌ Неверно\. Правильно: «идти» — «walk»/);
  assert.match(renderStep(graded, 'reveal', next), /^Ответ: «идти» — «walk»/);
});

test('renderStep escapes HTML in the graded card', () => {
  assert.match(
    renderStep(card(1, 'a<b', 'x&y'), 'correct', card(2, 'кот', 'cat')),
    /«a&lt;b» — «x&amp;y»/,
  );
});

test('renderSummary celebrates a clean run', () => {
  assert.equal(renderSummary(10, []), '✅ Повторение пройдено: 10/10. Отлично!');
});

test('renderSummary lists the words that were missed', () => {
  assert.equal(
    renderSummary(3, [card(1, 'дом', 'house'), card(2, 'кот', 'cat')]),
    'Повторение завершено: 1/3 верно.\nОшибки были в:\n• дом → house\n• кот → cat',
  );
});

test('renderSummary escapes HTML in the failed list', () => {
  assert.equal(
    renderSummary(1, [card(1, 'a<b', 'x&y')]),
    'Повторение завершено: 0/1 верно.\nОшибки были в:\n• a&lt;b → x&amp;y',
  );
});
