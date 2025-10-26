import test from 'node:test'
import assert from 'node:assert/strict'
import { accessSync, constants, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('rollout monitor template exists with required sections and is wired to reporter', async () => {
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
  const templateRelativePath = 'templates/alerts/rollout-monitor.md'
  const templatePath = join(repoRoot, templateRelativePath)
  assert.doesNotThrow(() => accessSync(templatePath, constants.R_OK))
  const content = readFileSync(templatePath, 'utf8')
  assert.match(content, /#autosave-canary/)
  assert.match(content, /#autosave-ga/)
  assert.match(content, /Autosave & Precision Merge/)
  const module = await import(pathToFileURL(join(repoRoot, 'scripts/monitor/collect-metrics.ts')).href)
  const contract: typeof import('../../scripts/monitor/collect-metrics.ts')['COLLECT_METRICS_CONTRACT'] = module.COLLECT_METRICS_CONTRACT
  const referencedTemplates = new Set(contract.notifications.map((notification) => notification.template))
  assert.ok(
    referencedTemplates.has(templateRelativePath),
    'Collector notifications should reference rollout-monitor template',
  )
  assert.ok(
    contract.notifications.every((notification) => notification.template === templateRelativePath),
    'All rollout monitor notifications should use rollout-monitor template',
  )
})
