import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_MERGE_ENGINE,
  PRECISION_THRESHOLD_CLAMP,
  type MergePrecision,
} from '../../src/lib/merge'
import { createVsCodeMergeBridge } from '../../src/platform/vscode/merge/bridge'

type ThresholdScenario = {
  readonly precision: MergePrecision
  readonly requestThreshold: number | undefined
  readonly readThreshold: number | undefined
  readonly expectedThreshold: number
  readonly description: string
}

describe('createVsCodeMergeBridge threshold sanitization', () => {
  const payload = {
    base: 'Line A\n\nLine B',
    ours: 'Line A\n\nLine B',
    theirs: 'Line A\n\nLine B',
    sceneId: 'scene-webview',
  }

  const LEGACY_MIN = PRECISION_THRESHOLD_CLAMP.legacy.min
  const BETA_MIN = PRECISION_THRESHOLD_CLAMP.beta.min
  const BETA_MAX = PRECISION_THRESHOLD_CLAMP.beta.max ?? Number.POSITIVE_INFINITY
  const STABLE_MIN = PRECISION_THRESHOLD_CLAMP.stable.min
  const STABLE_MAX = PRECISION_THRESHOLD_CLAMP.stable.max ?? Number.POSITIVE_INFINITY

  const scenarios: readonly ThresholdScenario[] = [
    {
      precision: 'legacy',
      requestThreshold: 0.5,
      readThreshold: 0.62,
      expectedThreshold: LEGACY_MIN,
      description: `clamps legacy request to minimum ${LEGACY_MIN.toFixed(2)}`,
    },
    {
      precision: 'legacy',
      requestThreshold: undefined,
      readThreshold: 0.6,
      expectedThreshold: LEGACY_MIN,
      description: `clamps legacy read fallback to minimum ${LEGACY_MIN.toFixed(2)}`,
    },
    {
      precision: 'beta',
      requestThreshold: 0.95,
      readThreshold: 0.7,
      expectedThreshold: BETA_MAX,
      description: `clamps beta request to slider max ${BETA_MAX.toFixed(2)}`,
    },
    {
      precision: 'beta',
      requestThreshold: undefined,
      readThreshold: 0.67,
      expectedThreshold: BETA_MIN,
      description: `clamps beta fallback to slider min ${BETA_MIN.toFixed(2)}`,
    },
    {
      precision: 'stable',
      requestThreshold: 0.96,
      readThreshold: 0.92,
      expectedThreshold: STABLE_MAX,
      description: `clamps stable request to slider max ${STABLE_MAX.toFixed(2)}`,
    },
    {
      precision: 'stable',
      requestThreshold: undefined,
      readThreshold: 0.65,
      expectedThreshold: STABLE_MIN,
      description: `clamps stable fallback to slider min ${STABLE_MIN.toFixed(2)}`,
    },
  ]

  for (const scenario of scenarios) {
    it(`applies ${scenario.description}`, async () => {
      const bridge = createVsCodeMergeBridge({
        engine: DEFAULT_MERGE_ENGINE,
        resolvePrecision: () => scenario.precision,
        readThreshold: () => scenario.readThreshold,
      })

      const response = await bridge.handleMergeRequest({
        type: 'merge.request',
        apiVersion: 1,
        reqId: `${scenario.precision}-${scenario.description}`,
        payload: {
          ...payload,
          threshold: scenario.requestThreshold,
        },
      })

      assert.equal(response.ok, true, 'merge bridge should respond with ok=true')
      assert.ok(response.trace, 'trace must be present for threshold assertions')
      assert.equal(
        response.trace.summary.threshold,
        scenario.expectedThreshold,
        'trace.summary.threshold should match sanitized precision clamp',
      )
      assert.equal(
        response.result?.trace.summary.threshold,
        scenario.expectedThreshold,
        'result.trace.summary.threshold should match sanitized precision clamp',
      )
    })
  }
})
