import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

test.skip('resolveAutoSavePolicy always returns canonical AUTOSAVE_POLICY instance', async () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url))

  const importTs = async <T>(path: string): Promise<T> => {
    return import(path) as Promise<T>
  }

  const importAutosaveModule = () =>
    importTs<typeof import('../../../src/lib/autosave.ts')>(
      join(root, 'src/lib/autosave.ts')
    )

  const importPolicyModule = () =>
    importTs<typeof import('../../../src/lib/autosave/policy.ts')>(
      join(root, 'src/lib/autosave/policy.ts')
    )

  const autosave = await importAutosaveModule()
  const policy = await importPolicyModule()

  const workspace = {
    get(key: string): unknown {
      switch (key) {
        case 'conimg.autosave.historyLimit':
          return 99
        case 'conimg.autosave.sizeLimitMB':
          return 256
        default:
          return undefined
      }
    }
  }

  const defaultPolicy = autosave.resolveAutoSavePolicy()
  const workspacePolicy = autosave.resolveAutoSavePolicy({ workspace })

  assert.strictEqual(defaultPolicy, autosave.AUTOSAVE_POLICY)
  assert.strictEqual(workspacePolicy, autosave.AUTOSAVE_POLICY)
  assert.strictEqual(policy.resolveAutoSavePolicy(), policy.AUTOSAVE_POLICY)
})
