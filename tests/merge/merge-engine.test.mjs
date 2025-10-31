import { register } from 'node:module'
await register(new URL('./ts-loader.mjs', import.meta.url).href, import.meta.url)

import test from 'node:test'
import assert from 'node:assert/strict'

const { DEFAULT_MERGE_ENGINE, DEFAULT_MERGE_PROFILE, PRECISION_THRESHOLD_CLAMP } = await import('../../src/lib/merge.ts')
const { projectLockEvents } = await import('../../src/lib/locks.ts')
const { createVsCodeMergeBridge } = await import('../../src/platform/vscode/merge/bridge.ts')

const collectorLockEvent = (stage, lease) => ({
  feature: 'merge.autosave',
  event: 'autosave.lock',
  stage,
  lease: {
    id: lease.leaseId,
    owner: lease.ownerId,
    strategy: lease.strategy,
    via_fallback: lease.viaFallback,
    resource: lease.resource,
  },
})

const expectCollectorLockEvents = (events, lease) => {
  const lockEvents = events.filter((event) => event.event === 'autosave.lock')
  assert.deepEqual(lockEvents, [collectorLockEvent('acquired', lease), collectorLockEvent('released', lease)])
}

function runMerge(input, options) {
  return DEFAULT_MERGE_ENGINE.merge3(input, options)
}

test('legacy precision with identical ours/theirs resolves all sections automatically', () => {
  const originalPrecision = process.env.MERGE_PRECISION
  process.env.MERGE_PRECISION = 'legacy'

  const input = {
    base: 'Line A\n\nLine B',
    ours: 'Line A\n\nLine B',
    theirs: 'Line A\n\nLine B',
    sceneId: 'scene-auto',
  }

  const result = runMerge(input, { profile: { threshold: 0.6 } })

  assert.equal(result.hunks.length, 2)
  result.hunks.forEach((hunk) => {
    assert.equal(hunk.decision, 'auto')
    assert.equal(hunk.similarity, 1)
  })
  assert.equal(result.stats.autoDecisions, result.hunks.length)
  assert.equal(result.stats.conflictDecisions, 0)

  process.env.MERGE_PRECISION = originalPrecision
})

test('beta precision marks low-similarity section as conflict and emits event', () => {
  const originalPrecision = process.env.MERGE_PRECISION
  process.env.MERGE_PRECISION = 'beta'

  const published = []
  const input = {
    base: 'Shared intro\n\nCommon body',
    ours: 'Shared intro\n\nManual body update',
    theirs: 'Shared intro\n\nAI alternative conclusion',
    sceneId: 'scene-conflict',
  }

  const result = runMerge(input, {
    events: {
      publish: (event) => published.push(event),
      subscribe: () => () => undefined,
    },
  })

  assert.equal(result.hunks.length, 2)
  const conflictHunks = result.hunks.filter((h) => h.decision === 'conflict')
  assert.equal(conflictHunks.length, 1)
  assert.equal(conflictHunks[0]?.section, 'section-2')
  assert.equal(result.stats.conflictDecisions, 1)
  assert.ok(published.some((event) => event.type === 'merge:conflict-detected'))

  process.env.MERGE_PRECISION = originalPrecision
})

test('locks force conflict decision regardless of similarity', () => {
  const originalPrecision = process.env.MERGE_PRECISION
  process.env.MERGE_PRECISION = 'stable'

  const lockMap = new Map([['section-1', 'manual']])
  const input = {
    base: 'Intro text',
    ours: 'Intro text',
    theirs: 'Intro text',
    locks: lockMap,
    sceneId: 'scene-lock',
  }

  const result = runMerge(input)
  assert.equal(result.hunks.length, 1)
  const [hunk] = result.hunks
  assert.equal(hunk.decision, 'conflict')
  assert.equal(hunk.prefer, 'manual')
  assert.equal(result.stats.lockedDecisions, 1)

  assert.ok(result.plan)
  assert.equal(result.plan?.precision, 'stable')
  assert.equal(result.plan?.entries[0]?.recommendedCommand, 'queue:force-lock-resolution')
  assert.ok(result.plan?.phaseB.reasons.includes('locked-conflict'))

  process.env.MERGE_PRECISION = originalPrecision
})

test('descriptor preferred AI content is applied on auto decision', () => {
  const originalPrecision = process.env.MERGE_PRECISION
  process.env.MERGE_PRECISION = 'legacy'

  const input = {
    base: 'Shared intro',
    ours: 'Manual version',
    theirs: 'AI version',
    sections: ['section-1'],
    sectionDescriptors: [
      {
        id: 'section-1',
        label: 'section-1',
        range: [0, 11],
        preferred: 'ai',
      },
    ],
    sceneId: 'scene-prefer-ai',
  }

  const result = runMerge(input, {
    scoring: () => ({ jaccard: 0.95, cosine: 0.95, blended: 0.95 }),
    profile: { threshold: 0.6 },
  })

  const [hunk] = result.hunks
  assert.equal(hunk.decision, 'auto')
  assert.equal(hunk.prefer, 'ai')
  assert.equal(hunk.merged, 'AI version')

  process.env.MERGE_PRECISION = originalPrecision
})

test('telemetry sink receives ordered lifecycle events with processing stats', () => {
  const originalPrecision = process.env.MERGE_PRECISION
  process.env.MERGE_PRECISION = 'legacy'

  const telemetryCalls = []
  const input = {
    base: 'A',
    ours: 'A',
    theirs: 'A',
    sceneId: 'scene-telemetry',
  }

  const result = runMerge(input, {
    telemetry: (event) => {
      telemetryCalls.push(event.type)
      if (event.type === 'merge:finish') {
        assert.ok(event.stats)
        assert.ok((event.stats?.processingMillis ?? 0) >= 0)
      }
    },
  })

  assert.deepEqual(telemetryCalls, ['merge:start', 'merge:hunk-decision', 'merge:finish'])
  assert.ok(result.stats.processingMillis >= 0)

  process.env.MERGE_PRECISION = originalPrecision
})

test('merge plan classifies sections by precision thresholds', () => {
  const originalPrecision = process.env.MERGE_PRECISION
  process.env.MERGE_PRECISION = 'legacy'

  const metrics = [
    { jaccard: 0.95, cosine: 0.95, blended: 0.95 },
    { jaccard: 0.95, cosine: 0.95, blended: 0.95 },
  ]

  const legacyResult = runMerge(
    { base: 'A\n\nB', ours: 'A\n\nB', theirs: 'A\n\nB', sceneId: 'scene-plan-legacy' },
    {
      scoring: () => metrics.shift() ?? { jaccard: 0.9, cosine: 0.9, blended: 0.9 },
      profile: { threshold: 0.6 },
    },
  )

  assert.ok(legacyResult.plan)
  legacyResult.plan?.entries.forEach((entry) => {
    assert.equal(entry.phase, 'phase-a')
    assert.equal(entry.recommendedCommand, 'queue:auto-apply')
    assert.equal(entry.band, 'auto')
  })
  assert.equal(legacyResult.plan?.phaseB.required, false)

  process.env.MERGE_PRECISION = 'beta'

  const betaScores = [
    { jaccard: 0.9, cosine: 0.9, blended: 0.9 },
    { jaccard: 0.79, cosine: 0.79, blended: 0.79 },
  ]

  const betaResult = runMerge(
    { base: 'Intro\n\nBody', ours: 'Intro\n\nManual', theirs: 'Intro\n\nAI', sceneId: 'scene-plan-beta' },
    {
      scoring: () => betaScores.shift() ?? { jaccard: 0.7, cosine: 0.7, blended: 0.7 },
    },
  )

  assert.ok(betaResult.plan)
  assert.equal(betaResult.plan?.precision, 'beta')
  const betaReview = betaResult.plan?.entries.find((entry) => entry.band === 'review')
  assert.ok(betaReview)
  assert.equal(betaReview?.phase, 'phase-b')
  assert.equal(betaReview?.recommendedCommand, 'queue:request-review')
  assert.ok(betaResult.plan?.phaseB.required)
  assert.ok(betaResult.plan?.phaseB.reasons.includes('review-band'))

  process.env.MERGE_PRECISION = 'stable'

  const stableScores = [
    { jaccard: 0.95, cosine: 0.95, blended: 0.95 },
    { jaccard: 0.6, cosine: 0.6, blended: 0.6 },
  ]

  const stableResult = runMerge(
    { base: 'One\n\nTwo', ours: 'One\n\nManual', theirs: 'One\n\nAI', sceneId: 'scene-plan-stable' },
    {
      scoring: () => stableScores.shift() ?? { jaccard: 0.5, cosine: 0.5, blended: 0.5 },
    },
  )

  assert.ok(stableResult.plan)
  assert.equal(stableResult.plan?.precision, 'stable')
  const lowSimilarity = stableResult.plan?.entries.find((entry) => entry.band === 'conflict')
  assert.ok(lowSimilarity)
  assert.equal(lowSimilarity?.recommendedCommand, 'queue:manual-intervention')
  assert.equal(lowSimilarity?.phase, 'phase-b')
  assert.ok(stableResult.plan?.phaseB.reasons.includes('low-similarity'))

  process.env.MERGE_PRECISION = originalPrecision
})

test('MG-U-03: stable precision recalculates stats and plan bands when threshold changes', () => {
  const originalPrecision = process.env.MERGE_PRECISION
  process.env.MERGE_PRECISION = 'stable'

  const createScoring = (values) => {
    const queue = values.slice()
    const fallback = values[values.length - 1] ?? 0
    return () => {
      const value = queue.shift() ?? fallback
      return { jaccard: value, cosine: value, blended: value }
    }
  }

  const input = {
    base: 'Intro base\n\nBody base',
    ours: 'Intro manual\n\nBody manual',
    theirs: 'Intro ai\n\nBody ai',
    sceneId: 'scene-threshold-recalc',
  }

  const stableDefaultThreshold = Math.max(DEFAULT_MERGE_PROFILE.threshold, PRECISION_THRESHOLD_CLAMP.stable.min)
  const defaultResult = runMerge(input, { scoring: createScoring([0.9, 0.84]) })

  assert.ok(defaultResult.plan)
  assert.equal(defaultResult.trace.summary.threshold, stableDefaultThreshold)
  assert.equal(defaultResult.stats.autoDecisions, 1)
  assert.equal(defaultResult.stats.conflictDecisions, 1)
  assert.deepEqual(
    defaultResult.plan?.entries.map((entry) => ({ band: entry.band, phase: entry.phase })),
    [
      { band: 'auto', phase: 'phase-b' },
      { band: 'review', phase: 'phase-b' },
    ],
  )
  assert.deepEqual(defaultResult.plan?.phaseB, { required: true, reasons: ['review-band'] })

  const customThreshold = 0.9
  const overriddenResult = runMerge(input, {
    scoring: createScoring([0.9, 0.84]),
    profile: { threshold: customThreshold },
  })

  assert.ok(overriddenResult.plan)
  assert.equal(overriddenResult.trace.summary.threshold, customThreshold)
  assert.equal(overriddenResult.stats.autoDecisions, 0)
  assert.equal(overriddenResult.stats.conflictDecisions, 2)
  assert.deepEqual(
    overriddenResult.plan?.entries.map((entry) => ({ band: entry.band, phase: entry.phase })),
    [
      { band: 'review', phase: 'phase-b' },
      { band: 'conflict', phase: 'phase-b' },
    ],
  )
  assert.deepEqual(overriddenResult.plan?.phaseB.reasons.sort(), ['low-similarity', 'review-band'])

  process.env.MERGE_PRECISION = originalPrecision
})

test('MG-U-03: stats reset between runs when threshold overrides change bands', () => {
  const originalPrecision = process.env.MERGE_PRECISION
  process.env.MERGE_PRECISION = 'stable'

  const createScoring = () => {
    const values = [0.87, 0.83]
    const fallback = values[values.length - 1] ?? 0.83
    return () => {
      const value = values.shift() ?? fallback
      return { jaccard: value, cosine: value, blended: value }
    }
  }

  const input = {
    base: 'Intro base\n\nBody base',
    ours: 'Intro manual\n\nBody manual',
    theirs: 'Intro ai\n\nBody ai',
    sceneId: 'scene-threshold-stats-reset',
  }

  const defaultResult = runMerge(input, { scoring: createScoring() })

  assert.equal(defaultResult.stats.autoDecisions, 1)
  assert.equal(defaultResult.stats.conflictDecisions, 1)

  const overriddenThreshold = 0.9
  const overriddenResult = runMerge(input, {
    scoring: createScoring(),
    profile: { threshold: overriddenThreshold },
  })

  assert.equal(overriddenResult.trace.summary.threshold, overriddenThreshold)
  assert.equal(overriddenResult.stats.autoDecisions, 0)
  assert.equal(overriddenResult.stats.conflictDecisions, 2)

  process.env.MERGE_PRECISION = originalPrecision
})

test('MG-U-05: manual conflict resolution keeps initial artifacts stable across reruns', () => {
  const originalPrecision = process.env.MERGE_PRECISION
  process.env.MERGE_PRECISION = 'legacy'

  try {
    const toStoryboardText = (storyboard) => {
      const header = JSON.stringify({ projectId: storyboard.projectId }, null, 2)
      const scenes = JSON.stringify({ scenes: storyboard.scenes }, null, 2)
      return `${header}\n\n${scenes}`
    }

    const baseStoryboard = {
      projectId: 'mg-u-04-storyboard',
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

    const firstTelemetry = []
    const firstDecisionEvents = []
    const listeners = new Set()
    const firstEventHub = {
      publish(event) {
        firstDecisionEvents.push(event)
        listeners.forEach((listener) => listener(event))
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }

    const conflictScores = [
      { jaccard: 0.98, cosine: 0.98, blended: 0.98 },
      { jaccard: 0.2, cosine: 0.2, blended: 0.2 },
    ]

    const initialResult = runMerge(
      { base: baseText, ours: oursText, theirs: theirsText, sceneId: 'scene-mg-u-04' },
      {
        events: firstEventHub,
        telemetry: (event) => firstTelemetry.push(event),
        scoring: () => conflictScores.shift() ?? { jaccard: 0.2, cosine: 0.2, blended: 0.2 },
      },
    )

    assert.equal(initialResult.stats.conflictDecisions, 1)
    const conflictHunk = initialResult.hunks.find((hunk) => hunk.decision === 'conflict')
    assert.ok(conflictHunk)

    const initialSnapshots = {
      hunks: JSON.parse(JSON.stringify(initialResult.hunks)),
      plan: initialResult.plan ? JSON.parse(JSON.stringify(initialResult.plan)) : undefined,
      trace: JSON.parse(JSON.stringify(initialResult.trace)),
      telemetry: firstTelemetry.slice(),
      events: firstDecisionEvents.slice(),
    }

    const resolvedOurs = initialResult.mergedText

    const resolvedTelemetry = []
    const resolvedEvents = []
    const resolvedEventHub = {
      publish(event) {
        resolvedEvents.push(event)
      },
      subscribe() {
        return () => undefined
      },
    }

    const resolvedScores = [
      { jaccard: 0.98, cosine: 0.98, blended: 0.98 },
      { jaccard: 0.95, cosine: 0.95, blended: 0.95 },
    ]

    const resolvedResult = runMerge(
      { base: baseText, ours: resolvedOurs, theirs: theirsText, sceneId: 'scene-mg-u-04' },
      {
        events: resolvedEventHub,
        telemetry: (event) => resolvedTelemetry.push(event),
        scoring: () => resolvedScores.shift() ?? { jaccard: 0.95, cosine: 0.95, blended: 0.95 },
      },
    )

    assert.equal(resolvedResult.stats.conflictDecisions, 0)

    assert.deepEqual(initialResult.hunks, initialSnapshots.hunks)
    assert.deepEqual(initialResult.plan, initialSnapshots.plan)
    assert.deepEqual(initialResult.trace, initialSnapshots.trace)
    assert.deepEqual(firstTelemetry, initialSnapshots.telemetry)
    assert.deepEqual(firstDecisionEvents, initialSnapshots.events)

    assert.deepEqual(
      resolvedResult.hunks.map(({ id, section, base, ai }) => ({ id, section, base, ai })),
      initialResult.hunks.map(({ id, section, base, ai }) => ({ id, section, base, ai })),
    )

    assert.ok(resolvedEvents.every((event) => event.type !== 'merge:conflict-detected'))
    assert.deepEqual(
      resolvedTelemetry.map((event) => event.type),
      ['merge:start', 'merge:hunk-decision', 'merge:hunk-decision', 'merge:finish'],
    )
  } finally {
    process.env.MERGE_PRECISION = originalPrecision
  }
})

test('non-legacy precision halts queue when similarity underflows review band', () => {
  const originalPrecision = process.env.MERGE_PRECISION
  process.env.MERGE_PRECISION = 'stable'

  const lowScores = [
    { jaccard: 0.5, cosine: 0.5, blended: 0.5 },
  ]
  const queued = []

  const result = runMerge(
    { base: 'Intro', ours: 'Manual update', theirs: 'AI alternative', sceneId: 'scene-score-underflow' },
    {
      scoring: () => lowScores.shift() ?? { jaccard: 0.5, cosine: 0.5, blended: 0.5 },
      queueMergeCommand: (command) => queued.push(command),
    },
  )

  assert.equal(result.hunks.length, 1)
  assert.equal(result.hunks[0]?.decision, 'conflict')
  assert.equal(queued.length, 0)
  assert.equal(result.plan, undefined)

  const queueStage = result.trace.entries.find((entry) => entry.stage === 'queue')
  assert.ok(queueStage)
  assert.deepEqual(queueStage?.metadata, { error: 'score-underflow', retryable: true })

  process.env.MERGE_PRECISION = originalPrecision
})

test('stable precision publishes autosave lock integration events (MG-I-02)', () => {
  const originalPrecision = process.env.MERGE_PRECISION
  process.env.MERGE_PRECISION = 'stable'

  const scope = globalThis
  const originalCollector = scope.Day8Collector
  const collectorEvents = []
  scope.Day8Collector = {
    publish(event) {
      collectorEvents.push(event)
    },
  }

  const originalRunnerHost = scope.__AUTOSAVE_RUNNER_HOST__
  const runnerEvents = []
  scope.__AUTOSAVE_RUNNER_HOST__ = {
    ...(typeof originalRunnerHost === 'object' && originalRunnerHost !== null ? originalRunnerHost : {}),
    emit(event) {
      runnerEvents.push(event)
      if (originalRunnerHost && typeof originalRunnerHost === 'object') {
        const legacy = originalRunnerHost.emit
        if (typeof legacy === 'function') {
          legacy.call(originalRunnerHost, event)
        }
      }
    },
  }

  const published = []
  const listeners = new Set()
  const eventHub = {
    publish(event) {
      published.push(event)
      listeners.forEach((listener) => listener(event))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  const lease = {
    leaseId: 'lease-merge-autosave',
    ownerId: 'diff-merge',
    strategy: 'web-lock',
    viaFallback: false,
    resource: '/project.lock',
    acquiredAt: 100,
    expiresAt: 200,
    ttlMillis: 5000,
    nextHeartbeatAt: 150,
    renewAttempt: 0,
  }

  try {
    let emitted = false
    runMerge(
      { base: 'Alpha', ours: 'Alpha', theirs: 'Alpha', sceneId: 'scene-autosave-lock' },
      {
        events: eventHub,
        scoring: (input, profile) => {
          if (!emitted) {
            emitted = true
            projectLockEvents.emit({ type: 'lock:acquired', lease })
            projectLockEvents.emit({ type: 'lock:released', leaseId: lease.leaseId })
          }
          return DEFAULT_MERGE_ENGINE.score(input, profile)
        },
      },
    )

    const lockEvents = published.filter((event) => event.type === 'merge:autosave:lock')
    assert.deepEqual(lockEvents, [
      { type: 'merge:autosave:lock', stage: 'acquired', lease },
      { type: 'merge:autosave:lock', stage: 'released', lease },
    ])

    const autoLockEvents = runnerEvents.filter((event) => event.type === 'lock-acquired')
    const autoGcEvents = runnerEvents.filter((event) => event.type === 'gc-completed')
    assert.equal(autoLockEvents.length, 1)
    assert.equal(autoGcEvents.length, 1)
    assert.equal(autoLockEvents[0].payload?.lease?.leaseId, lease.leaseId)
    assert.equal(autoGcEvents[0].payload?.leaseId, lease.leaseId)
    assert.ok(autoLockEvents[0].at <= autoGcEvents[0].at)
    const mergeAcquired = lockEvents.filter((event) => event.stage === 'acquired')
    const mergeReleased = lockEvents.filter((event) => event.stage === 'released')
    assert.equal(autoLockEvents.length, mergeAcquired.length)
    assert.equal(autoGcEvents.length, mergeReleased.length)

    expectCollectorLockEvents(collectorEvents, lease)
  } finally {
    process.env.MERGE_PRECISION = originalPrecision
    if (originalCollector) {
      scope.Day8Collector = originalCollector
    } else {
      delete scope.Day8Collector
    }
    if (originalRunnerHost === undefined) {
      delete scope.__AUTOSAVE_RUNNER_HOST__
    } else {
      scope.__AUTOSAVE_RUNNER_HOST__ = originalRunnerHost
    }
  }
})

test('MG-I-02: collector receives AutoSave lock events without merge event hub', () => {
  const originalPrecision = process.env.MERGE_PRECISION
  process.env.MERGE_PRECISION = 'stable'

  const scope = globalThis
  const originalCollector = scope.Day8Collector
  const collectorEvents = []
  scope.Day8Collector = {
    publish(event) {
      collectorEvents.push(event)
    },
  }

  const lease = {
    leaseId: 'lease-collector-only',
    ownerId: 'collector-worker',
    strategy: 'file-lock',
    viaFallback: true,
    resource: 'project/.lock',
    acquiredAt: 1_000,
    expiresAt: 1_030,
    ttlMillis: 30_000,
    nextHeartbeatAt: 1_010,
    renewAttempt: 1,
  }

  try {
    let emitted = false
    runMerge(
      { base: 'Beta', ours: 'Beta', theirs: 'Beta', sceneId: 'scene-collector-only' },
      {
        scoring: (input, profile) => {
          if (!emitted) {
            emitted = true
            projectLockEvents.emit({ type: 'lock:acquired', lease })
            projectLockEvents.emit({ type: 'lock:released', leaseId: lease.leaseId })
          }
          return DEFAULT_MERGE_ENGINE.score(input, profile)
        },
      },
    )

    expectCollectorLockEvents(collectorEvents, lease)
  } finally {
    process.env.MERGE_PRECISION = originalPrecision
    if (originalCollector) {
      scope.Day8Collector = originalCollector
    } else {
      delete scope.Day8Collector
    }
  }
})

test('MG-I-02: VS Code bridge publishes AutoSave lock lifecycle events', async () => {
  const originalPrecision = process.env.MERGE_PRECISION
  process.env.MERGE_PRECISION = 'stable'

  const published = []
  const baseMerge3 = DEFAULT_MERGE_ENGINE.merge3
  const lease = {
    leaseId: 'lease-bridge-autosave',
    ownerId: 'bridge-worker',
    strategy: 'web-lock',
    viaFallback: false,
    resource: '/project.lock',
    acquiredAt: 10,
    expiresAt: 50,
    ttlMillis: 1000,
    nextHeartbeatAt: 25,
    renewAttempt: 0,
  }

  const bridge = createVsCodeMergeBridge({
    engine: {
      ...DEFAULT_MERGE_ENGINE,
      merge3(input, options) {
        assert.ok(options?.events)
        const unsubscribe = options.events.subscribe((event) => {
          published.push(event)
        })
        let emitted = false
        try {
          return baseMerge3(input, {
            ...options,
            events: options.events,
            scoring: (scoreInput, profile) => {
              if (!emitted) {
                emitted = true
                projectLockEvents.emit({ type: 'lock:acquired', lease })
                projectLockEvents.emit({ type: 'lock:released', leaseId: lease.leaseId })
              }
              return DEFAULT_MERGE_ENGINE.score(scoreInput, profile)
            },
          })
        } finally {
          unsubscribe()
        }
      },
    },
    resolvePrecision: () => 'stable',
    readThreshold: () => undefined,
  })

  try {
    const response = await bridge.handleMergeRequest({
      type: 'merge.request',
      apiVersion: 1,
      reqId: 'bridge-autosave',
      payload: {
        base: 'Alpha',
        ours: 'Alpha',
        theirs: 'Alpha',
        sceneId: 'scene-bridge-autosave',
      },
    })

    assert.equal(response.ok, true)
    const lockEvents = published.filter((event) => event.type === 'merge:autosave:lock')
    assert.deepEqual(lockEvents, [
      { type: 'merge:autosave:lock', stage: 'acquired', lease },
      { type: 'merge:autosave:lock', stage: 'released', lease },
    ])
  } finally {
    process.env.MERGE_PRECISION = originalPrecision
  }
})

test('MG-I-02: VS Code bridge emits AutoSave lock events when engine omits hub wiring', async () => {
  const originalPrecision = process.env.MERGE_PRECISION
  process.env.MERGE_PRECISION = 'stable'

  const scope = globalThis
  const originalCollector = scope.Day8Collector
  const collectorEvents = []
  scope.Day8Collector = { publish: (event) => collectorEvents.push(event) }

  const published = []
  const baseMerge3 = DEFAULT_MERGE_ENGINE.merge3
  const lease = {
    leaseId: 'lease-bridge-autosave-missing',
    ownerId: 'bridge-worker',
    strategy: 'web-lock',
    viaFallback: false,
    resource: '/project.lock',
    acquiredAt: 100,
    expiresAt: 200,
    ttlMillis: 5000,
    nextHeartbeatAt: 150,
    renewAttempt: 0,
  }

  const bridge = createVsCodeMergeBridge({
    engine: {
      ...DEFAULT_MERGE_ENGINE,
      merge3(input, options) {
        assert.ok(options?.events)
        const unsubscribe = options.events.subscribe((event) => published.push(event))
        let emitted = false
        try {
          return baseMerge3(input, {
            ...options,
            events: undefined,
            scoring: (scoreInput, profile) => {
              if (!emitted) {
                emitted = true
                projectLockEvents.emit({ type: 'lock:acquired', lease })
                projectLockEvents.emit({ type: 'lock:released', leaseId: lease.leaseId })
              }
              return DEFAULT_MERGE_ENGINE.score(scoreInput, profile)
            },
          })
        } finally {
          unsubscribe()
        }
      },
    },
    resolvePrecision: () => 'stable',
    readThreshold: () => undefined,
  })

  try {
    const response = await bridge.handleMergeRequest({
      type: 'merge.request',
      apiVersion: 1,
      reqId: 'bridge-autosave-missing',
      payload: {
        base: 'Alpha',
        ours: 'Alpha',
        theirs: 'Alpha',
        sceneId: 'scene-bridge-autosave-missing',
      },
    })

    assert.equal(response.ok, true)
    const lockEvents = published.filter((event) => event.type === 'merge:autosave:lock')
    assert.deepEqual(lockEvents, [
      { type: 'merge:autosave:lock', stage: 'acquired', lease },
      { type: 'merge:autosave:lock', stage: 'released', lease },
    ])
    expectCollectorLockEvents(collectorEvents, lease)
  } finally {
    process.env.MERGE_PRECISION = originalPrecision
    if (originalCollector) {
      scope.Day8Collector = originalCollector
    } else {
      delete scope.Day8Collector
    }
  }
})
