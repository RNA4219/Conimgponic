import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { useSB } from '../../src/store.ts'

const initialState = structuredClone(useSB.getState().sb)

beforeEach(() => {
  useSB.setState({ sb: structuredClone(initialState) })
})

test('addScene でシーン数と返却 ID が更新される', () => {
  const { addScene } = useSB.getState()

  const id = addScene()
  const { sb } = useSB.getState()

  assert.strictEqual(sb.scenes.length, 1)
  assert.strictEqual(sb.scenes[0]?.id, id)
})

test('removeScene で該当シーンが除去される', () => {
  const { addScene, removeScene } = useSB.getState()

  const id1 = addScene()
  const id2 = addScene()

  removeScene(id1)
  const { sb } = useSB.getState()

  assert.strictEqual(sb.scenes.length, 1)
  assert.strictEqual(sb.scenes[0]?.id, id2)
})
