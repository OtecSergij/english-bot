import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCardFromFallback, buildCardFromSense, withExample } from './card';
import type { DictionarySense } from '../services/dictionary/types';

const example = { ru: 'Пример.', en: 'Example.' };
const sense = (translation: string): DictionarySense => ({ translation });

test('RU input: prompt = input word, answer = the sense translation', () => {
  const card = buildCardFromSense('дом', 'ru', sense('house'), example);
  assert.equal(card.russian, 'дом');
  assert.equal(card.english, 'house');
  assert.equal(card.source, 'dictionary');
  assert.equal(card.exampleRu, 'Пример.');
  assert.equal(card.exampleEn, 'Example.');
});

test('EN input: answer = the input word, prompt = the Russian translation', () => {
  const card = buildCardFromSense('house', 'en', sense('дом'), example);
  assert.equal(card.russian, 'дом');
  assert.equal(card.english, 'house');
});

test('a half/empty example collapses to both fields null', () => {
  assert.equal(buildCardFromSense('собака', 'ru', sense('dog'), { ru: '', en: 'x' }).exampleRu, null);
  assert.equal(buildCardFromSense('собака', 'ru', sense('dog'), { ru: 'x', en: '' }).exampleEn, null);
});

test('fallback (RU input): single translation, source=fallback', () => {
  const card = buildCardFromFallback('кварк', 'ru', 'quark', example);
  assert.equal(card.russian, 'кварк');
  assert.equal(card.english, 'quark');
  assert.equal(card.source, 'fallback');
});

test('fallback (EN input): prompt = translation, answer = input', () => {
  const card = buildCardFromFallback('quark', 'en', 'кварк', example);
  assert.equal(card.russian, 'кварк');
  assert.equal(card.english, 'quark');
  assert.equal(card.source, 'fallback');
});

test('withExample replaces the example (both-or-neither), keeps the rest', () => {
  const card = buildCardFromSense('дом', 'ru', sense('house'), example);
  const updated = withExample(card, { ru: 'Новый.', en: 'New.' });
  assert.equal(updated.exampleRu, 'Новый.');
  assert.equal(updated.exampleEn, 'New.');
  assert.equal(updated.english, 'house');
  const cleared = withExample(card, { ru: '', en: 'x' });
  assert.equal(cleared.exampleRu, null);
  assert.equal(cleared.exampleEn, null);
});
