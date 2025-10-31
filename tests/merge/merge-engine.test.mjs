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
