import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DEFAULT_MERGE_ENGINE, type MergePrecision } from '../../src/lib/merge'
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

  const scenarios: readonly ThresholdScenario[] = [
    {
      precision: 'legacy',
      requestThreshold: 0.5,
      readThreshold: 0.62,
      expectedThreshold: 0.65,
      description: 'clamps legacy request to minimum 0.65',
    },
    {
      precision: 'legacy',
      requestThreshold: undefined,
      readThreshold: 0.6,
      expectedThreshold: 0.65,
      description: 'clamps legacy read fallback to minimum 0.65',
    },
    {
      precision: 'beta',
      requestThreshold: 0.95,
      readThreshold: 0.7,
      expectedThreshold: 0.9,
      description: 'clamps beta request to slider max 0.9',
    },
    {
      precision: 'beta',
      requestThreshold: undefined,
      readThreshold: 0.67,
      expectedThreshold: 0.68,
      description: 'clamps beta fallback to slider min 0.68',
    },
    {
      precision: 'stable',
      requestThreshold: 0.96,
      readThreshold: 0.92,
      expectedThreshold: 0.94,
      description: 'clamps stable request to slider max 0.94',
    },
    {
      precision: 'stable',
      requestThreshold: undefined,
      readThreshold: 0.65,
      expectedThreshold: 0.7,
      description: 'clamps stable fallback to slider min 0.7',
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
