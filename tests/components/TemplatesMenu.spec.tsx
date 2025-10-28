import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { builtinTemplates, type Template } from '../../src/lib/templates'
import {
  appendTemplateWithRollback,
  synchronizeTemplatesList,
  USER_TEMPLATES_STORAGE_PATH,
} from '../../src/components/TemplatesMenu'

describe('TemplatesMenu OPFS exception handling (RED)', () => {
  it('alerts and keeps templates list when loadJSON throws', async () => {
    const alerts: string[] = []
    const consoleErrors: unknown[][] = []
    const appliedLists: Template[][] = []
    const failure = new Error('opfs-load-error')

    await synchronizeTemplatesList({
      loadJSONImpl: async () => {
        throw failure
      },
      alertImpl: (message) => {
        alerts.push(message)
      },
      consoleErrorImpl: (...args) => {
        consoleErrors.push(args)
      },
      apply: (next) => {
        appliedLists.push(next)
      },
    })

    assert.deepEqual(appliedLists, [])
    assert.deepEqual(alerts, ['テンプレートの読み込みに失敗しました'])
    assert.equal(consoleErrors.length, 1)
    assert.equal(
      consoleErrors[0][0],
      'TemplatesMenu: failed to load templates from OPFS'
    )
    assert.equal(consoleErrors[0][1], failure)
  })

  it('alerts, logs, and rolls back to previous list when saveJSON throws', async () => {
    const alerts: string[] = []
    const consoleErrors: unknown[][] = []
    const failure = new Error('opfs-save-error')
    const previousList = [...builtinTemplates]
    let currentList = previousList
    const appliedLists: Template[][] = []

    await appendTemplateWithRollback({
      loadJSONImpl: async () => [],
      saveJSONImpl: async (path, data) => {
        assert.equal(path, USER_TEMPLATES_STORAGE_PATH)
        assert.deepEqual(data, [{ id: 'user-test', name: 'test', text: 'body' }])
        throw failure
      },
      alertImpl: (message) => {
        alerts.push(message)
      },
      consoleErrorImpl: (...args) => {
        consoleErrors.push(args)
      },
      template: { id: 'user-test', name: 'test', text: 'body' },
      apply: (next) => {
        currentList = next
        appliedLists.push(next)
      },
      rollback: () => {
        currentList = previousList
      },
    })

    assert.deepEqual(appliedLists, [])
    assert.deepEqual(currentList, previousList)
    assert.deepEqual(alerts, ['テンプレートの保存に失敗しました'])
    assert.equal(consoleErrors.length, 1)
    assert.equal(
      consoleErrors[0][0],
      'TemplatesMenu: failed to save templates to OPFS'
    )
    assert.equal(consoleErrors[0][1], failure)
  })
})
