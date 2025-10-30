import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { useSB } from '../../src/store.ts'
import type { Storyboard } from '../../src/types.ts'

type StoreGlobal = typeof globalThis & { __conimgponic_sb_snapshot__?: Storyboard }

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

test('moveScene はスナップショットの配列参照を破壊しない', () => {
  const { addScene, moveScene } = useSB.getState()

  const ids = [addScene(), addScene(), addScene()]
  const stateBefore = useSB.getState()
  const snapshotScenes = (globalThis as StoreGlobal).__conimgponic_sb_snapshot__?.scenes ?? []

  moveScene(ids[0], 1)

  const { sb } = useSB.getState()

  assert.deepStrictEqual(
    sb.scenes.map(scene => scene.id),
    [ids[1], ids[0], ids[2]],
  )
  assert.notStrictEqual(sb.scenes, stateBefore.sb.scenes)
  assert.strictEqual(snapshotScenes, stateBefore.sb.scenes)
  assert.deepStrictEqual(
    snapshotScenes.map(scene => scene.id),
    ids,
  )
})
