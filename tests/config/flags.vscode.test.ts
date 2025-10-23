import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DEFAULT_FLAGS, resolveFlags } from '../../src/config/index.ts'

const clock = () => new Date('2024-08-01T12:00:00.000Z')
const storageStub = (values: Record<string, string | null>) => ({
  getItem: (key: string) => (key in values ? values[key] : null)
})

describe('resolveFlags VS Code settings bridge', () => {
  it('env takes precedence over VS Code settings and storage', () => {
    const snapshot = resolveFlags({
      env: { VITE_AUTOSAVE_ENABLED: 'true', VITE_MERGE_PRECISION: 'stable' },
      settings: {
        get: (key: string) => (key === 'autosave.enabled' ? false : key === 'merge.precision' ? 'beta' : undefined)
      },
      storage: storageStub({ 'autosave.enabled': 'false', 'merge.precision': 'legacy' }),
      clock
    })

    assert.equal(snapshot.autosave.enabled, true)
    assert.equal(snapshot.autosave.source, 'env')
    assert.equal(snapshot.merge.precision, 'stable')
    assert.equal(snapshot.merge.source, 'env')
    assert.equal(snapshot.updatedAt, '2024-08-01T12:00:00.000Z')
  })

  it('VS Code settings drive FlagSnapshot when env is absent', () => {
    const snapshot = resolveFlags({
      settings: { autosave: { enabled: true }, merge: { precision: 'beta' } },
      storage: storageStub({ 'autosave.enabled': 'false', 'merge.precision': 'legacy' }),
      clock
    })

    assert.equal(snapshot.autosave.enabled, true)
    assert.equal(snapshot.autosave.source, 'vscode-settings')
    assert.equal(snapshot.merge.precision, 'beta')
    assert.equal(snapshot.merge.source, 'vscode-settings')
  })

  it('falls back to localStorage when VS Code settings are missing', () => {
    const snapshot = resolveFlags({
      storage: storageStub({ 'autosave.enabled': 'true', 'merge.precision': 'beta' }),
      clock
    })

    assert.equal(snapshot.autosave.enabled, true)
    assert.equal(snapshot.autosave.source, 'localStorage')
    assert.equal(snapshot.merge.precision, 'beta')
    assert.equal(snapshot.merge.source, 'localStorage')
  })

  it('returns defaults when no input layers provide values', () => {
    const snapshot = resolveFlags({ clock })

    assert.equal(snapshot.autosave.enabled, DEFAULT_FLAGS.autosave.enabled)
    assert.equal(snapshot.autosave.source, 'default')
    assert.equal(snapshot.merge.precision, DEFAULT_FLAGS.merge.precision)
    assert.equal(snapshot.merge.source, 'default')
  })
})
