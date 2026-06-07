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

test('isCorrect matches the answer, article/"to"-insensitive', () => {
  assert.equal(isCorrect('home', 'home'), true);
  assert.equal(isCorrect('a house', 'house'), true);
  assert.equal(isCorrect('to go', 'go'), true);
});

test('isCorrect rejects a different word and typos', () => {
  assert.equal(isCorrect('dwelling', 'house'), false);
  assert.equal(isCorrect('hause', 'house'), false);
});
