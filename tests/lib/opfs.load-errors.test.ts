import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { loadJSON, loadText } from '../../src/lib/opfs'
import { handleToolbarLoadProject } from '../../src/App'
import { synchronizeTemplatesList, USER_TEMPLATES_STORAGE_PATH } from '../../src/components/TemplatesMenu'
import type { Storyboard } from '../../src/types'
import type { Template } from '../../src/lib/templates'

const unsupportedOpfsNavigator = { storage: {} } as const

const installUnsupportedOpfs = () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: unsupportedOpfsNavigator,
    configurable: true,
    writable: false,
  })
}

const uninstallNavigator = () => {
  if ('navigator' in globalThis) {
    Reflect.deleteProperty(globalThis as Record<string, unknown>, 'navigator')
  }
}

describe('opfs load error propagation (RED)', () => {
  beforeEach(() => {
    installUnsupportedOpfs()
  })

  afterEach(() => {
    uninstallNavigator()
  })

  it('rethrows from loadText when OPFS is unsupported', async () => {
    await assert.rejects(
      () => loadText('project/storyboard.json'),
      (error: unknown) => error instanceof Error && error.message === 'OPFS not supported in this browser'
    )
  })

  it('rethrows from loadJSON when OPFS is unsupported', async () => {
    await assert.rejects(
      () => loadJSON<Template[]>(USER_TEMPLATES_STORAGE_PATH),
      (error: unknown) => error instanceof Error && error.message === 'OPFS not supported in this browser'
    )
  })

  it('alerts and logs when toolbar load fails due to unsupported OPFS', async () => {
    const alerts: string[] = []
    const consoleErrors: unknown[][] = []
    let appliedStoryboard = false

    await handleToolbarLoadProject({
      load: (path) => loadJSON<Storyboard>(path),
      applyStoryboard: () => {
        appliedStoryboard = true
      },
      alert: (message) => {
        alerts.push(message)
      },
      consoleError: (...args) => {
        consoleErrors.push(args)
      },
    })

    assert.equal(appliedStoryboard, false)
    assert.deepEqual(alerts, ['OPFS 読み込みに失敗しました: OPFS not supported in this browser'])
    assert.equal(consoleErrors.length, 1)
    assert.equal(consoleErrors[0][0], 'Failed to load project from OPFS')
    assert(consoleErrors[0][1] instanceof Error)
    assert.equal((consoleErrors[0][1] as Error).message, 'OPFS not supported in this browser')
  })

  it('alerts and logs when template synchronization fails due to unsupported OPFS', async () => {
    const alerts: string[] = []
    const consoleErrors: unknown[][] = []
    const appliedLists: Template[][] = []

    await synchronizeTemplatesList({
      loadJSONImpl: (path) => loadJSON<Template[]>(path),
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
    assert.equal(consoleErrors[0][0], 'TemplatesMenu: failed to load templates from OPFS')
    assert(consoleErrors[0][1] instanceof Error)
    assert.equal((consoleErrors[0][1] as Error).message, 'OPFS not supported in this browser')
  })
})
