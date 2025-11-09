import { strict as assert } from 'node:assert'
import test from 'node:test'

import { resolveAutoSaveBootstrapPlan, resolvePluginBridgeBootstrapPlan } from '../../src/config/bootstrap_exports'

test('bootstrap_exports: functions are exported', () => {
  assert.equal(typeof resolveAutoSaveBootstrapPlan, 'function')
  assert.equal(typeof resolvePluginBridgeBootstrapPlan, 'function')
})

test('bootstrap_exports: produce plan objects', () => {
  const autosavePlan = resolveAutoSaveBootstrapPlan()
  const pluginPlan = resolvePluginBridgeBootstrapPlan()
  assert.ok(autosavePlan && typeof autosavePlan === 'object')
  assert.ok(pluginPlan && typeof pluginPlan === 'object')
})
