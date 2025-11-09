import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_FLAGS } from '../../../src/config/flags'
import { resolveAutoSaveFromFlagSnapshot } from '../../../src/lib/autosave/flags'
import type { FlagSnapshot } from '../../../src/config/flags'

test('resolveAutoSaveFromFlagSnapshot extracts autosave settings from FlagSnapshot correctly', () => {
  const flagSnapshot: FlagSnapshot = {
    autosave: {
      value: true,
      enabled: true,
      source: 'env' as const,
      errors: []
    },
    plugins: {
      value: false,
      enabled: false,
      source: 'default' as const,
      errors: []
    },
    merge: {
      value: 'beta' as const,
      precision: 'beta' as const,
      source: 'workspace' as const,
      errors: [],
      threshold: 0.8
    },
    updatedAt: '2024-01-01T00:00:00.000Z'
  }

  const result = resolveAutoSaveFromFlagSnapshot(flagSnapshot)

  assert.equal(result.featureFlag.value, true)
  assert.equal(result.featureFlag.source, 'env')
  assert.equal(result.optionsDisabled, false) // optionsDisabledはデフォルトでfalse
})

test('resolveAutoSaveFromFlagSnapshot handles disabled state correctly', () => {
  const flagSnapshot: FlagSnapshot = {
    autosave: {
      value: false,
      enabled: false,
      source: 'default' as const,
      errors: []
    },
    plugins: {
      value: false,
      enabled: false,
      source: 'default' as const,
      errors: []
    },
    merge: {
      value: 'legacy' as const,
      precision: 'legacy' as const,
      source: 'default' as const,
      errors: [],
      threshold: 0.75
    },
    updatedAt: '2024-01-01T00:00:00.000Z'
  }

  const result = resolveAutoSaveFromFlagSnapshot(flagSnapshot)

  assert.equal(result.featureFlag.value, false)
  assert.equal(result.featureFlag.source, 'default')
  assert.equal(result.optionsDisabled, false)
})

test('resolveAutoSaveFromFlagSnapshot maintains compatibility with AutoSavePhaseGuardSnapshot interface', () => {
  const flagSnapshot: FlagSnapshot = {
    autosave: {
      value: true,
      enabled: true,
      source: 'localStorage' as const,
      errors: []
    },
    plugins: {
      value: true,
      enabled: true,
      source: 'default' as const,
      errors: []
    },
    merge: {
      value: 'stable' as const,
      precision: 'stable' as const,
      source: 'env' as const,
      errors: [],
      threshold: 0.82
    },
    updatedAt: '2024-01-01T00:00:00.000Z'
  }

  const result = resolveAutoSaveFromFlagSnapshot(flagSnapshot)

  // Check that result matches the expected interface
  assert.equal(typeof result.featureFlag.value, 'boolean')
  assert.ok(['env', 'workspace', 'localStorage', 'default'].includes(result.featureFlag.source))
  assert.equal(typeof result.optionsDisabled, 'boolean')
})

test('resolveAutoSaveFromFlagSnapshot uses defaults when flagSnapshot is undefined', () => {
  // Test with undefined flagSnapshot
  const result = resolveAutoSaveFromFlagSnapshot(undefined)
  
  assert.equal(result.featureFlag.value, DEFAULT_FLAGS.autosave.enabled)
  assert.equal(result.featureFlag.source, 'default')
  assert.equal(result.optionsDisabled, false)
})