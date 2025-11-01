import { buildPackage } from '../lib/package'
import { loadJSON, saveJSON } from '../lib/opfs'
import type { Storyboard } from '../types'

export interface ToolbarNotifiers {
  readonly alert: (message: string) => void
  readonly consoleError: (message: string, error: unknown) => void
}

export function createBrowserToolbarNotifiers(): ToolbarNotifiers {
  return {
    alert(message) {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(message)
      }
    },
    consoleError(message, error) {
      console.error(message, error)
    }
  }
}

function formatOpfsError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return String(error)
}

export function notifyOpfsFailure(
  notifiers: ToolbarNotifiers,
  alertPrefix: string,
  consoleMessage: string,
  error: unknown
): void {
  notifiers.alert(`${alertPrefix}: ${formatOpfsError(error)}`)
  notifiers.consoleError(consoleMessage, error)
}

export interface ToolbarSaveProjectRequest extends ToolbarNotifiers {
  readonly storyboard: Storyboard
  readonly save: (path: string, storyboard: Storyboard) => Promise<void>
}

export async function handleToolbarSaveProject({
  storyboard,
  save,
  alert: alertUser,
  consoleError
}: ToolbarSaveProjectRequest): Promise<void> {
  try {
    await save('project/storyboard.json', storyboard)
    alertUser('Saved to OPFS: project/storyboard.json')
  } catch (error) {
    notifyOpfsFailure(
      { alert: alertUser, consoleError },
      'OPFS 保存に失敗しました',
      'Failed to save project to OPFS',
      error
    )
  }
}

function isStoryboardPayload(candidate: unknown): candidate is Storyboard {
  if (!candidate || typeof candidate !== 'object') {
    return false
  }
  const storyboard = candidate as Storyboard
  return (
    typeof storyboard.id === 'string' &&
    typeof storyboard.title === 'string' &&
    Array.isArray(storyboard.scenes) &&
    Array.isArray(storyboard.selection)
  )
}

export interface ToolbarLoadProjectRequest extends ToolbarNotifiers {
  readonly load: (path: string) => Promise<Storyboard | null | undefined>
  readonly applyStoryboard: (storyboard: Storyboard) => void
}

export async function handleToolbarLoadProject({
  load,
  applyStoryboard,
  alert: alertUser,
  consoleError
}: ToolbarLoadProjectRequest): Promise<void> {
  try {
    const storyboard = await load('project/storyboard.json')
    if (isStoryboardPayload(storyboard)) {
      applyStoryboard(storyboard)
      alertUser('Loaded from OPFS')
      return
    }
    alertUser('No project found')
  } catch (error) {
    notifyOpfsFailure(
      { alert: alertUser, consoleError },
      'OPFS 読み込みに失敗しました',
      'Failed to load project from OPFS',
      error
    )
  }
}

export interface ToolbarPackageExportRequest extends ToolbarNotifiers {
  readonly storyboard: Storyboard
  readonly build: (storyboard: Storyboard) => Promise<string>
  readonly createDownload: (content: string, storyboard: Storyboard) => void
}

export async function handleToolbarPackageExport({
  storyboard,
  build,
  createDownload,
  alert: alertUser,
  consoleError
}: ToolbarPackageExportRequest): Promise<void> {
  try {
    const pkg = await build(storyboard)
    createDownload(pkg, storyboard)
  } catch (error) {
    notifyOpfsFailure(
      { alert: alertUser, consoleError },
      'パッケージ出力に失敗しました',
      'Failed to export package',
      error
    )
  }
}

export interface ToolbarStoreAdapter {
  readonly getStoryboard: () => Storyboard
  readonly applyStoryboard: (storyboard: Storyboard) => void
}

export interface ToolbarIOOverrides {
  readonly saveJSON?: (path: string, storyboard: Storyboard) => Promise<void>
  readonly loadJSON?: (path: string) => Promise<Storyboard | null | undefined>
  readonly buildPackage?: (storyboard: Storyboard) => Promise<string>
  readonly createDownload?: (content: string, storyboard: Storyboard) => void
}

export interface ToolbarActions {
  readonly saveProject: () => Promise<void>
  readonly loadProject: () => Promise<void>
  readonly exportPackage: () => Promise<void>
}

function defaultCreateDownload(content: string, storyboard: Storyboard): void {
  if (typeof document === 'undefined') {
    return
  }
  const blob = new Blob([content], { type: 'application/json' })
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = `${storyboard.title || 'project'}.imgponic.json`
  anchor.click()
  setTimeout(() => {
    URL.revokeObjectURL(anchor.href)
  }, 2000)
}

export interface CreateToolbarActionsOptions {
  readonly store: ToolbarStoreAdapter
  readonly notifiers: ToolbarNotifiers
  readonly io?: ToolbarIOOverrides
}

export function createToolbarActions({
  store,
  notifiers,
  io
}: CreateToolbarActionsOptions): ToolbarActions {
  const saveImpl = io?.saveJSON ?? saveJSON
  const loadImpl = io?.loadJSON ?? ((path: string) => loadJSON<Storyboard>(path))
  const buildImpl = io?.buildPackage ?? buildPackage
  const createDownloadImpl = io?.createDownload ?? defaultCreateDownload

  return {
    async saveProject() {
      const storyboard = store.getStoryboard()
      await handleToolbarSaveProject({
        storyboard,
        save: async (path, payload) => {
          await saveImpl(path, payload)
        },
        ...notifiers
      })
    },
    async loadProject() {
      await handleToolbarLoadProject({
        load: loadImpl,
        applyStoryboard(storyboard) {
          store.applyStoryboard(storyboard)
        },
        ...notifiers
      })
    },
    async exportPackage() {
      const storyboard = store.getStoryboard()
      await handleToolbarPackageExport({
        storyboard,
        build: buildImpl,
        createDownload(content, currentStoryboard) {
          createDownloadImpl(content, currentStoryboard)
        },
        ...notifiers
      })
    }
  }
}

export interface ShortcutKeyEvent {
  readonly key: string
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  preventDefault(): void
}

export interface KeyboardShortcutHandlerOptions {
  readonly getStoryboard: () => Storyboard
  readonly saveProject: (storyboard: Storyboard) => Promise<void>
  readonly saveSnapshot: (storyboard: Storyboard) => Promise<void>
  readonly addScene: () => void
  readonly alert: (message: string) => void
  readonly consoleError: (message: string, error: unknown) => void
}

export function createKeyboardShortcutHandler(
  options: KeyboardShortcutHandlerOptions
): (event: ShortcutKeyEvent) => Promise<void> | void {
  const {
    getStoryboard,
    saveProject,
    saveSnapshot,
    addScene,
    alert: alertUser,
    consoleError
  } = options

  function notifyFailure(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error)
    alertUser(`保存に失敗しました: ${detail}`)
    consoleError('Keyboard shortcut handler failed', error)
  }

  return (event) => {
    try {
      if (!event.ctrlKey) {
        return
      }

      const key = event.key.toLowerCase()
      if (key === 's' && !event.shiftKey) {
        event.preventDefault()
        const storyboard = getStoryboard()
        return saveProject(storyboard).catch((error) => {
          notifyFailure(error)
        })
      }

      if (key === 's' && event.shiftKey) {
        event.preventDefault()
        const storyboard = getStoryboard()
        return saveSnapshot(storyboard).catch((error) => {
          notifyFailure(error)
        })
      }

      if (key === 'n' && event.altKey) {
        event.preventDefault()
        addScene()
      }
    } catch (error) {
      notifyFailure(error)
    }
  }
}
