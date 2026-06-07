import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapYandexResponse } from './yandex';

test('homograph: each meaning (tr) becomes its own sense (замок → castle / lock)', () => {
  const raw = {
    def: [
      {
        pos: 'noun',
        text: 'замок',
        tr: [
          { text: 'castle', pos: 'noun', fr: 10, mean: [{ text: 'дворец' }] },
          { text: 'lock', pos: 'noun', fr: 10, mean: [{ text: 'висячий замок' }, { text: 'защёлка' }] },
        ],
      },
    ],
  };
  const r = mapYandexResponse(raw, 'замок', 'ru-en');
  assert.equal(r.senses.length, 2);
  assert.equal(r.senses[0]?.translation, 'castle');
  assert.equal(r.senses[0]?.gloss, 'дворец');
  assert.equal(r.senses[1]?.translation, 'lock');
  assert.equal(r.senses[1]?.gloss, 'висячий замок, защёлка');
});

test('synonyms (tr.syn) are ignored — only the primary translation is kept', () => {
  const raw = { def: [{ tr: [{ text: 'dog', fr: 10, syn: [{ text: 'hound' }], mean: [{ text: 'пёс' }] }] }] };
  const r = mapYandexResponse(raw, 'собака', 'ru-en');
  assert.equal(r.senses.length, 1);
  assert.equal(r.senses[0]?.translation, 'dog');
});

test('low-relevance (fr) long tail is dropped (крыло keeps wing/fender, drops blade)', () => {
  const raw = {
    def: [
      {
        pos: 'noun',
        tr: [
          { text: 'wing', fr: 10, mean: [{ text: 'крылышко' }] },
          { text: 'fender', fr: 5, mean: [{ text: 'брызговик' }] },
          { text: 'blade', fr: 1, mean: [{ text: 'лезвие' }] },
        ],
      },
    ],
  };
  const r = mapYandexResponse(raw, 'крыло', 'ru-en');
  assert.equal(r.senses.length, 2);
  assert.equal(r.senses[0]?.translation, 'wing');
  assert.equal(r.senses[1]?.translation, 'fender');
});

test('junk translations (fr=1) are filtered out (дом → house, not door)', () => {
  const raw = {
    def: [
      {
        pos: 'noun',
        tr: [
          { text: 'house', fr: 10, mean: [{ text: 'здание' }] },
          { text: 'door', fr: 1, mean: [{ text: 'дверь' }] },
        ],
      },
    ],
  };
  const r = mapYandexResponse(raw, 'дом', 'ru-en');
  assert.equal(r.senses.length, 1);
  assert.equal(r.senses[0]?.translation, 'house');
});

test('safety net: if every meaning is low-fr, keep them all (rare word)', () => {
  const raw = { def: [{ tr: [{ text: 'a', fr: 1 }, { text: 'b', fr: 1 }] }] };
  const r = mapYandexResponse(raw, 'rare', 'ru-en');
  assert.equal(r.senses.length, 2);
});

test('meanings without fr are kept and flatten across defs (печь: oven + bake)', () => {
  const raw = {
    def: [
      { pos: 'noun', tr: [{ text: 'oven' }] },
      { pos: 'verb', tr: [{ text: 'bake' }] },
    ],
  };
  const r = mapYandexResponse(raw, 'печь', 'ru-en');
  assert.equal(r.senses.length, 2);
  assert.equal(r.senses[1]?.pos, 'verb');
  assert.equal(r.senses[1]?.translation, 'bake');
});

test('empty def[] yields no senses (the fallback trigger)', () => {
  const r = mapYandexResponse({ def: [] }, 'asdfgh', 'ru-en');
  assert.equal(r.senses.length, 0);
});

test('a tr without text is skipped', () => {
  const raw = { def: [{ tr: [{ fr: 10 }, { text: 'ok', fr: 10 }] }] };
  const r = mapYandexResponse(raw, 'q', 'ru-en');
  assert.equal(r.senses.length, 1);
  assert.equal(r.senses[0]?.translation, 'ok');
});
