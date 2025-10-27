import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { ReadableStream } from 'node:stream/web'

createRequire(import.meta.url)('ts-node/register')
const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const importTs = async <TModule = Record<string, unknown>>(path: string): Promise<TModule> =>
  import(pathToFileURL(path).href) as Promise<TModule>

test('chatStream throws when fetch response is not ok', async (t) => {
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  const encoder = new TextEncoder()
  const body = 'Server error: something went terribly wrong. '.repeat(20)
  const { chatStream } = await importTs<typeof import('../../../src/lib/ollama')>(join(root, 'src/lib/ollama.ts'))

  globalThis.fetch = async (_url: string, init?: { signal?: AbortSignal }) => {
    assert.ok(init?.signal)
    assert.strictEqual(init.signal, controller.signal)
    const stream = new ReadableStream<Uint8Array>({
      start(streamController){
        streamController.enqueue(encoder.encode(body))
        streamController.close()
      }
    })
    return { ok: false, status: 500, statusText: 'Internal Server Error', body: stream, async text(){ return body } } as Response
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const iterator = chatStream('llama3.1', 'prompt', { controller })[Symbol.asyncIterator]()
  await assert.rejects(iterator.next(), (error: unknown) => {
    if (!(error instanceof Error)) return false
    assert.match(error.message, /HTTP 500/)
    assert.ok(error.message.includes('Internal Server Error'))
    assert.ok(error.message.includes(body.slice(0, 200).trimEnd()))
    return true
  })
})
