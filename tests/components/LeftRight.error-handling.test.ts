const tsNodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
if (tsNodeEnv && !tsNodeEnv.TS_NODE_IGNORE_DIAGNOSTICS) {
  tsNodeEnv.TS_NODE_IGNORE_DIAGNOSTICS = '2304,2307,2580,5097'
}

// @ts-expect-error node:test diagnostics are suppressed via TS_NODE_IGNORE_DIAGNOSTICS
import assert from 'node:assert/strict'
// @ts-expect-error node:test diagnostics are suppressed via TS_NODE_IGNORE_DIAGNOSTICS
import test from 'node:test'

// @ts-expect-error ts-node resolves TS extensions via experimental specifier resolution
import { OllamaRequestError } from '../../src/lib/ollama.ts'
// @ts-expect-error ts-node resolves TS extensions via experimental specifier resolution
import { executeLeftRightGeneration } from '../../src/components/LeftRightPanes.tsx'

type StringUpdater = (value: string | ((prev: string) => string)) => void

test('LeftRight は chatStream 例外時に busy を解除しエラー通知する', async () => {
  const abortRef: { current: AbortController | null } = { current: null }
  const busyLog: boolean[] = []
  let busy = false
  const setBusy = (next: boolean) => {
    busy = next
    busyLog.push(next)
  }
  let right = 'initial'
  const setRight: StringUpdater = (next) => {
    right = typeof next === 'function' ? (next as (prev: string) => string)(right) : next
  }

  const alerts: string[] = []
  const alert = (message: string) => {
    alerts.push(message)
  }
  const consoleEntries: unknown[][] = []
  const consoleError = (...args: unknown[]) => {
    consoleEntries.push(args)
  }

  const failure = new OllamaRequestError(503, 'Service Unavailable', 'temporary outage')
  const chatStream = async function* mockChatStream() {
    yield {}
    throw failure
  }

  await executeLeftRightGeneration({
    getPrompt: () => 'prompt',
    isBusy: () => busy,
    setBusy,
    setRight,
    abortRef,
    alert,
    consoleError,
    chatStream,
  })

  assert.deepEqual(busyLog, [true, false], 'busy フラグは true → false と遷移する')
  assert.equal(busy, false, 'busy フラグは解除される')
  assert.equal(abortRef.current, null, 'abortRef は finally で解放される')
  assert.equal(right, '', '失敗時も右ペインは初期化される')
  assert.equal(alerts.at(-1), failure.message, 'alert でエラーメッセージを通知する')
  assert.equal(consoleEntries.length, 1, 'console.error は 1 回呼ばれる')
  assert.ok(consoleEntries[0].includes(failure), 'console.error は例外をログに含める')
})
