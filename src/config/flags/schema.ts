export type FlagSource = 'env' | 'workspace' | 'localStorage' | 'default'

export type MergePrecision = 'legacy' | 'beta' | 'stable'

export type FlagRolloutPhase =
  | 'phase-a0'
  | 'phase-a1'
  | 'phase-a2'
  | 'phase-b0'
  | 'phase-b1'
  | 'phase-c0'

export interface FlagValidationIssue {
  readonly code: 'invalid-boolean' | 'invalid-precision'
  readonly flag: string
  readonly raw: string
  readonly message: string
  readonly retryable: false
}

export interface FlagValidationError extends FlagValidationIssue {
  readonly source: FlagSource
  readonly phase: FlagRolloutPhase
}

export type FlagResolutionError = FlagValidationError

export interface FlagValueSnapshot<T> {
  readonly value: T
  readonly source: FlagSource
  readonly errors: readonly FlagValidationError[]
}

export type AutosaveFlagSnapshot = FlagValueSnapshot<boolean> & {
  readonly enabled: boolean
}

export type PluginEnableFlagSnapshot = FlagValueSnapshot<boolean> & {
  readonly enabled: boolean
}

export type MergePrecisionFlagSnapshot = FlagValueSnapshot<MergePrecision> & {
  readonly precision: MergePrecision
  readonly threshold: number
}

export interface FlagSnapshot {
  readonly autosave: AutosaveFlagSnapshot
  readonly plugins: PluginEnableFlagSnapshot
  readonly merge: MergePrecisionFlagSnapshot
  readonly updatedAt: string
}

export interface FlagDefinition<T> {
  readonly name: string
  readonly envKey: string
  readonly storageKey: string
  readonly legacyStorageKeys?: readonly string[]
  readonly defaultValue: T
  readonly coerce?: FlagCoercer<T>
  readonly workspaceKey?: string
  readonly phase: FlagRolloutPhase
}

export type FeatureFlagDefinitionMap = {
  readonly 'autosave.enabled': FlagDefinition<boolean>
  readonly 'plugins.enable': FlagDefinition<boolean>
  readonly 'merge.precision': FlagDefinition<MergePrecision>
}

export type FeatureFlagName = keyof FeatureFlagDefinitionMap

export type FeatureFlagDefinition<Name extends FeatureFlagName> =
  FeatureFlagDefinitionMap[Name]

export type FeatureFlagValue<Name extends FeatureFlagName> =
  FeatureFlagDefinition<Name> extends FlagDefinition<infer Value>
    ? Value
    : never

export type FlagCoerceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: FlagValidationIssue }

export type FlagCoercer<T> = (raw: string) => FlagCoerceResult<T>

export interface ResolveOptions {
  readonly env?: Record<string, unknown>
  readonly storage?: Pick<Storage, 'getItem'> | null
  readonly workspace?: WorkspaceConfiguration | null
  readonly clock?: () => Date
}

export type WorkspaceConfiguration =
  | { readonly get: <T = unknown>(key: string) => T | undefined }
  | Record<string, unknown>

export type FlagResolution<T> = FlagValueSnapshot<T>

export interface FeatureFlagSnapshotMap {
  readonly 'autosave.enabled': AutosaveFlagSnapshot
  readonly 'plugins.enable': PluginEnableFlagSnapshot
  readonly 'merge.precision': MergePrecisionFlagSnapshot
}

export type FeatureFlagSnapshot<Name extends FeatureFlagName> =
  FeatureFlagSnapshotMap[Name]

export const BETA_THRESHOLD_DEFAULT = 0.75
export const STABLE_THRESHOLD_DEFAULT = 0.82

export const DEFAULT_FLAGS = {
  autosave: {
    enabled: false,
    debounceMs: 500,
    idleMs: 2000,
    maxGenerations: 20,
    maxBytes: 50 * 1024 * 1024
  },
  plugins: {
    enable: false
  },
  merge: {
    precision: 'legacy' as const,
    profile: {
      tokenizer: 'char' as const,
      granularity: 'section' as const,
      threshold: BETA_THRESHOLD_DEFAULT,
      prefer: 'none' as const
    }
  }
} as const

const BOOLEAN_TRUE = new Set(['1', 'true'])
const BOOLEAN_FALSE = new Set(['0', 'false'])

function coerceBoolean(flag: string): FlagCoercer<boolean> {
  return (raw) => {
    const normalized = raw.trim().toLowerCase()
    if (BOOLEAN_TRUE.has(normalized)) {
      return { ok: true, value: true }
    }
    if (BOOLEAN_FALSE.has(normalized)) {
      return { ok: true, value: false }
    }
    return {
      ok: false,
      error: {
        code: 'invalid-boolean',
        flag,
        raw,
        message: `${flag} expects a boolean-like string`,
        retryable: false
      }
    }
  }
}

function coerceMergePrecision(flag: string): FlagCoercer<MergePrecision> {
  const allowed: readonly MergePrecision[] = ['legacy', 'beta', 'stable']
  return (raw) => {
    const normalized = raw.trim().toLowerCase()
    if (allowed.includes(normalized as MergePrecision)) {
      return { ok: true, value: normalized as MergePrecision }
    }
    const numeric = Number.parseFloat(normalized)
    if (Number.isFinite(numeric)) {
      if (numeric < 0 || numeric > 1) {
        return {
          ok: false,
          error: {
            code: 'invalid-precision',
            flag,
            raw,
            message: `${flag} must be within [0, 1] range`,
            retryable: false
          }
        }
      }
      const value: MergePrecision =
        numeric >= 0.82 ? 'stable' : numeric >= 0.75 ? 'beta' : 'legacy'
      return { ok: true, value }
    }
    return {
      ok: false,
      error: {
        code: 'invalid-precision',
        flag,
        raw,
        message: `${flag} expects one of: ${allowed.join(', ')} or a numeric threshold`,
        retryable: false
      }
    }
  }
}

export const FEATURE_FLAG_DEFINITIONS = {
  'autosave.enabled': {
    name: 'AutoSave Enabled',
    envKey: 'VITE_AUTOSAVE_ENABLED',
    storageKey: 'autosave.enabled',
    legacyStorageKeys: ['flag:autoSave.enabled'],
    defaultValue: DEFAULT_FLAGS.autosave.enabled,
    coerce: coerceBoolean('autosave.enabled'),
    workspaceKey: 'conimg.autosave.enabled',
    phase: 'phase-a0'
  },
  'plugins.enable': {
    name: 'Plugin Bridge Enable',
    envKey: 'VITE_PLUGINS_ENABLE',
    storageKey: 'plugins.enable',
    defaultValue: DEFAULT_FLAGS.plugins.enable,
    coerce: coerceBoolean('plugins.enable'),
    workspaceKey: 'conimg.plugins.enable',
    phase: 'phase-a1'
  },
  'merge.precision': {
    name: 'Merge Precision Mode',
    envKey: 'VITE_MERGE_PRECISION',
    storageKey: 'merge.precision',
    legacyStorageKeys: ['flag:merge.precision'],
    defaultValue: DEFAULT_FLAGS.merge.precision,
    coerce: coerceMergePrecision('merge.precision'),
    workspaceKey: 'conimg.merge.threshold',
    phase: 'phase-b0'
  }
} as const satisfies FeatureFlagDefinitionMap

export const DEFAULT_FLAG_SNAPSHOT: FlagSnapshot = {
  autosave: {
    value: DEFAULT_FLAGS.autosave.enabled,
    source: 'default',
    errors: [],
    enabled: DEFAULT_FLAGS.autosave.enabled
  },
  plugins: {
    value: DEFAULT_FLAGS.plugins.enable,
    source: 'default',
    errors: [],
    enabled: DEFAULT_FLAGS.plugins.enable
  },
  merge: {
    value: DEFAULT_FLAGS.merge.precision,
    source: 'default',
    errors: [],
    precision: DEFAULT_FLAGS.merge.precision,
    threshold: DEFAULT_FLAGS.merge.profile.threshold
  },
  updatedAt: new Date(0).toISOString()
}

export interface FlagMigrationStep {
  readonly phase: FlagRolloutPhase
  readonly summary: string
  readonly exitCriteria: string
}
