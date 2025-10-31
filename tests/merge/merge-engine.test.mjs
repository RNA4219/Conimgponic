import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_MERGE_ENGINE, MergeError } from '../../src/lib/merge.ts'

test('MG-U-04: abort signal preempts merge execution and surfaces MergeError contract', async (t) => {
  const input = {
    base: 'Base content',
    ours: 'Manual content',
    theirs: 'AI content',
    sceneId: 'scene-merge-abort',
  }

  const createOptions = (signal) => {
    const published = []
    const queued = []
    return {
      options: {
        abortSignal: signal,
        events: {
          publish: (event) => published.push(event),
          subscribe: () => () => undefined,
        },
        queueMergeCommand: (command) => queued.push(command),
      },
      published,
      queued,
    }
  }

  await t.test('abort() cancels merge without queueing AutoSave commands', async () => {
    const controller = new AbortController()
    controller.abort()
    const reason = controller.signal.reason
    const { options, published, queued } = createOptions(controller.signal)

    await assert.rejects(async () => {
      DEFAULT_MERGE_ENGINE.merge3(input, options)
    }, (error) => {
      assert.ok(error instanceof MergeError)
      assert.equal(error.name, 'MergeError')
      assert.equal(error.code, 'aborted')
      assert.equal(error.retryable, false)
      assert.equal(error.cause, reason)
      return true
    })

    assert.equal(published.length, 0)
    assert.equal(queued.length, 0)
  })

  await t.test("abort('timeout') marks merge as retryable timeout", async () => {
    const controller = new AbortController()
    controller.abort('timeout')
    const reason = controller.signal.reason
    const { options, published, queued } = createOptions(controller.signal)

    await assert.rejects(async () => {
      DEFAULT_MERGE_ENGINE.merge3(input, options)
    }, (error) => {
      assert.ok(error instanceof MergeError)
      assert.equal(error.name, 'MergeError')
      assert.equal(error.code, 'timeout')
      assert.equal(error.retryable, true)
      assert.equal(error.cause, reason)
      return true
    })

    assert.equal(published.length, 0)
    assert.equal(queued.length, 0)
  })
})

test('MG-U-05: rerun keeps resolved result stable', () => {
  const originalPrecision = process.env.MERGE_PRECISION
  process.env.MERGE_PRECISION = 'legacy'

  try {
    const toStoryboardText = (storyboard) => {
      const header = JSON.stringify({ projectId: storyboard.projectId }, null, 2)
      const scenes = JSON.stringify({ scenes: storyboard.scenes }, null, 2)
      return `${header}\n\n${scenes}`
    }

    const createEventHub = (sink) => {
      const listeners = new Set()
      return {
        publish(event) {
          sink.push(event)
          listeners.forEach((listener) => listener(event))
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    }

    const createScoringQueue = (values) => {
      const queue = values.map((score) => ({ ...score }))
      return () => {
        const next = queue.shift()
        return next ?? values[values.length - 1] ?? { jaccard: 0.95, cosine: 0.95, blended: 0.95 }
      }
    }

    const normalizePlan = (plan) => {
      if (!plan) return plan
      return {
        ...plan,
        stats: { ...plan.stats, processingMillis: 0 },
      }
    }

    const baseStoryboard = {
      // AutoSave 計画と共有する MockStoryboard【tests/autosave/TEST_PLAN.md】
      projectId: 'mg-u-05-storyboard',
      scenes: [
        { id: 'intro', updatedAt: '2024-05-01T10:00:00Z', frames: 24 },
        { id: 'conflict', updatedAt: '2024-05-01T10:05:00Z', frames: 48 },
        { id: 'resolve', updatedAt: '2024-05-01T10:10:00Z', frames: 36 },
      ],
    }
    const manualStoryboard = {
      ...baseStoryboard,
      scenes: baseStoryboard.scenes.map((scene) =>
        scene.id === 'conflict'
          ? { ...scene, updatedAt: '2024-05-01T10:07:00Z', frames: 60 }
          : scene,
      ),
    }

    const baseText = toStoryboardText(baseStoryboard)
    const oursText = toStoryboardText(manualStoryboard)
    const theirsText = baseText
    const sceneId = 'scene-mg-u-05'

    const conflictTelemetry = []
    const conflictEvents = []
    const conflictHub = createEventHub(conflictEvents)
    const conflictResult = DEFAULT_MERGE_ENGINE.merge3(
      { base: baseText, ours: oursText, theirs: theirsText, sceneId },
      {
        events: conflictHub,
        telemetry: (event) => conflictTelemetry.push(event),
        scoring: createScoringQueue([
          { jaccard: 0.98, cosine: 0.98, blended: 0.98 },
          { jaccard: 0.2, cosine: 0.2, blended: 0.2 },
        ]),
      },
    )

    assert.equal(conflictResult.stats.conflictDecisions, 1)
    const conflictHunk = conflictResult.hunks.find((hunk) => hunk.decision === 'conflict')
    assert.ok(conflictHunk)

    const resolvedOurs = conflictResult.mergedText.replace(conflictHunk.merged, conflictHunk.manual)
    const resolvedInput = { base: baseText, ours: resolvedOurs, theirs: theirsText, sceneId }
    const resolvedScoreSequence = [
      { jaccard: 0.98, cosine: 0.98, blended: 0.98 },
      { jaccard: 0.95, cosine: 0.95, blended: 0.95 },
    ]

    const runResolvedMerge = (eventSink, telemetrySink) =>
      DEFAULT_MERGE_ENGINE.merge3(resolvedInput, {
        events: createEventHub(eventSink),
        telemetry: (event) => telemetrySink.push(event),
        scoring: createScoringQueue(resolvedScoreSequence),
      })

    const resolvedEventsFirst = []
    const resolvedTelemetryFirst = []
    const firstResolvedResult = runResolvedMerge(resolvedEventsFirst, resolvedTelemetryFirst)
    assert.equal(firstResolvedResult.stats.conflictDecisions, 0)

    const resolvedEventsSecond = []
    const resolvedTelemetrySecond = []
    const secondResolvedResult = runResolvedMerge(resolvedEventsSecond, resolvedTelemetrySecond)
    assert.equal(secondResolvedResult.stats.conflictDecisions, 0)

    assert.deepEqual(secondResolvedResult.hunks, firstResolvedResult.hunks)
    assert.deepEqual(
      normalizePlan(secondResolvedResult.plan),
      normalizePlan(firstResolvedResult.plan),
    )
    assert.deepEqual(
      secondResolvedResult.trace.summary.threshold,
      firstResolvedResult.trace.summary.threshold,
    )

    assert.ok(resolvedEventsFirst.every((event) => event.type !== 'merge:conflict-detected'))
    assert.ok(resolvedEventsSecond.every((event) => event.type !== 'merge:conflict-detected'))
    const expectedTelemetryTypes = ['merge:start', 'merge:hunk-decision', 'merge:hunk-decision', 'merge:finish']
    assert.deepEqual(
      resolvedTelemetryFirst.map((event) => event.type),
      expectedTelemetryTypes,
    )
    assert.deepEqual(
      resolvedTelemetrySecond.map((event) => event.type),
      expectedTelemetryTypes,
    )
  } finally {
    process.env.MERGE_PRECISION = originalPrecision
  }
})
