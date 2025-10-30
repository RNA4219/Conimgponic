import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Scene } from '../../src/types'
import { applyNumericFieldChange } from '../../src/components/StoryboardList'

describe('StoryboardList.numeric-input validation (RED)', () => {
  it('非数値入力時は updateScene を呼ばず旧値を保持する (seed)', () => {
    const warnings: string[] = []
    let currentScene: Pick<Scene, 'seed'> = { seed: 123 }
    let updateSceneCalls = 0

    applyNumericFieldChange({
      field: 'seed',
      rawValue: 'not-a-number',
      sceneId: 'scene-123',
      updateScene: (_id, patch) => {
        updateSceneCalls += 1
        currentScene = { ...currentScene, ...patch }
      },
      warn: (message) => {
        warnings.push(message)
      },
    })

    assert.equal(updateSceneCalls, 0)
    assert.equal(currentScene.seed, 123)
    assert.deepEqual(warnings, [
      'StoryboardList: seed requires a finite number (received "not-a-number"); preserving previous value',
    ])
  })

  it('非数値入力時は updateScene を呼ばず旧値を保持する (take)', () => {
    const warnings: string[] = []
    let currentScene: Pick<Scene, 'take'> = { take: 5 }
    let updateSceneCalls = 0

    applyNumericFieldChange({
      field: 'take',
      rawValue: 'NaN',
      sceneId: 'scene-456',
      updateScene: (_id, patch) => {
        updateSceneCalls += 1
        currentScene = { ...currentScene, ...patch }
      },
      warn: (message) => {
        warnings.push(message)
      },
    })

    assert.equal(updateSceneCalls, 0)
    assert.equal(currentScene.take, 5)
    assert.deepEqual(warnings, [
      'StoryboardList: take requires a finite number (received "NaN"); preserving previous value',
    ])
  })
})
