import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLang, lookupDirection } from './lang';

test('detectLang: Cyrillic -> ru', () => {
  assert.equal(detectLang('дом'), 'ru');
  assert.equal(detectLang('Привет'), 'ru');
});

test('detectLang: Latin -> en', () => {
  assert.equal(detectLang('house'), 'en');
  assert.equal(detectLang('give up'), 'en');
});

test('lookupDirection maps language to lookup direction', () => {
  assert.equal(lookupDirection('ru'), 'ru-en');
  assert.equal(lookupDirection('en'), 'en-ru');
});
