import assert from 'node:assert/strict'
import test from 'node:test'

import { sanitizeUserInput } from '../../src/security/sanitizeUserInput.js'

test('sanitizeUserInput keeps clean input untouched', () => {
  const input = 'alpha Beta'
  assert.equal(sanitizeUserInput(input), input)
})

test('sanitizeUserInput removes disallowed fragments without injecting spaces', () => {
  const input = 'hello<script>alert(1)</script>world'
  assert.equal(sanitizeUserInput(input), 'hello world')
})

test('sanitizeUserInput collapses whitespace after removing unsafe characters', () => {
  const input = '\n\t\t'
  assert.equal(sanitizeUserInput(input), '')
})
