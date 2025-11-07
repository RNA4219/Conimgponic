// src/lib/tokenizer.test.ts
import test from 'node:test';
import assert from 'node:assert';
import { tokenizeForSimilarity } from './tokenizer.js';

test('tokenizeForSimilarity - basic functionality', async () => {
  const input = 'hello world test';
  const tokens = tokenizeForSimilarity(input);

  assert.deepStrictEqual(tokens, ['hello', 'world', 'test']);
});

test('tokenizeForSimilarity - handles extra whitespace', async () => {
  const input = '  hello   world  \n\t test  ';
  const tokens = tokenizeForSimilarity(input);

  assert.deepStrictEqual(tokens, ['hello', 'world', 'test']);
});

test('tokenizeForSimilarity - handles empty strings', async () => {
  const input = '  \n\t  ';
  const tokens = tokenizeForSimilarity(input);

  assert.deepStrictEqual(tokens, []);
});

test('tokenizeForSimilarity - handles single word', async () => {
  const input = 'hello';
  const tokens = tokenizeForSimilarity(input);

  assert.deepStrictEqual(tokens, ['hello']);
});