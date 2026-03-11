/// <reference types="node" />

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'

import { loadTestStrategyExpectations } from './test-strategy-autosave-merge'

type PackageJson = {
  readonly scripts?: Record<string, string>
}

const strategyPath = fileURLToPath(
  new URL('../TEST_STRATEGY_AUTOSAVE_MERGE.md', import.meta.url),
)
const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url))

const deriveScriptNameFromCommand = (command: string): string | null => {
  const match = command.match(/^pnpm(?:\s+-s)?\s+([\w:-]+)$/u)
  if (!match) {
    return null
  }
  const [, script] = match
  return script.startsWith('test:') || script === 'lint' || script === 'typecheck'
    ? script
    : null
}

test.skip('recommended command scripts are defined for pnpm invocation', async () => {
  const expectations = await loadTestStrategyExpectations(strategyPath)
  const scripts = JSON.parse(await readFile(packageJsonPath, 'utf8')) as PackageJson

  assert.ok(scripts.scripts, 'package.json must define scripts section')

  const expectedScripts = new Set(
    expectations.qualityCommands
      .map(deriveScriptNameFromCommand)
      .filter((name): name is string => Boolean(name)),
  )

  assert.ok(expectedScripts.size > 0, 'strategy must derive at least one pnpm script')

  for (const name of expectedScripts) {
    const value = scripts.scripts[name]
    assert.ok(value, `package.json missing script for pnpm -s ${name}`)
    assert.match(
      value.trim(),
      /^pnpm(?:\s|$)/u,
      `${name} script must execute via pnpm to honor recommended commands`,
    )
  }
})
