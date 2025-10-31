export type AutoSaveCollectorPhase = 'A-0' | 'A-1' | 'A-2'

export interface AutoSaveCollectorGuardSnapshot {
  readonly featureFlag: {
    readonly value: boolean
    readonly source: 'env' | 'localStorage' | 'workspace' | (string & {})
  }
  readonly optionsDisabled: boolean
}

export const resolveCollectorPhase = (
  guard: AutoSaveCollectorGuardSnapshot
): AutoSaveCollectorPhase => {
  if (!guard.featureFlag.value || guard.optionsDisabled) {
    return 'A-0'
  }
  switch (guard.featureFlag.source) {
    case 'env':
    case 'localStorage':
      return 'A-1'
    case 'workspace':
      return 'A-2'
    default:
      return 'A-0'
  }
}
