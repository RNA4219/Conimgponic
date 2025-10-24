import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

import { scenario } from './autosave/setup'

import type { Storyboard } from '../../src/types'

type Deferred<T> = {
  promise: Promise<T>
  resolve(value: T | PromiseLike<T>): void
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const makeStoryboard = (): Storyboard => ({
  id: 'storyboard',
  title: 'Storyboard',
  scenes: [],
  selection: [],
  version: 1
})

const resolved: Deferred<void> = { promise: Promise.resolve(), resolve: () => {} }
let gate: Deferred<void> = resolved
let lockRequested: Deferred<void> = resolved

scenario(
  'dispose waits for in-flight flushNow to complete before disabling',
  {
    locks: {
      async request(
        _name: string,
        _options: unknown,
        callback: (lock: { release(): Promise<void> }) => Promise<unknown>
      ) {
        const currentGate = gate
        const requested = lockRequested
        if (!currentGate || !requested) throw new Error('synchronization primitives missing')
        requested.resolve()
        await currentGate.promise
        const handle = {
          async release() {}
        }
        return callback(handle)
      }
    }
  },
  async (_t, { initAutoSave }) => {
    gate = deferred<void>()
    lockRequested = deferred<void>()
    const runner = initAutoSave(makeStoryboard, { disabled: false })

    const flushPromise = runner.flushNow()
    await lockRequested.promise

    const disposePromise = runner.dispose()

    const pendingOrDisposed = await Promise.race([
      disposePromise.then(() => 'disposed'),
      delay(0).then(() => 'pending')
    ])
    assert.equal(pendingOrDisposed, 'pending')

    gate.resolve()
    await flushPromise
    await disposePromise

    assert.equal(runner.snapshot().phase, 'disabled')
    gate = resolved
    lockRequested = resolved
  }
)
