// テスト雛形: VSCode Flags モジュールの基本挙動を検証
import { describe, it, expect } from 'vitest'
import { resolveWorkspaceFlags, collectFlagResolutionPayloads, createAutoSaveBootstrapPayload } from '../../../src/platform/vscode/flags'

describe('flags.ts basic behavior', () => {
  it('should resolve default flags', () => {
    const flags = resolveWorkspaceFlags()
    expect(flags).toHaveProperty('enableAutoSave')
  })

  it('should create bootstrap payload', () => {
    const payload = createAutoSaveBootstrapPayload()
    expect(payload).toHaveProperty('bootstrap')
  })

  it('should collect payloads', () => {
    const cps = collectFlagResolutionPayloads()
    expect(Array.isArray(cps)).toBe(true)
  })
})
