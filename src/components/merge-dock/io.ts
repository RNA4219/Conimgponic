import { toCSV, toJSONL, toMarkdown } from '../../lib/exporters'
import { sha256Hex } from '../../lib/hash'
import { ensureDir, loadText, saveText } from '../../lib/opfs'
import type { Storyboard } from '../../types'

export interface MergeDockSnapshotSaveResult {
  readonly directory: string
}

export interface MergeDockSnapshotLoadResult {
  readonly timestamp: string
  readonly compiled: string
}

export class MergeDockSnapshotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MergeDockSnapshotError'
  }
}

export const saveStoryboardSnapshot = async (
  storyboard: Storyboard,
): Promise<MergeDockSnapshotSaveResult> => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const directory = `runs/${timestamp}`
  await ensureDir(directory)
  const compiled = toMarkdown(storyboard)
  const csv = toCSV(storyboard)
  const jsonl = toJSONL(storyboard)
  const hash = await sha256Hex(`${compiled}\n${csv}\n${jsonl}`)
  await saveText(`${directory}/shotlist.md`, compiled)
  await saveText(`${directory}/shotlist.csv`, csv)
  await saveText(`${directory}/shotlist.jsonl`, jsonl)
  await saveText(
    `${directory}/meta.json`,
    JSON.stringify({ hash, title: storyboard.title }, null, 2),
  )
  await saveText('runs/latest.txt', timestamp)
  return { directory }
}

export const loadLatestCompiledSnapshot = async (): Promise<MergeDockSnapshotLoadResult | null> => {
  const timestamp = await loadText('runs/latest.txt')
  if (!timestamp) {
    return null
  }
  const compiled = await loadText(`runs/${timestamp}/shotlist.md`)
  if (compiled == null) {
    throw new MergeDockSnapshotError('Missing compiled snapshot in the latest run')
  }
  return { timestamp, compiled }
}
