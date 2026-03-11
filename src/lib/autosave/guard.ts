import type { FlagSource, FlagSnapshot } from '../../config/flags.js'
import { resolveFeatureFlag } from '../../config/flags.js'

export interface AutoSavePhaseGuardSnapshot {
  readonly featureFlag: {
    readonly value: boolean
    readonly source: FlagSource
  }
  readonly optionsDisabled: boolean
}

/**
 * AutoSaveのガード条件を解決する
 *
 * @param input - フラグスナップショットと代替オプション
 * @returns 解決されたガード条件とガードスナップショット
 */
export const resolveAutoSaveGuard = (input: {
  flagSnapshot?: FlagSnapshot | AutoSavePhaseGuardSnapshot
  optionsDisabled?: boolean
  fallbackOptionsDisabled?: boolean
  policyDisabled?: boolean
}): {
  allowed: boolean
  guard: AutoSavePhaseGuardSnapshot
  snapshotSource?: 'provided' | 'fallback'
} => {
  // フラグスナップショットが提供されている場合
  if (input.flagSnapshot) {
    const snapshot = input.flagSnapshot

    // AutoSavePhaseGuardSnapshot が直接渡された場合（featureFlag プロパティがある）
    if ('featureFlag' in snapshot && typeof snapshot.featureFlag === 'object') {
      const guardSnapshot = snapshot as AutoSavePhaseGuardSnapshot
      // optionsDisabled は引数から渡された値とガード内の値をOR結合
      const effectiveOptionsDisabled = guardSnapshot.optionsDisabled || (input.optionsDisabled ?? false)
      const guard: AutoSavePhaseGuardSnapshot = {
        featureFlag: guardSnapshot.featureFlag,
        optionsDisabled: effectiveOptionsDisabled
      }
      const allowed = guard.featureFlag.value && !guard.optionsDisabled
      return { allowed, guard, snapshotSource: 'provided' }
    }

    // FlagSnapshot が渡された場合（autosave プロパティがある）
    if ('autosave' in snapshot && typeof snapshot.autosave === 'object') {
      const flagSnapshot = snapshot as FlagSnapshot
      // optionsDisabled は引数から渡された値とエラーの有無をOR結合
      const effectiveOptionsDisabled =
        (input.optionsDisabled ?? false) ||
        (flagSnapshot.autosave.errors.length > 0)
      const guard: AutoSavePhaseGuardSnapshot = {
        featureFlag: {
          value: flagSnapshot.autosave.value,
          source: flagSnapshot.autosave.source
        },
        optionsDisabled: effectiveOptionsDisabled
      }

      const allowed = guard.featureFlag.value && !guard.optionsDisabled
      return { allowed, guard, snapshotSource: 'provided' }
    }
  }

  // フラグスナップショットがない場合は環境/ストレージから解決
  const optionsDisabled = input.fallbackOptionsDisabled ?? input.optionsDisabled ?? false

  // 環境/ストレージからフラグを解決
  const resolvedFlag = resolveFeatureFlag('autosave.enabled')

  const guard: AutoSavePhaseGuardSnapshot = {
    featureFlag: {
      value: resolvedFlag.value as boolean,
      source: resolvedFlag.source
    },
    optionsDisabled
  }

  const allowed = guard.featureFlag.value && !guard.optionsDisabled
  return { allowed, guard, snapshotSource: 'fallback' }
}