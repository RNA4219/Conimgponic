import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, type ChildProcess } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

type SpawnFn = typeof import('node:child_process')['spawn']; type RunSelectedModule = typeof import('../../scripts/test/run-selected.js')
const scriptUrl = new URL('../../scripts/test/run-selected.ts', import.meta.url), repoRoot = fileURLToPath(new URL('../..', import.meta.url)), BASE_ARGS = ['--loader', 'ts-node/esm', '--test'] as const

const createChildProcess = (): ChildProcess => {
  const stub: Partial<ChildProcess> = {}
  stub.on = (() => stub as ChildProcess) as ChildProcess['on']
  return stub as ChildProcess
}

const createFakeNodeEnvironment = () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'run-selected-'))
  const fakeNodePath = join(tempDir, 'node')
  const logPath = join(tempDir, 'log.bin')
  writeFileSync(
    fakeNodePath,
    '#!/bin/sh\nlog="$RUN_SELECTED_AUTORUN_LOG"\n[ -z "$log" ] && exit 1\n: > "$log"\nfor arg in "$@"; do printf "%s\\0" "$arg" >> "$log"; done\n',
  )
  chmodSync(fakeNodePath, 0o755)
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${tempDir}${delimiter}${process.env.PATH ?? ''}`, RUN_SELECTED_AUTORUN_LOG: logPath }
  return {
    env,
    readArgs: (): string[] | undefined => {
      try {
        const buffer = readFileSync(logPath)
        if (buffer.length === 0) return []
        const tokens = buffer.toString('utf8').split('\0')
        tokens.pop()
        return tokens
      } catch {
        return undefined
      }
    },
  }
}

test('autoruns via CLI when RUN_SELECTED_SKIP_AUTORUN is unset', () => {
  const { env, readArgs } = createFakeNodeEnvironment()
  delete env.RUN_SELECTED_SKIP_AUTORUN
  const status = spawnSync(process.execPath, ['--loader', 'ts-node/esm', 'scripts/test/run-selected.ts', '--test-name-pattern=__noop__'], { cwd: repoRoot, env, encoding: 'utf8' }).status
  assert.equal(status, 0)
  const recorded = readArgs() ?? []
  assert.ok(recorded.length > 0)
  assert.deepEqual(recorded.slice(0, 3), BASE_ARGS)
})

test('RUN_SELECTED_SKIP_AUTORUN=1 keeps CI filter flows manual', async (t) => {
  const { env, readArgs } = createFakeNodeEnvironment()
  env.RUN_SELECTED_SKIP_AUTORUN = '1'
  const cliResult = spawnSync(process.execPath, ['--loader', 'ts-node/esm', 'scripts/test/run-selected.ts'], { cwd: repoRoot, env, encoding: 'utf8' })
  assert.equal(cliResult.status, 0)
  assert.equal(readArgs(), undefined)
  const originalSkip = process.env.RUN_SELECTED_SKIP_AUTORUN
  process.env.RUN_SELECTED_SKIP_AUTORUN = '1'
  try {
    const module = (await import(`${scriptUrl.href}?skip=${Date.now()}`)) as RunSelectedModule
    const spawnCalls: Array<Parameters<SpawnFn>> = []
    const spawnStub: SpawnFn = ((...args: Parameters<SpawnFn>) => {
      spawnCalls.push(args)
      return createChildProcess()
    }) as SpawnFn
    const { runSelected } = module
    const cases = [{ filter: 'autosave', ensure: (targets: readonly string[]) => assert.ok(targets.some((target) => target.includes('autosave'))) }, { filter: 'telemetry', ensure: (targets: readonly string[]) => assert.ok(targets.some((target) => target.startsWith('tests/telemetry/'))) }] as const
    for (const { filter, ensure } of cases) {
      await t.test(`pnpm test -- --filter ${filter}`, () => {
        runSelected(['--filter', filter, '--test-name-pattern=__noop__'], spawnStub)
        assert.equal(spawnCalls.length, 1)
        const [, nodeArgs] = spawnCalls.pop()!
        assert.deepEqual(nodeArgs.slice(0, 3), BASE_ARGS)
        const sanitizedIndex = nodeArgs.indexOf('--test-name-pattern=__noop__')
        assert.notEqual(sanitizedIndex, -1)
        const forwarded = nodeArgs.slice(sanitizedIndex + 1)
        assert.ok(forwarded.length > 0)
        assert.ok(forwarded.every((target) => target.startsWith('tests/') && target.endsWith('.test.ts')))
        assert.ok(!forwarded.includes('tests/**/*.test.ts'))
        ensure(forwarded)
      })
    }
  } finally {
    originalSkip === undefined
      ? delete process.env.RUN_SELECTED_SKIP_AUTORUN
      : (process.env.RUN_SELECTED_SKIP_AUTORUN = originalSkip)
  }
})
