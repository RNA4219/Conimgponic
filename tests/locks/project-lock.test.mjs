import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)))
const outDir = mkdtempSync(join(tmpdir(), 'locks-'))
execSync(`tsc --module es2020 --target es2020 --moduleResolution node --rootDir src --outDir ${outDir} src/lib/locks.ts src/lib/opfs.ts`, { cwd: root, stdio: 'ignore' })
const { readFile, writeFile } = await import('node:fs/promises')
const locksPath = join(outDir, 'lib/locks.js')
await writeFile(locksPath, (await readFile(locksPath, 'utf8')).replace('./opfs', './opfs.js'))
const loadLocks = async () => import(pathToFileURL(locksPath).href)
const createOpfs = () => {
  const files = new Map()
  const dirs = new Map()
  const makeDir = (path) => {
    if (dirs.has(path)) return dirs.get(path)
    const dir = {
      async getDirectoryHandle(name){ return makeDir(`${path}/${name}`) },
      async getFileHandle(name){
        const full = `${path}/${name}`.replace(/^\/+/, '')
        return {
          async createWritable(){ return { async write(data){ files.set(full, data) }, async close(){} } },
          async getFile(){ if (!files.has(full)) throw new Error('missing file'); const data = files.get(full); return { async text(){ return data } } }
        }
      },
      async removeEntry(name){ files.delete(`${path}/${name}`.replace(/^\/+/, '')) }
    }
    dirs.set(path, dir)
    return dir
  }
  return { files, storage: { async getDirectory(){ return makeDir('') } } }
}
const setup = async (t, overrides) => {
  const opfs = createOpfs()
  Object.defineProperty(globalThis, 'navigator', { value: { storage: opfs.storage, ...overrides }, configurable: true, writable: true })
  const locks = await loadLocks()
  const events = []
  const unsubscribe = locks.projectLockEvents.subscribe(ev => events.push(ev))
  t.after(() => { unsubscribe(); delete globalThis.navigator })
  return { opfs, locks, events }
}
test('web lock acquisition emits attempt then acquired', async (t) => {
  const { locks, events } = await setup(t, { locks: { async request(){ return { async release(){} } } } })
  const lease = await locks.acquireProjectLock()
  assert.equal(lease.strategy, 'web-lock')
  assert.deepEqual(events.map(e => e.type), ['lock:attempt', 'lock:acquired'])
  await locks.releaseProjectLock(lease)
})
test('fallback lock engages when web locks unsupported', async (t) => {
  const { opfs, locks, events } = await setup(t, {})
  const lease = await locks.acquireProjectLock()
  assert.equal(lease.strategy, 'file-lock')
  assert.ok(opfs.files.has('project/.lock'))
  assert.equal(events.filter(e => e.type === 'lock:fallback-engaged').length, 1)
  await locks.releaseProjectLock(lease)
})
test('renew extends ttl and schedules heartbeat', async (t) => {
  const { locks, events } = await setup(t, {})
  const lease = await locks.acquireProjectLock()
  const renewed = await locks.renewProjectLock(lease)
  assert.ok(renewed.expiresAt > lease.expiresAt)
  const types = events.map(e => e.type)
  assert.ok(types.indexOf('lock:renew-scheduled') < types.indexOf('lock:renewed'))
})
test('withProjectLock releases lease after executor failure', async (t) => {
  const { locks, events } = await setup(t, {})
  await assert.rejects(locks.withProjectLock(async () => { throw new locks.ProjectLockError('renew-failed', 'fatal', { retryable: false, operation: 'renew' }) }))
  const types = events.map(e => e.type)
  assert.ok(types.includes('lock:readonly-entered'))
  const releaseIndex = types.indexOf('lock:release-requested')
  const releasedIndex = types.indexOf('lock:released')
  assert.ok(releaseIndex >= 0 && releasedIndex > releaseIndex)
})
