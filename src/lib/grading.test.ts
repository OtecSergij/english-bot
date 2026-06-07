import test from 'node:test';
import assert from 'node:assert/strict';
import { isCorrect, normalizeAnswer } from './grading';

test('normalizeAnswer trims, lowercases, collapses whitespace', () => {
  assert.equal(normalizeAnswer('  The   House '), 'house');
});

test('normalizeAnswer strips a leading article and "to"', () => {
  assert.equal(normalizeAnswer('a car'), 'car');
  assert.equal(normalizeAnswer('an apple'), 'apple');
  assert.equal(normalizeAnswer('to go'), 'go');
});

test('isCorrect matches any accepted answer, article-insensitive', () => {
  assert.equal(isCorrect('home', ['house', 'home']), true);
  assert.equal(isCorrect('a house', ['house']), true);
});

test('isCorrect rejects synonyms not in the set and typos', () => {
  assert.equal(isCorrect('dwelling', ['house', 'home']), false);
  assert.equal(isCorrect('hause', ['house']), false);
});
