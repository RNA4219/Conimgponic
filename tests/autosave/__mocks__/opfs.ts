import type { OpfsMock } from '../../lib/autosave/setup'

export interface AutoSaveWriteSnapshot {
  readonly path: string
  readonly payload: unknown
  readonly bytes: number
}

const fileSizes = new Map<string, number>()

export const reset = (): void => {
  fileSizes.clear()
}

const parsePayload = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const recordSize = (path: string, payload: string): number => {
  const size = Buffer.byteLength(payload, 'utf8')
  fileSizes.set(path, size)
  return size
}

export const collectAutoSaveWrites = (opfs: OpfsMock): readonly AutoSaveWriteSnapshot[] => {
  return [...opfs.files.entries()]
    .filter(([path]) => path.startsWith('project/autosave/') && !path.endsWith('.tmp'))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, payload]) => ({ path, payload: parsePayload(payload), bytes: recordSize(path, payload) }))
}

export const collectHistoryFiles = (opfs: OpfsMock): readonly string[] => {
  return [...opfs.files.keys()]
    .filter((path) => path.startsWith('project/autosave/history/'))
    .filter((path) => !path.endsWith('.tmp'))
    .sort()
}
