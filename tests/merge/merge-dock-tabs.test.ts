import assert from 'node:assert/strict'
import test from 'node:test'

import { planMergeDockTabs } from '../../src/components/MergeDock.tsx'

type MergePrecision = Parameters<typeof planMergeDockTabs>[0]
type MergeDockTabPlan = ReturnType<typeof planMergeDockTabs>

const planTabsCases: readonly [
  name: string,
  precision: MergePrecision,
  lastTab: MergeDockTabPlan['initialTab'] | 'diff' | undefined,
  expectedTabs: readonly string[],
  expectedInitial: MergeDockTabPlan['initialTab'],
  verify?: (plan: MergeDockTabPlan) => void,
][] = [
  [
    'merge: legacy precision hides diff and keeps stored tab',
    'legacy',
    'shot',
    ['compiled', 'shot', 'assets', 'import', 'golden'],
    'shot',
  ],
  [
    'merge: legacy precision falls back when diff was last tab',
    'legacy',
    'diff',
    ['compiled', 'shot', 'assets', 'import', 'golden'],
    'compiled',
  ],
  [
    'merge: beta precision appends diff with badge and preserves initial tab',
    'beta',
    'assets',
    ['compiled', 'shot', 'assets', 'import', 'golden', 'diff'],
    'assets',
    (plan) => {
      const diffTab = plan.tabs[plan.tabs.length - 1]
      assert(diffTab, 'diff tab missing')
      assert.equal(diffTab.label, 'Diff (Beta)')
      assert.equal(diffTab.badge, 'Beta')
    },
  ],
  [
    'merge: stable precision inserts diff before golden and selects it initially',
    'stable',
    'shot',
    ['compiled', 'shot', 'assets', 'import', 'diff', 'golden'],
    'diff',
  ],
  [
    'merge: beta precision keeps diff when it was last tab',
    'beta',
    'diff',
    ['compiled', 'shot', 'assets', 'import', 'golden', 'diff'],
    'diff',
  ],
]

const diffPlanCases: readonly [
  name: string,
  precision: MergePrecision,
  expected: MergeDockTabPlan['diff'],
][] = [
  ['merge-ui: legacy precision exposes no diff plan', 'legacy', undefined],
  [
    'merge-ui: beta precision keeps diff opt-in',
    'beta',
    { exposure: 'opt-in', backupAfterMs: undefined },
  ],
  [
    'merge-ui: stable precision defaults to diff with backup window',
    'stable',
    { exposure: 'default', backupAfterMs: 5 * 60 * 1000 },
  ],
]

test('merge: tab plan snapshot', async (t) => {
  for (const [name, precision, lastTab, expectedTabs, expectedInitial, verify] of planTabsCases) {
    await t.test(name, () => {
      const plan = planMergeDockTabs(precision, lastTab)
      assert.deepEqual(
        plan.tabs.map((tab) => tab.id),
        expectedTabs,
        'tab ids mismatch',
      )
      assert.equal(plan.initialTab, expectedInitial, 'initial tab mismatch')
      verify?.(plan)
    })
  }
})

test('merge-ui: diff exposure plan', async (t) => {
  for (const [name, precision, expected] of diffPlanCases) {
    await t.test(name, () => {
      const plan = planMergeDockTabs(precision)
      if (!expected) {
        assert.equal(plan.diff, undefined)
        return
      }
      assert.ok(plan.diff, 'diff plan missing')
      assert.equal(plan.diff.exposure, expected.exposure)
      assert.equal(plan.diff.backupAfterMs, expected.backupAfterMs)
    })
  }
})
