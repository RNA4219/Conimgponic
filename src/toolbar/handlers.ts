import type { Storyboard } from '../types'

export interface ToolbarNotifiers {
  readonly alert: (message: string) => void
  readonly consoleError: (message: string, error: unknown) => void
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
