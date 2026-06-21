import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderMain,
  renderNewPerDayEditor,
  renderSessionSizeEditor,
  renderTimePicker,
} from './settings';

const base = {
  sessionSize: 10,
  reviewTime: '09:00:00',
  newPerDay: 5,
  timezone: 'Europe/Moscow',
};
const q = { dueReviews: 0, newPile: 0 };

test('renderMain shows session size, new-per-day, time, deck, and timezone', () => {
  const text = renderMain(base, 23, q);
  assert.match(text, /Слов в день: <b>10<\/b> \(в колоде: 23\)/);
  assert.match(text, /Новых в день: <b>5<\/b>/);
  assert.match(text, /Время повторения: <b>09:00<\/b>/);
  assert.match(text, /Europe\/Moscow/);
});

test('renderMain caps the session size at the deck size (effective value)', () => {
  // Stored 10 but only 4 words → a session runs 4, so the screen shows 4.
  const text = renderMain({ ...base, sessionSize: 10 }, 4, q);
  assert.match(text, /Слов в день: <b>4<\/b> \(в колоде: 4\)/);
});

test('renderMain clamps new-per-day into [1, NEW_PER_DAY_MAX] for display', () => {
  assert.match(renderMain({ ...base, newPerDay: 999 }, 23, q), /Новых в день: <b>20<\/b>/);
  assert.match(renderMain({ ...base, newPerDay: 0 }, 23, q), /Новых в день: <b>1<\/b>/); // 0 clamps to 1
});

test('renderMain shows the read-only queue line (due reviews + new pile)', () => {
  assert.match(
    renderMain(base, 23, { dueReviews: 8, newPile: 3 }),
    /В очереди: <b>8<\/b> на повторение · <b>3<\/b> новых/,
  );
});

test('renderSessionSizeEditor shows the value and the deck cap', () => {
  const text = renderSessionSizeEditor(7, 23);
  assert.match(text, /Сейчас: <b>7<\/b>/);
  assert.match(text, /Колода: 23 · максимум 23/);
});

test('renderSessionSizeEditor floors the cap at 1 for an empty deck', () => {
  assert.match(renderSessionSizeEditor(1, 0), /Колода: 0 · максимум 1/);
});

test('renderNewPerDayEditor shows the value and the range (min 1)', () => {
  const text = renderNewPerDayEditor(5);
  assert.match(text, /Сейчас: <b>5<\/b>/);
  assert.match(text, /Диапазон: 1–20/);
});

test('renderTimePicker shows the current HH:MM and timezone', () => {
  const text = renderTimePicker('21:00:00', 'Europe/Moscow');
  assert.match(text, /Сейчас: <b>21:00<\/b> \(Europe\/Moscow\)/);
});
