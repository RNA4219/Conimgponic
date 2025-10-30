import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveActiveTabTransition,
  resolvePreferenceSelection,
  sanitizeMergeDockActiveTab,
  type MergeDockPreference,
} from '../../../src/lib/merge/preferences.ts'
import type { MergeDockPhasePlan } from '../../../src/lib/merge/phasePlan.ts'

const tabPlan: MergeDockPhasePlan['tabs'] = {
  tabs: [
    { id: 'compiled', label: 'Compiled Script' },
    { id: 'diff', label: 'Diff' },
  ],
  initialTab: 'compiled',
  diff: { exposure: 'default' },
}

const diffPlan: MergeDockPhasePlan['diff'] = {
  exposure: 'default',
  visible: true,
  enabled: true,
  initialTab: 'diff',
}

test('resolvePreferenceSelection resets to default when precision changes', () => {
  const preference = resolvePreferenceSelection({
    precision: 'stable',
    previousPrecision: 'beta',
    diffEnabled: true,
    previousDiffEnabled: true,
    preference: 'manual-first',
    defaultPreference: 'diff-merge',
  })

  assert.equal(preference, 'diff-merge')
})

test('resolvePreferenceSelection preserves sanitized preference when diff becomes available', () => {
  const preference = resolvePreferenceSelection({
    precision: 'beta',
    previousPrecision: 'beta',
    diffEnabled: true,
    previousDiffEnabled: false,
    preference: 'manual-first',
    defaultPreference: 'diff-merge',
  })

  assert.equal(preference, 'manual-first')
})

test('resolvePreferenceSelection demotes to manual when diff is disabled', () => {
  const preference = resolvePreferenceSelection({
    precision: 'beta',
    previousPrecision: 'beta',
    diffEnabled: false,
    previousDiffEnabled: true,
    preference: 'diff-merge',
    defaultPreference: 'manual-first',
  })

  assert.equal(preference, 'manual-first')
})

test('sanitizeMergeDockActiveTab falls back to initial tab for unknown ids', () => {
  const active = sanitizeMergeDockActiveTab('golden', tabPlan, true, true)

  assert.equal(active, tabPlan.initialTab)
})

test('sanitizeMergeDockActiveTab falls back to initial tab when diff hidden', () => {
  const active = sanitizeMergeDockActiveTab('diff', tabPlan, false, true)

  assert.equal(active, tabPlan.initialTab)
})

test('resolveActiveTabTransition resets to initial tab when precision changes', () => {
  const active = resolveActiveTabTransition({
    precision: 'stable',
    previousPrecision: 'beta',
    plan: tabPlan,
    activeTab: 'diff',
    diffVisible: diffPlan.visible,
    diffEnabled: diffPlan.enabled,
    previousDiffEnabled: diffPlan.enabled,
  })

  assert.equal(active, tabPlan.initialTab)
})

test('resolveActiveTabTransition resets when diff toggles off or on', () => {
  const resetWhenDisabled = resolveActiveTabTransition({
    precision: 'beta',
    previousPrecision: 'beta',
    plan: tabPlan,
    activeTab: 'diff',
    diffVisible: diffPlan.visible,
    diffEnabled: false,
    previousDiffEnabled: true,
  })

  const resetWhenReenabled = resolveActiveTabTransition({
    precision: 'beta',
    previousPrecision: 'beta',
    plan: tabPlan,
    activeTab: 'diff',
    diffVisible: diffPlan.visible,
    diffEnabled: true,
    previousDiffEnabled: false,
  })

  assert.equal(resetWhenDisabled, tabPlan.initialTab)
  assert.equal(resetWhenReenabled, tabPlan.initialTab)
})

test('resolveActiveTabTransition keeps sanitized active tab when plan unchanged', () => {
  const stableActive = resolveActiveTabTransition({
    precision: 'beta',
    previousPrecision: 'beta',
    plan: tabPlan,
    activeTab: 'diff',
    diffVisible: diffPlan.visible,
    diffEnabled: diffPlan.enabled,
    previousDiffEnabled: diffPlan.enabled,
  })

  const sanitizedActive = resolveActiveTabTransition({
    precision: 'beta',
    previousPrecision: 'beta',
    plan: tabPlan,
    activeTab: 'diff',
    diffVisible: false,
    diffEnabled: diffPlan.enabled,
    previousDiffEnabled: diffPlan.enabled,
  })

  assert.equal(stableActive, 'diff')
  assert.equal(sanitizedActive, tabPlan.initialTab)
})

const preferenceOrder: readonly MergeDockPreference[] = ['manual-first', 'ai-first', 'diff-merge']

void preferenceOrder
