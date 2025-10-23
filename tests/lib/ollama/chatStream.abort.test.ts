import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { ReadableStream } from 'node:stream/web'
import ts from 'typescript'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const req = createRequire(import.meta.url)
const cache = new Map<string, vm.SourceTextModule>()
interface ResponseLike {
  readonly body: ReadableStream<Uint8Array> | null
}
const withExt = (spec: string): string => (spec.endsWith('.ts') || spec.endsWith('.js') ? spec : `${spec}.ts`)
const resolveImport = (spec: string, parent: string): string =>
  spec.startsWith('.') || spec.startsWith('/') ? resolve(dirname(parent), withExt(spec)) : req.resolve(spec, { paths: [dirname(parent)] })
const loadModule = async (path: string): Promise<vm.SourceTextModule> => {
  if (cache.has(path)) return cache.get(path)!
  const { outputText } = ts.transpileModule(await readFile(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      esModuleInterop: true
    },
    fileName: path
  })
  const mod = new vm.SourceTextModule(outputText, {
    identifier: path,
    initializeImportMeta(meta){ meta.url = pathToFileURL(path).href },
    async importModuleDynamically(spec){ return { namespace: await importTs(resolveImport(spec, path)) } }
  })
  cache.set(path, mod)
  await mod.link(async (spec) => loadModule(resolveImport(spec, path)))
  return mod
}
const importTs = async <TModule = Record<string, unknown>>(path: string): Promise<TModule> => {
  const mod = await loadModule(path)
  if (mod.status !== 'evaluated') await mod.evaluate()
  return mod.namespace as TModule
}

const isAbortError = (error: unknown): error is Error => error instanceof Error && error.message === 'aborted'

test('chatStream propagates abort from external controller', async (t) => {
  const originalFetch = globalThis.fetch
  const cancelReasons: unknown[] = []
  const encoder = new TextEncoder()
  const controller = new AbortController()
  const { chatStream } = await importTs<typeof import('../../../src/lib/ollama')>(join(root, 'src/lib/ollama.ts'))

  globalThis.fetch = async (_url: string, init?: { signal?: AbortSignal }) => {
    assert.ok(init?.signal, 'signal is required')
    assert.strictEqual(init.signal, controller.signal)
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
    const stream = new ReadableStream<Uint8Array>({
      start(streamController){
        controllerRef = streamController
        streamController.enqueue(encoder.encode(`${JSON.stringify({ message: { role: 'assistant', content: 'hello' } })}\n`))
      },
      pull(){},
      cancel(reason){
        cancelReasons.push(reason)
      }
    })
    init.signal.addEventListener('abort', () => {
      const error = new Error('aborted')
      cancelReasons.push(error)
      controllerRef?.error(error)
    }, { once: true })
    return { body: stream } as ResponseLike
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
