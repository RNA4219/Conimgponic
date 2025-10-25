import assert from 'node:assert/strict'

import { scenario } from './setup'

import type { AutoSaveError } from '../../../src/lib/autosave'

const createLockRecorder = () => {
  const requests: { readonly name: string; readonly mode: string | undefined }[] = []
  let releaseCount = 0
  const locks = {
    async request(
      name: string,
      options: { mode?: string; signal?: AbortSignal },
      callback?: (lock: unknown) => unknown | Promise<unknown>
    ) {
      requests.push({ name, mode: options.mode })
      const handle = {
        async release() {
          releaseCount += 1
        }
      }
      if (callback) {
        const result = await callback(handle)
        return result ?? handle
      }
      return handle
    }
  }
  return {
    locks,
    requests,
    releaseCount: () => releaseCount
  }
}

const { locks, requests, releaseCount } = createLockRecorder()

const isAutoSaveError = (expected: { code: AutoSaveError['code']; retryable: AutoSaveError['retryable'] }) =>
  (error: unknown): error is AutoSaveError => {
    if (!error || typeof error !== 'object') return false
    const candidate = error as AutoSaveError
    return candidate.code === expected.code && candidate.retryable === expected.retryable
  }

scenario(
  'restoreFrom throws history-overflow when history payload missing and acquires project lock',
  { locks },
  async (_t, { restoreFrom }) => {
    requests.length = 0
    let caught: unknown
    try {
      await restoreFrom('2024-01-01T00:00:00.000Z')
      assert.fail('restoreFrom should reject for missing history payload')
    } catch (error) {
      caught = error
    }
    assert.ok(isAutoSaveError({ code: 'history-overflow', retryable: false })(caught))
    assert.equal(requests.length, 1)
    assert.equal(releaseCount(), 1)
  }
)
