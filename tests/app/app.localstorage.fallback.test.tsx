import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToString } from 'react-dom/server'

import App, { planAutoSave } from '../../src/App'
import { DEFAULT_FLAG_SNAPSHOT } from '../../src/config'
import { AUTOSAVE_POLICY } from '../../src/lib/autosave'

const scope = globalThis as { localStorage?: unknown }

function createManualPlan() {
  return {
    snapshot: DEFAULT_FLAG_SNAPSHOT,
    guard: {
      featureFlag: { value: false, source: 'default' as const },
      optionsDisabled: false
    },
    failSafePhase: 'phase-a0' as const,
    policy: AUTOSAVE_POLICY,
    errors: [] as const
  }
}

test('App renders without localStorage while planAutoSave stays usable', () => {
  const original = scope.localStorage
  Reflect.deleteProperty(scope, 'localStorage')

  try {
    assert.doesNotThrow(() => {
      renderToString(React.createElement(App))
    })

    const decision = planAutoSave(createManualPlan())
    assert.equal(decision.mode, 'manual-only')
  } finally {
    if (original === undefined) {
      Reflect.deleteProperty(scope, 'localStorage')
    } else {
      scope.localStorage = original
    }
  }
})
