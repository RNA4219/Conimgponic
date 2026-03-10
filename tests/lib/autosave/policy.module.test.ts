import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))

const importPolicyModule = () =>
  import('../../../src/lib/autosave/policy.ts') as Promise<
    typeof import('../../../src/lib/autosave/policy.ts')
  >

const importRootModule = () =>
  import('../../../src/lib/autosave.ts') as Promise<
    typeof import('../../../src/lib/autosave.ts')
  >

test('autosave policy module exposes frozen canonical policy', async () => {
  const { AUTOSAVE_POLICY, resolveAutoSavePolicy } = await importPolicyModule()
  assert.ok(Object.isFrozen(AUTOSAVE_POLICY), 'policy must be frozen to prevent runtime mutation')
  assert.deepEqual(resolveAutoSavePolicy(), AUTOSAVE_POLICY)
})

test('autosave root module re-exports policy facade', async () => {
  const rootModule = await importRootModule()
  const policy = await importPolicyModule()
  assert.strictEqual(rootModule.AUTOSAVE_POLICY, policy.AUTOSAVE_POLICY)
  assert.strictEqual(rootModule.resolveAutoSavePolicy, policy.resolveAutoSavePolicy)
  assert.strictEqual(rootModule.AUTOSAVE_DEFAULTS, policy.AUTOSAVE_DEFAULTS)
  assert.strictEqual(rootModule.AUTOSAVE_MAX_BYTES, policy.AUTOSAVE_MAX_BYTES)
})