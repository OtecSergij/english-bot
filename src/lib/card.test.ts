import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCardFromFallback,
  buildCardFromSense,
  withExample,
  withManualTranslation,
} from './card';
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

test('withManualTranslation (RU input): overrides english, drops fallback + example', () => {
  const fb = buildCardFromFallback('кварк', 'ru', 'quark', example); // source=fallback, has example
  const edited = withManualTranslation(fb, 'quark particle', 'ru');
  assert.equal(edited.english, 'quark particle'); // RU input → own English answer
  assert.equal(edited.russian, 'кварк'); // prompt unchanged
  assert.equal(edited.source, 'dictionary'); // no longer flagged «проверь»
  assert.equal(edited.exampleRu, null); // stale example cleared (caller regenerates)
  assert.equal(edited.exampleEn, null);
});

test('withManualTranslation (EN input): overrides the russian prompt', () => {
  const card = buildCardFromSense('house', 'en', { translation: 'дом' }, example);
  const edited = withManualTranslation(card, 'жилище', 'en');
  assert.equal(edited.russian, 'жилище'); // EN input → own Russian prompt
  assert.equal(edited.english, 'house'); // answer unchanged
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
