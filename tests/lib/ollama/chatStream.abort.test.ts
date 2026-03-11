import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ReadableStream } from 'node:stream/web'

const isAbortError = (error: unknown): error is Error => error instanceof Error && error.message === 'aborted'

test.skip('chatStream propagates abort from external controller', async (t) => {
  const originalFetch = globalThis.fetch
  const cancelReasons: unknown[] = []
  const encoder = new TextEncoder()
  const controller = new AbortController()
  const { chatStream } = await import('../../../src/lib/ollama.ts')

  globalThis.fetch = async (_url: string, init?: { signal?: AbortSignal }) => {
    assert.ok(init?.signal, 'signal is required')
    assert.strictEqual(init.signal, controller.signal)
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        controllerRef = streamController
        streamController.enqueue(encoder.encode(`${JSON.stringify({ message: { role: 'assistant', content: 'hello' } })}\n`))
      },
      pull() {},
      cancel(reason) {
        cancelReasons.push(reason)
      }
    })
    init.signal.addEventListener('abort', () => {
      const error = new Error('aborted')
      cancelReasons.push(error)
      controllerRef?.error(error)
    }, { once: true })
    return { body: stream } as { readonly body: ReadableStream<Uint8Array> | null }
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const iterator = chatStream('llama3.1', 'prompt', { controller })[Symbol.asyncIterator]()
  const first = await iterator.next()
  assert.equal(first.value?.message?.content, 'hello')

  const pending = iterator.next()
  controller.abort()

  await assert.rejects(pending, isAbortError)
  assert.ok(cancelReasons.some((reason) => isAbortError(reason)))
})