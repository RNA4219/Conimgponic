import type { FlagSource, FlagSnapshot } from '../config/flags'

export interface AutoSaveInitGuardInput {
  readonly flagSnapshot?: FlagSnapshot
}

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
  flagSnapshot?: FlagSnapshot
  fallbackOptionsDisabled?: boolean
  policyDisabled?: boolean
}): { 
  allowed: boolean
  guard: AutoSavePhaseGuardSnapshot 
} => {
  // フラグスナップショットが提供されている場合はそれを使う
  if (input.flagSnapshot) {
    const guard = {
      featureFlag: {
        value: input.flagSnapshot.autosave.enabled,
        source: input.flagSnapshot.autosave.source
      },
      optionsDisabled: input.flagSnapshot.autosave.errors.length > 0 // エラーがある場合は無効とみなす
    }
    
    const allowed = guard.featureFlag.value && !guard.optionsDisabled
    return { allowed, guard }
  }
  
  // フラグスナップショットがない場合は代替値を使用
  const optionsDisabled = input.fallbackOptionsDisabled ?? false
  const featureFlagValue = !(input.policyDisabled ?? false)
  
  const guard = {
    featureFlag: {
      value: featureFlagValue,
      source: 'default' as const
    },
    optionsDisabled
  }
  
  const allowed = guard.featureFlag.value && !guard.optionsDisabled
  return { allowed, guard }
}