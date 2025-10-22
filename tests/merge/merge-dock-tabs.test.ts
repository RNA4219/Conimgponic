import { planMergeDockTabs } from '../../src/components/MergeDock.tsx'

const cases = [
  ['T1 legacy precision hides diff and keeps stored tab', 'legacy', 'shot', ['compiled', 'shot', 'assets', 'import', 'golden'], 'shot'],
  ['T2 legacy precision falls back when diff was last tab', 'legacy', 'diff', ['compiled', 'shot', 'assets', 'import', 'golden'], 'compiled'],
  ['T3 beta precision appends diff with badge and preserves initial tab', 'beta', 'assets', ['compiled', 'shot', 'assets', 'import', 'golden', 'diff'], 'assets', (plan: ReturnType<typeof planMergeDockTabs>) => {
    const diffTab = plan.tabs.at(-1)
    if (!diffTab || diffTab.label !== 'Diff (Beta)' || diffTab.badge !== 'Beta') throw new Error('diff tab invalid')
  }],
  ['T4 stable precision inserts diff before golden and selects it initially', 'stable', 'shot', ['compiled', 'shot', 'assets', 'import', 'diff', 'golden'], 'diff'],
  ['T5 beta precision keeps diff when it was last tab', 'beta', 'diff', ['compiled', 'shot', 'assets', 'import', 'golden', 'diff'], 'diff']
] as const

const json = (value: unknown) => JSON.stringify(value)

for (const [name, precision, lastTab, expectedTabs, expectedInitial, verify] of cases) {
  try {
    const plan = planMergeDockTabs(precision as 'legacy' | 'beta' | 'stable', lastTab as any)
    if (json(plan.tabs.map((tab) => tab.id)) !== json(expectedTabs)) throw new Error('tabs mismatch')
    if (plan.initialTab !== expectedInitial) throw new Error('initial mismatch')
    ;(verify as ((plan: ReturnType<typeof planMergeDockTabs>) => void) | undefined)?.(plan)
    // eslint-disable-next-line no-console
    console.log(`\u2713 ${name}`)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`\u2717 ${name}`)
    throw error
  }
}

const diffPlanExpectations = [
  ['E1 legacy precision exposes no diff plan', 'legacy', undefined],
  ['E2 beta precision keeps diff opt-in', 'beta', { exposure: 'opt-in', backupAfterMs: undefined }],
  ['E3 stable precision defaults to diff with backup window', 'stable', { exposure: 'default', backupAfterMs: 5 * 60 * 1000 }]
] as const

for (const [name, precision, expected] of diffPlanExpectations) {
  try {
    const plan = planMergeDockTabs(precision as 'legacy' | 'beta' | 'stable')
    if (!expected) {
      if (plan.diff !== undefined) throw new Error('diff plan should be undefined')
    } else {
      if (!plan.diff) throw new Error('diff plan missing')
      if (plan.diff.exposure !== expected.exposure) throw new Error('diff exposure mismatch')
      if (plan.diff.backupAfterMs !== expected.backupAfterMs) throw new Error('diff backup mismatch')
    }
    // eslint-disable-next-line no-console
    console.log(`\u2713 ${name}`)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`\u2717 ${name}`)
    throw error
  }
}
