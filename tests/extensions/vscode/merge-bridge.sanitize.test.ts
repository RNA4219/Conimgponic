/// <reference types="node" />
import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  MergeInput,
  MergePrecision,
  MergeResult,
  MergeTrace,
} from '../../../src/lib/merge.js'
import { createVsCodeMergeBridge } from '../../../src/platform/vscode/merge/bridge.js'

type MergeInvocation = {
  readonly input: MergeInput
  readonly profilePrecision: MergePrecision | undefined
  readonly profileThreshold: number | undefined
}

const createTrace = (threshold: number): MergeTrace => ({
  sceneId: 'scene-1',
  entries: [],
  decisions: [],
  summary: { threshold, autoAdoptionRate: 0 },
})

test('createVsCodeMergeBridge sanitizes request threshold before invoking merge engine', async () => {
  const invocations: MergeInvocation[] = []
  const mergeResult: MergeResult = {
    hunks: [],
    mergedText: 'merged',
    stats: {
      autoDecisions: 0,
      conflictDecisions: 0,
      averageSimilarity: 0,
      processingMillis: 0,
      lockedDecisions: 0,
      aiDecisions: 0,
    },
    trace: createTrace(0.7),
  }

  const bridge = createVsCodeMergeBridge({
    engine: {
      merge3(input, options) {
        invocations.push({
          input,
          profilePrecision: options?.profile?.precision,
          profileThreshold: options?.profile?.threshold,
        })
        return mergeResult
      },
      resolveProfile() {
        throw new Error('not implemented in test')
      },
      score() {
        return { jaccard: 0, cosine: 0, blended: 0 }
      },
    },
    resolvePrecision: () => 'stable',
    readThreshold: () => 0.8,
  })

  const response = await bridge.handleMergeRequest({
    type: 'merge.request',
    apiVersion: 1,
    reqId: 'req-001',
    payload: {
      base: 'base',
      ours: 'ours',
      theirs: 'theirs',
      threshold: 1.2,
    },
  })

  assert.equal(invocations.length, 1)
  const [{ profilePrecision, profileThreshold }] = invocations
  assert.equal(profilePrecision, 'stable')
  assert.equal(profileThreshold, 0.94)

  assert.deepEqual(response, {
    type: 'merge.result',
    apiVersion: 1,
    reqId: 'req-001',
    ok: true,
    result: mergeResult,
    trace: mergeResult.trace,
  })
})
