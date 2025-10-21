import type { Storyboard } from '../types'

export type StoryboardProvider = () => Storyboard

export interface AutoSaveOptions {
  debounceMs?: number
  idleMs?: number
  maxGenerations?: number
  maxBytes?: number
  disabled?: boolean
}

export const AUTOSAVE_DEFAULTS: Required<AutoSaveOptions> = Object.freeze({
  debounceMs: 500,
  idleMs: 2000,
  maxGenerations: 20,
  maxBytes: 50 * 1024 * 1024,
  disabled: false
})

export type AutoSaveErrorCode =
  | 'lock-unavailable'
  | 'write-failed'
  | 'data-corrupted'
  | 'history-overflow'
  | 'disabled'

export interface AutoSaveError extends Error {
  readonly code: AutoSaveErrorCode
  readonly retryable: boolean
  readonly cause?: Error
  readonly context?: Record<string, unknown>
}

export type AutoSavePhase =
  | 'disabled'
  | 'idle'
  | 'debouncing'
  | 'awaiting-lock'
  | 'writing-current'
  | 'updating-index'
  | 'gc'
  | 'error'

export interface AutoSaveStatusSnapshot {
  phase: AutoSavePhase
  lastSuccessAt?: string
  pendingBytes?: number
  lastError?: AutoSaveError
  retryCount: number
  queuedGeneration?: number
}

export interface AutoSaveInitResult {
  readonly snapshot: () => AutoSaveStatusSnapshot
  flushNow: () => Promise<void>
  dispose: () => void
}

export function initAutoSave(
  getStoryboard: StoryboardProvider,
  options?: AutoSaveOptions
): AutoSaveInitResult {
  throw new Error('initAutoSave not implemented yet')
}

export async function restorePrompt(): Promise<
  | null
  | { ts: string; bytes: number; source: 'current' | 'history'; location: string }
> {
  throw new Error('restorePrompt not implemented yet')
}

export async function restoreFromCurrent(): Promise<boolean> {
  throw new Error('restoreFromCurrent not implemented yet')
}

export async function restoreFrom(ts: string): Promise<boolean> {
  throw new Error('restoreFrom not implemented yet')
}

export async function listHistory(): Promise<
  { ts: string; bytes: number; location: 'history'; retained: boolean }[]
> {
  throw new Error('listHistory not implemented yet')
}
