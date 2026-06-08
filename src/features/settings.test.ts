import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderMain,
  renderReviewCountEditor,
  renderTestCountEditor,
  renderTimePicker,
} from './settings';

const base = {
  reviewCount: 10,
  reviewTime: '09:00:00',
  testCount: 10,
  timezone: 'Europe/Moscow',
};

test('renderMain shows time as HH:MM, the deck size, and the timezone', () => {
  const text = renderMain(base, 23);
  assert.match(text, /Слов на повторение: <b>10<\/b> \(в колоде: 23\)/);
  assert.match(text, /Время повторения: <b>09:00<\/b>/);
  assert.match(text, /Слов на тест: <b>10<\/b>/);
  assert.match(text, /Europe\/Moscow/);
});

test('renderMain caps review_count at the deck size (effective value)', () => {
  // Stored 10 but only 4 words → a session runs 4, so the screen shows 4.
  const text = renderMain({ ...base, reviewCount: 10 }, 4);
  assert.match(text, /Слов на повторение: <b>4<\/b> \(в колоде: 4\)/);
});

test('renderMain clamps test_count into the fixed range for display', () => {
  assert.match(renderMain({ ...base, testCount: 999 }, 23), /Слов на тест: <b>50<\/b>/);
  assert.match(renderMain({ ...base, testCount: 0 }, 23), /Слов на тест: <b>1<\/b>/);
});

test('renderReviewCountEditor shows the value and the deck cap', () => {
  const text = renderReviewCountEditor(7, 23);
  assert.match(text, /Сейчас: <b>7<\/b>/);
  assert.match(text, /Колода: 23 · максимум 23/);
});

test('renderReviewCountEditor floors the cap at 1 for an empty deck', () => {
  assert.match(renderReviewCountEditor(1, 0), /Колода: 0 · максимум 1/);
});

test('renderTestCountEditor shows the value and the fixed range', () => {
  const text = renderTestCountEditor(15);
  assert.match(text, /Сейчас: <b>15<\/b>/);
  assert.match(text, /Диапазон: 1–50/);
});

test('renderTimePicker shows the current HH:MM and timezone', () => {
  const text = renderTimePicker('21:00:00', 'Europe/Moscow');
  assert.match(text, /Сейчас: <b>21:00<\/b> \(Europe\/Moscow\)/);
});
