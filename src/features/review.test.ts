import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReviewCard, sessionComplete } from './review';
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

test('renderReviewCard blurs the answer with a spoiler', () => {
  assert.equal(renderReviewCard(base), '<b>дом</b>: <tg-spoiler>house</tg-spoiler>');
});

test('renderReviewCard adds the example with a spoilered English half', () => {
  const card: ReviewWord = {
    ...base,
    exampleRu: 'Мой дом большой.',
    exampleEn: 'My house is big.',
  };
  assert.equal(
    renderReviewCard(card),
    '<b>дом</b>: <tg-spoiler>house</tg-spoiler>\n' +
      'Пример: Мой дом большой. — <tg-spoiler>My house is big.</tg-spoiler>',
  );
});

test('renderReviewCard omits the example unless both halves are present', () => {
  const onlyRu: ReviewWord = { ...base, exampleRu: 'Мой дом.', exampleEn: null };
  assert.equal(renderReviewCard(onlyRu), '<b>дом</b>: <tg-spoiler>house</tg-spoiler>');
});

test('renderReviewCard escapes HTML in every field', () => {
  const card: ReviewWord = {
    ...base,
    russian: 'a<b',
    english: 'x&y',
    exampleRu: '1<2',
    exampleEn: '3>2 & true',
  };
  assert.equal(
    renderReviewCard(card),
    '<b>a&lt;b</b>: <tg-spoiler>x&amp;y</tg-spoiler>\n' +
      'Пример: 1&lt;2 — <tg-spoiler>3&gt;2 &amp; true</tg-spoiler>',
  );
});
