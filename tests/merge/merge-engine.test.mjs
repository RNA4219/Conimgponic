import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_MERGE_ENGINE, MergeError } from '../../src/lib/merge.ts'
import {
  attachAutoSaveLockEvents,
  buildMergePlan,
  createQueueMergeCommand,
} from '../../src/lib/merge/index.ts'
import { projectLockEvents } from '../../src/lib/locks.ts'

test('MG-U-02: conflict emits non-retryable event', () => {
  const sharedText = 'ΔΞΠΩΛΨΦΘΚΓΔΞΠΩΛΨΦΘΚΓΔΞΠΩΛΨΦΘΚΓ'
  const manualText = 'manualdraftzetaspectraltrajectorymanualdraftzetaspectraltrajectory'
  const input = {
    base: sharedText,
    ours: manualText,
    theirs: sharedText,
    sceneId: 'scene-mg-u-02',
  }

  const publishedEvents = []
  const events = {
    publish: (event) => {
      publishedEvents.push(event)
    },
    subscribe: () => () => undefined,
  }

  const telemetryEvents = []
  const result = DEFAULT_MERGE_ENGINE.merge3(input, {
    profile: { precision: 'beta' },
    events,
    telemetry: (event) => telemetryEvents.push(event),
  })

  const conflictEvents = publishedEvents.filter((event) => event.type === 'merge:conflict-detected')
  assert.equal(conflictEvents.length, 1)
  const [conflictEvent] = conflictEvents

  assert.equal(result.stats.conflictDecisions, 1)
  assert.equal(result.stats.autoDecisions, 0)

  const betaProfile = DEFAULT_MERGE_ENGINE.resolveProfile({ precision: 'beta' })
  assert.equal(result.trace.summary.threshold, betaProfile.threshold)
  assert.ok(result.trace.entries.some((entry) => entry.stage === 'decide'))

  assert.equal(conflictEvent.retryable, false)
  assert.equal(conflictEvent.hunk.manual, manualText)
})

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
    const traceStages = []
    return {
      options: {
        abortSignal: signal,
        events: {
          publish: (event) => {
            published.push(event)
            traceStages.push(event.trace.entries.map((entry) => entry.stage))
          },
          subscribe: () => () => undefined,
        },
        queueMergeCommand: (command) => queued.push(command),
      },
      published,
      queued,
      traceStages,
    }
  }

  const waitForAbort = async (signal) => {
    if (signal.aborted) {
      return
    }
    await new Promise((resolve) => {
      signal.addEventListener('abort', resolve, { once: true })
    })
  }

  const runScenario = async ({ signal, expectedCode }) => {
    await waitForAbort(signal)
    const { options, published, queued, traceStages } = createOptions(signal)
    const expectedReason = signal.reason

    await assert.rejects(async () => {
      DEFAULT_MERGE_ENGINE.merge3(input, options)
    }, (error) => {
      assert.ok(error instanceof MergeError)
      assert.equal(error.name, 'MergeError')
      assert.equal(error.code, expectedCode)
      assert.equal(error.retryable, false)
      assert.strictEqual(error.cause, expectedReason)
      return true
    })

    assert.equal(queued.length, 0)
    assert.equal(published.length, 0)
    assert.ok(traceStages.every((stages) => !stages.includes('queue')))
    assert.equal(traceStages.length, 0)
  }

  await t.test('AbortController abort() cancels merge without queueing AutoSave commands', async () => {
    const controller = new AbortController()
    controller.abort()
    await runScenario({ signal: controller.signal, expectedCode: 'aborted' })
  })

  await t.test('AbortSignal.timeout() surfaces non-retryable timeout error', async () => {
    const signal = AbortSignal.timeout(1)
    await runScenario({ signal, expectedCode: 'timeout' })
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

test('MG-U-06: split modules keep event, queue, and plan contracts', () => {
  const createEventHub = (sink) => {
    const listeners = new Set()
    return {
      publish(event) {
        sink.push(event)
        for (const listener of listeners) {
          listener(event)
        }
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
  }

  const autosaveEvents = []
  const detachAutoSave = attachAutoSaveLockEvents(createEventHub(autosaveEvents))

  const lease = {
    leaseId: 'lease-mg-u-06',
    ownerId: 'owner-mg-u-06',
    strategy: 'web-lock',
    viaFallback: false,
    resource: 'imgponic:project',
    acquiredAt: 0,
    expiresAt: 1,
    ttlMillis: 1,
    heartbeatIntervalMs: 1,
    nextHeartbeatAt: 1,
    renewAttempt: 0,
  }

  projectLockEvents.emit({ type: 'lock:acquired', lease })
  projectLockEvents.emit({ type: 'lock:released', leaseId: lease.leaseId })
  detachAutoSave?.()

  const mergeEvents = []
  const queue = []
  const eventHub = createEventHub(mergeEvents)

  const input = {
    base: 'Alpha base section\n\nBeta base section',
    ours: 'Alpha manual section\n\nBeta manual section',
    theirs: 'Alpha ai section\n\nBeta ai section',
    sceneId: 'scene-mg-u-06',
  }

  const scoringSequence = [
    { jaccard: 0.99, cosine: 0.99, blended: 0.99 },
    { jaccard: 0.15, cosine: 0.15, blended: 0.15 },
  ]
  let scoringIndex = 0

  const scoring = () => {
    const current = scoringSequence[Math.min(scoringIndex, scoringSequence.length - 1)]
    scoringIndex += 1
    return current
  }

  const overrides = { precision: 'legacy', threshold: 0.8 }
  const profile = DEFAULT_MERGE_ENGINE.resolveProfile(overrides)

  const result = DEFAULT_MERGE_ENGINE.merge3(input, {
    events: eventHub,
    scoring: () => scoring(),
    queueMergeCommand: (command) => queue.push(command),
    profile: overrides,
  })

  assert.ok(result.plan)
  assert.equal(queue.length, 1)

  const expectedPlan = buildMergePlan(result.hunks, result.stats, profile, input.sceneId)
  assert.equal(expectedPlan.kind, 'ok')
  assert.deepEqual(result.plan, expectedPlan.plan)
  assert.deepEqual(queue[0], createQueueMergeCommand(result.plan))

  const eventTypes = mergeEvents.map((event) => event.type)
  assert.ok(eventTypes.includes('merge:auto-applied'))
  assert.ok(eventTypes.includes('merge:conflict-detected'))

  const autosaveStages = autosaveEvents.map((event) => event.stage)
  assert.deepEqual(autosaveStages, ['acquired', 'released'])
})
