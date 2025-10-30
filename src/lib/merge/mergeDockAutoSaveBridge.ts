import type { AutoSaveInitResult } from '../autosave.ts'

interface MergeDockWindow extends Window {
  __mergeDockFlushNow?: () => void
  __mergeDockAutoSaveSnapshot?: { lastSuccessAt?: string }
}

const resolveMergeDockWindow = (target?: Window): MergeDockWindow | undefined => {
  if (target) {
    return target as MergeDockWindow
  }
  if (typeof window === 'undefined') {
    return undefined
  }
  return window as MergeDockWindow
}

export const attachMergeDockAutoSaveBridge = (
  runner: AutoSaveInitResult,
  target?: Window,
): (() => void) => {
  const mergeWindow = resolveMergeDockWindow(target)
  if (!mergeWindow) {
    return () => {}
  }

  const snapshotBox: { lastSuccessAt?: string } = {
    lastSuccessAt: runner.snapshot().lastSuccessAt,
  }
  const updateSnapshot = (): void => {
    const snapshot = runner.snapshot()
    snapshotBox.lastSuccessAt = snapshot.lastSuccessAt
  }

  const flushWrapper = (): void => {
    runner
      .flushNow()
      .then(() => {
        updateSnapshot()
      })
      .catch((error) => {
        console.error('MergeDock: AutoSave flush failed', error)
      })
  }

  mergeWindow.__mergeDockAutoSaveSnapshot = snapshotBox
  mergeWindow.__mergeDockFlushNow = flushWrapper

  const unsubscribe = runner.onEvent(() => {
    updateSnapshot()
  })

  return () => {
    unsubscribe()
    if (mergeWindow.__mergeDockFlushNow === flushWrapper) {
      delete mergeWindow.__mergeDockFlushNow
    }
    if (mergeWindow.__mergeDockAutoSaveSnapshot === snapshotBox) {
      delete mergeWindow.__mergeDockAutoSaveSnapshot
    }
  }
}
