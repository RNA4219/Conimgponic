import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_MERGE_ENGINE, MergeTrace } from '../../src/lib/merge'
import { planDiffMergeSubTabs, PRECISION_PHASE_GUARD } from '../../src/components/DiffMergeView'
import { createVsCodeMergeBridge } from '../../src/platform/vscode/merge/bridge'

const readAutoRate = (trace: MergeTrace): number => trace.summary.autoAdoptionRate

const assertDecisionTrace = (trace: MergeTrace): void => {
  assert.ok(trace.decisions.length > 0, 'trace.decisions must be populated')
  trace.decisions.forEach((entry) => {
    assert.ok(entry.similarity >= 0, 'similarity should be non-negative')
    assert.ok(entry.threshold > 0, 'threshold should be positive')
    assert.ok(entry.decision === 'auto' || entry.decision === 'conflict', 'decision should be captured')
  })
}

test('precision phase guard keeps tab plan aligned with phase expectations', () => {
  (['legacy', 'beta', 'stable'] as const).forEach((precision) => {
    const plan = planDiffMergeSubTabs(precision)
    const phaseGuard = PRECISION_PHASE_GUARD[precision]

    assert.deepEqual(plan.tabs, phaseGuard.allowedTabs)
    assert.equal(plan.initialTab, phaseGuard.initialTab)
  })
})

test('merge bridge returns trace with threshold decisions and maintains auto adoption rate', async () => {
  const bridge = createVsCodeMergeBridge({
    engine: DEFAULT_MERGE_ENGINE,
    resolvePrecision: () => 'beta',
    readThreshold: () => 0.7,
  })

  const response = await bridge.handleMergeRequest({
    type: 'merge.request',
    apiVersion: 1,
    reqId: 'req-1',
    payload: {
      base: 'Line A\n\nLine B',
      ours: 'Line A\n\nLine B',
      theirs: 'Line A\n\nLine B',
      sceneId: 'scene-bridge',
    },
  })

  assert.equal(response.type, 'merge.result')
  assert.equal(response.reqId, 'req-1')
  assert.equal(response.ok, true)
  assert.ok(response.trace)
  assertDecisionTrace(response.trace)
  assert.equal(response.trace.summary.threshold, 0.7)
  assert.ok(readAutoRate(response.trace) >= 0.8)
  assert.equal(response.result?.trace.summary.threshold, 0.7)
})
