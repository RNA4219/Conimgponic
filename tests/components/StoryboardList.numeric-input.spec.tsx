import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Scene } from '../../src/types'
import { applyNumericFieldChange } from '../../src/components/StoryboardList'

describe('StoryboardList.numeric-input validation (RED)', () => {
  it('StoryboardList.numeric-input warns and clears seed when input is not a finite number', () => {
    const warnings: string[] = []
    const updateSceneCalls: Array<{ id: string; patch: Partial<Scene> }> = []

    applyNumericFieldChange({
      field: 'seed',
      rawValue: 'not-a-number',
      sceneId: 'scene-123',
      updateScene: (id, patch) => {
        updateSceneCalls.push({ id, patch })
      },
      warn: (message) => {
        warnings.push(message)
      },
    })

    assert.deepEqual(updateSceneCalls, [
      { id: 'scene-123', patch: { seed: undefined } },
    ])
    assert.deepEqual(warnings, [
      'StoryboardList: seed requires a finite number (received "not-a-number")',
    ])
  })
})
