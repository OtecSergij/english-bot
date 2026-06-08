import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReviewAnswer, renderReviewQuestion, sessionComplete } from './review';
import type { ReviewWord } from '../db/words';

test('sessionComplete is true once reviewed reaches the session size', () => {
  assert.equal(sessionComplete(0, 9), false);
  assert.equal(sessionComplete(8, 9), false);
  assert.equal(sessionComplete(9, 9), true); // graded all due (< review_count)
  assert.equal(sessionComplete(10, 10), true); // hit the review_count cap
});

const base: ReviewWord = {
  id: 1,
  russian: 'дом',
  english: 'house',
  exampleRu: null,
  exampleEn: null,
  intervalIndex: 0,
};

test('renderReviewQuestion shows the 1-based step and prompt, hides the answer', () => {
  assert.equal(renderReviewQuestion(0, 9, base), '1/9\n<b>дом</b>');
});

test('renderReviewQuestion keeps the Russian example as a hint (no English half)', () => {
  const card: ReviewWord = {
    ...base,
    exampleRu: 'Мой дом большой.',
    exampleEn: 'My house is big.',
  };
  assert.equal(renderReviewQuestion(2, 9, card), '3/9\n<b>дом</b>\nПример: Мой дом большой.');
});

test('renderReviewAnswer reveals the English answer and the example half', () => {
  assert.equal(renderReviewAnswer(0, 9, base), '1/9\n<b>дом</b> — house');
  const card: ReviewWord = {
    ...base,
    exampleRu: 'Мой дом большой.',
    exampleEn: 'My house is big.',
  };
  assert.equal(
    renderReviewAnswer(0, 9, card),
    '1/9\n<b>дом</b> — house\nПример: Мой дом большой. — My house is big.',
  );
});

test('renderReviewQuestion / renderReviewAnswer escape HTML in every field', () => {
  const card: ReviewWord = {
    ...base,
    russian: 'a<b',
    english: 'x&y',
    exampleRu: '1<2',
    exampleEn: '3>2',
  };
  assert.equal(renderReviewQuestion(0, 1, card), '1/1\n<b>a&lt;b</b>\nПример: 1&lt;2');
  assert.equal(
    renderReviewAnswer(0, 1, card),
    '1/1\n<b>a&lt;b</b> — x&amp;y\nПример: 1&lt;2 — 3&gt;2',
  );
});
