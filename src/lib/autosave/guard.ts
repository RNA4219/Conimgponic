export type FlagSource = 'env' | 'workspace' | 'localStorage' | 'default'

export interface AutoSaveInitGuardInput {
  readonly flagSnapshot?: {
    readonly featureFlag: {
      readonly value: boolean
      readonly source: FlagSource
    }
    readonly optionsDisabled: boolean
  }
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
  flagSnapshot?: AutoSaveInitGuardInput['flagSnapshot']
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
        value: input.flagSnapshot.featureFlag.value,
        source: input.flagSnapshot.featureFlag.source
      },
      optionsDisabled: input.flagSnapshot.optionsDisabled
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