import type { WorkspaceConfiguration } from '../../config/flags.js'

export const AUTOSAVE_MAX_BYTES = 50 * 1024 * 1024

export interface AutoSavePolicy {
  readonly debounceMs: number
  readonly idleMs: number
  readonly maxGenerations: number
  readonly maxBytes: number
  readonly disabled: boolean
}

/**
 * 保存ポリシー既定値。`docs/AUTOSAVE-DESIGN-IMPL.md` §1.1 の表と同期する必要がある。
 */
const AUTOSAVE_POLICY_VALUES: AutoSavePolicy = {
  debounceMs: 500,
  idleMs: 2000,
  maxGenerations: 20,
  maxBytes: AUTOSAVE_MAX_BYTES,
  disabled: true
}

export const AUTOSAVE_POLICY: AutoSavePolicy = Object.freeze(AUTOSAVE_POLICY_VALUES)

export const AUTOSAVE_DEFAULTS = AUTOSAVE_POLICY

export interface AutoSavePolicyResolutionOptions {
  readonly workspace?: WorkspaceConfiguration | null
}

type AutoSavePolicyResolutionInput =
  | WorkspaceConfiguration
  | null
  | undefined
  | AutoSavePolicyResolutionOptions

export const resolveAutoSavePolicy = (
  _input?: AutoSavePolicyResolutionInput
): AutoSavePolicy => {
  void _input
  // Phase A: 保存ポリシーは固定値。`docs/AUTOSAVE-DESIGN-IMPL.md` §1.1 および
  // `docs/IMPLEMENTATION-PLAN.md` §0.4 の要件に合わせ、入力に関わらず
  // `AUTOSAVE_POLICY` をそのまま返却する。
  return AUTOSAVE_POLICY
}
