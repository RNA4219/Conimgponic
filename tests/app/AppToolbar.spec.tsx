/// <reference types="node" />

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

import React from 'react'
import { renderToString } from 'react-dom/server'

import {
  handleToolbarSaveProject,
  handleToolbarLoadProject,
  handleToolbarPackageExport,
  handleSaveProjectButtonClick
} from '../../src/App'
import { useSB } from '../../src/store'
import type { Storyboard } from '../../src/types'

function createStoryboard(title: string): Storyboard {
  return {
    ...useSB.getState().sb,
    title,
    scenes: [],
    selection: []
  }
}

test('Save Project ボタンが OPFS 例外を通知し状態を保つ', async () => {
  const storyboard = createStoryboard('Toolbar Save Failure Test')
  const alerts: string[] = []
  const logs: unknown[][] = []
  let persistCalls = 0

  await handleToolbarSaveProject({
    storyboard,
    save: async () => {
      persistCalls += 1
      throw new Error('OPFS quota exceeded')
    },
    alert(message) {
      alerts.push(message)
    },
    consoleError(...args) {
      logs.push(args)
    }
  })

  assert.equal(persistCalls, 1)
  assert.equal(alerts.length, 1)
  assert.match(alerts[0], /OPFS/)
  assert.match(alerts[0], /失敗/)
  assert.equal(logs.length, 1)
  assert.equal(logs[0]?.[0], 'Failed to save project to OPFS')
})

test('handleToolbarSaveProject が保存成功時に通知する', async () => {
  const storyboard = createStoryboard('Toolbar Save Success Test')
  const alerts: string[] = []
  const calls: string[] = []

  await handleToolbarSaveProject({
    storyboard,
    save: async (path, payload) => {
      calls.push(`${path}:${payload.title}`)
    },
    alert(message) {
      alerts.push(message)
    },
    consoleError() {
      throw new Error('consoleError should not be called')
    }
  })

  assert.deepEqual(calls, ['project/storyboard.json:Toolbar Save Success Test'])
  assert.deepEqual(alerts, ['Saved to OPFS: project/storyboard.json'])
})

test('Load Project ボタンが OPFS 例外を通知しボードを変更しない', async () => {
  const original = useSB.getState().sb
  useSB.setState({ sb: { ...original, title: 'Load Failure Baseline', scenes: [], selection: [] } })
  const baseline = useSB.getState().sb
  const alerts: string[] = []
  const logs: unknown[][] = []
  let appliedStoryboard: Storyboard | null = null

  await handleToolbarLoadProject({
    load: async () => {
      throw new Error('OPFS not mounted')
    },
    applyStoryboard(value) {
      appliedStoryboard = value
      useSB.setState({ sb: value })
    },
    alert(message) {
      alerts.push(message)
    },
    consoleError(...args) {
      logs.push(args)
    }
  })

  assert.equal(appliedStoryboard, null)
  assert.equal(alerts.length, 1)
  assert.match(alerts[0], /OPFS/)
  assert.match(alerts[0], /失敗/)
  assert.equal(logs.length, 1)
  assert.equal(logs[0]?.[0], 'Failed to load project from OPFS')
  assert.equal(useSB.getState().sb.title, baseline.title)

  useSB.setState({ sb: original })
})

test('handleToolbarLoadProject が storyboard を適用する', async () => {
  const storyboard = createStoryboard('Toolbar Load Success Test')
  const alerts: string[] = []
  const applied: Storyboard[] = []

  await handleToolbarLoadProject({
    load: async () => storyboard,
    applyStoryboard(value) {
      applied.push(value)
    },
    alert(message) {
      alerts.push(message)
    },
    consoleError() {
      throw new Error('consoleError should not be called')
    }
  })

  assert.equal(applied.length, 1)
  assert.equal(applied[0]?.title, 'Toolbar Load Success Test')
  assert.deepEqual(alerts, ['Loaded from OPFS'])
})

test('Package Export ボタンが OPFS 例外を通知しダウンロードを抑止する', async () => {
  const storyboard = createStoryboard('Package Export Failure Test')
  const alerts: string[] = []
  const logs: unknown[][] = []
  let downloadCalls = 0

  await handleToolbarPackageExport({
    storyboard,
    build: async () => {
      throw new Error('OPFS manifest missing')
    },
    createDownload() {
      downloadCalls += 1
    },
    alert(message) {
      alerts.push(message)
    },
    consoleError(...args) {
      logs.push(args)
    }
  })

  assert.equal(downloadCalls, 0)
  assert.equal(alerts.length, 1)
  assert.match(alerts[0], /失敗/)
  assert.equal(logs.length, 1)
  assert.equal(logs[0]?.[0], 'Failed to export package')
})

test('handleToolbarPackageExport がパッケージを生成してダウンロードする', async () => {
  const storyboard = createStoryboard('Package Export Success Test')
  const downloads: string[] = []

  await handleToolbarPackageExport({
    storyboard,
    build: async value => JSON.stringify({ title: value.title }),
    createDownload(content) {
      downloads.push(content)
    },
    alert() {
      throw new Error('alert should not be called')
    },
    consoleError() {
      throw new Error('consoleError should not be called')
    }
  })

  assert.deepEqual(downloads, ['{"title":"Package Export Success Test"}'])
})

test('Save Project ボタンハンドラが save 例外時にアラートとログを行う', async () => {
  const storyboard = createStoryboard('Toolbar Save Button Handler Failure Test')
  const alerts: string[] = []
  const logs: unknown[][] = []

  await handleSaveProjectButtonClick({
    storyboard,
    save: async () => {
      throw new Error('OPFS write failure')
    },
    alert(message) {
      alerts.push(message)
    },
    consoleError(...args) {
      logs.push(args)
    }
  })

  assert.equal(alerts.length, 1)
  assert.match(alerts[0], /失敗/)
  assert.equal(logs.length, 1)
  assert.equal(logs[0]?.[0], 'Failed to save project to OPFS')
})

test('handleSaveProjectButtonClick が旧シグネチャを引き続き受け付ける', async () => {
  const storyboard = createStoryboard('Toolbar Save Button Handler Legacy Signature Test')
  const calls: Array<{ path: string; payload: Storyboard }> = []
  const alerts: string[] = []

  await handleSaveProjectButtonClick({
    getStoryboard: () => storyboard,
    alert(message) {
      alerts.push(message)
    },
    consoleError() {
      throw new Error('consoleError should not be called')
    },
    saveJSONImpl: async (path, payload) => {
      calls.push({ path, payload })
    }
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.path, 'project/storyboard.json')
  assert.equal(calls[0]?.payload.title, 'Toolbar Save Button Handler Legacy Signature Test')
  assert.deepEqual(alerts, ['Saved to OPFS: project/storyboard.json'])
})

test('App のツールバーが公式ハンドラを呼び出す', async () => {
  const appModule = await import('../../src/App.tsx')
  const App = appModule.default

  assert.equal(typeof App, 'function', 'App のデフォルトエクスポートが必要です')

  let renderedTree: React.ReactElement | null = null

  function Capture(): React.ReactElement {
    const element = App()
    assert.equal(React.isValidElement(element), true, 'App は React 要素を返す必要があります')
    renderedTree = element
    return element
  }

  renderToString(React.createElement(Capture))

  assert.ok(renderedTree, 'App のレンダリング結果を取得できませんでした')

  function findButton(node: React.ReactNode, label: string): React.ReactElement | null {
    if (!React.isValidElement(node)) {
      return null
    }

    if (node.type === 'button') {
      const text = React.Children.toArray(node.props.children)
        .map((child) => (typeof child === 'string' ? child : ''))
        .join('')
        .trim()
      if (text === label) {
        return node
      }
    }

    for (const child of React.Children.toArray(node.props.children)) {
      const found = findButton(child, label)
      if (found) {
        return found
      }
    }

    return null
  }

  const saveButton = findButton(renderedTree, 'Save Project')
  const loadButton = findButton(renderedTree, 'Load Project')
  const exportButton = findButton(renderedTree, 'Package Export')

  assert.ok(saveButton, 'Save Project ボタンが見つかりません')
  assert.ok(loadButton, 'Load Project ボタンが見つかりません')
  assert.ok(exportButton, 'Package Export ボタンが見つかりません')

  assert.equal(typeof saveButton?.props.onClick, 'function', 'Save Project ボタンのハンドラが必要です')
  assert.equal(typeof loadButton?.props.onClick, 'function', 'Load Project ボタンのハンドラが必要です')
  assert.equal(typeof exportButton?.props.onClick, 'function', 'Package Export ボタンのハンドラが必要です')

  const saveHandlerSource = String(saveButton?.props.onClick)
  const loadHandlerSource = String(loadButton?.props.onClick)
  const exportHandlerSource = String(exportButton?.props.onClick)

  assert.match(saveHandlerSource, /handleSaveProjectButtonClick/)
  assert.match(loadHandlerSource, /handleToolbarLoadProject/)
  assert.match(exportHandlerSource, /handleToolbarPackageExport/)
})
