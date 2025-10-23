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
const withExt = (spec: string) => (spec.endsWith('.ts') || spec.endsWith('.js') ? spec : `${spec}.ts`)
const resolveImport = (spec: string, parent: string) => (spec.startsWith('.') || spec.startsWith('/') ? resolve(dirname(parent), withExt(spec)) : req.resolve(spec, { paths: [dirname(parent)] }))
const loadModule = async (path: string) => {
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
const importTs = async (path: string) => { const mod = await loadModule(path); if (mod.status !== 'evaluated') await mod.evaluate(); return mod.namespace as any }

test('chatStream propagates abort from external controller', async (t) => {
  const originalFetch = globalThis.fetch
  const cancelReasons: Array<unknown> = []
  const encoder = new TextEncoder()
  const controller = new AbortController()
  const { chatStream } = await importTs(join(root, 'src/lib/ollama.ts'))

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
    return { body: stream } as any
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const iterator = chatStream('llama3.1', 'prompt', { controller })[Symbol.asyncIterator]()
  const first = await iterator.next()
  assert.equal(first.value?.message?.content, 'hello')

  const pending = iterator.next()
  controller.abort()

  await assert.rejects(pending, (error: any) => error?.message === 'aborted')
  assert.ok(cancelReasons.some((reason) => (reason as any)?.message === 'aborted'))
})
