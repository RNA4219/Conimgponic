import type { MergePrecision } from '../lib/merge'

// 型定義
export type FlagSource = 'env' | 'workspace' | 'localStorage' | 'default'

export interface FlagValidationIssue {
  readonly code: 'invalid-boolean' | 'invalid-precision' | 'invalid-number'
  readonly flag: string
  readonly raw: string
  readonly message: string
  readonly retryable: false
}

export interface FlagValidationError extends FlagValidationIssue {
  readonly source: FlagSource
}

export interface FlagValueSnapshot<T> {
  readonly value: T
  readonly source: FlagSource
  readonly errors: readonly FlagValidationError[]
}

export interface FlagSnapshot {
  readonly autosave: {
    readonly enabled: boolean
    readonly source: FlagSource
    readonly errors: readonly FlagValidationError[]
    readonly value?: boolean // 既存のコードとの互換性のため
  }
  readonly merge: {
    readonly precision: MergePrecision
    readonly source: FlagSource
    readonly errors: readonly FlagValidationError[]
    readonly threshold?: number
    readonly value?: MergePrecision // 既存のコードとの互換性のため
  }
  readonly plugins?: {
    readonly enable: boolean
    readonly source: FlagSource
    readonly errors: readonly FlagValidationError[]
    readonly value?: boolean // 既存のコードとの互換性のため
  }
  readonly updatedAt: string
}

export type FlagCoerceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: FlagValidationIssue }

export type FlagCoercer<T> = (raw: string) => FlagCoerceResult<T>

export interface FlagDefinition<T> {
  readonly name: string
  readonly envKey: string
  readonly storageKey: string
  readonly legacyStorageKeys?: readonly string[]
  readonly defaultValue: T
  readonly coerce?: FlagCoercer<T>
  readonly workspaceKey?: string
}

export interface ResolveOptions {
  readonly env?: Record<string, unknown>
  readonly storage?: Pick<Storage, 'getItem'> | null
  readonly workspace?: WorkspaceConfiguration | null
  readonly clock?: () => Date
}

export type FeatureFlagName = 'autosave.enabled' | 'merge.precision' | 'merge.threshold'

export type FeatureFlagValue<Name extends FeatureFlagName> =
  (typeof FEATURE_FLAG_DEFINITIONS)[Name]['defaultValue']

export interface WorkspaceConfiguration {
  readonly get: <T = unknown>(key: string) => T | undefined
}

// 既定のフラグ値
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
      threshold: 0.75,
      prefer: 'none' as const
    }
  }
} as const

// フラグ定義
// フラグ定義
const FEATURE_FLAG_DEFINITIONS = {
  'autosave.enabled': {
    name: 'autosave.enabled',
    envKey: 'VITE_AUTOSAVE_ENABLED',
    storageKey: 'autosave.enabled',
    // 既定でphaseを追加 - これは既存コードとの互換性のため
    phase: 'phase-a0' as const,
    defaultValue: DEFAULT_FLAGS.autosave.enabled,
    coerce: (raw: string): FlagCoerceResult<boolean> => {
      const normalized = raw.trim().toLowerCase()
      if (normalized === 'true' || normalized === '1') {
        return { ok: true, value: true }
      }
      if (normalized === 'false' || normalized === '0') {
        return { ok: true, value: false }
      }
      return {
        ok: false,
        error: {
          code: 'invalid-boolean',
          flag: 'autosave.enabled',
          raw,
          message: `Invalid boolean value: ${raw}`,
          retryable: false
        }
      }
    }
  },
  'merge.precision': {
    name: 'merge.precision',
    envKey: 'VITE_MERGE_PRECISION',
    storageKey: 'merge.precision',
    phase: 'phase-b0' as const,
    defaultValue: DEFAULT_FLAGS.merge.precision,
    coerce: (raw: string): FlagCoerceResult<MergePrecision> => {
      const normalized = raw.trim()
      if (normalized === 'legacy' || normalized === 'beta' || normalized === 'stable') {
        return { ok: true, value: normalized }
      }
      return {
        ok: false,
        error: {
          code: 'invalid-precision',
          flag: 'merge.precision',
          raw,
          message: `Invalid precision value: ${raw}`,
          retryable: false
        }
      }
    }
  },
  'merge.threshold': {
    name: 'merge.threshold',
    envKey: 'VITE_MERGE_THRESHOLD',
    storageKey: 'merge.threshold',
    workspaceKey: 'conimg.merge.threshold',
    phase: 'phase-b0' as const,
    defaultValue: DEFAULT_FLAGS.merge.profile.threshold,
    coerce: (raw: string): FlagCoerceResult<number> => {
      const value = Number(raw)
      if (isNaN(value) || value < 0 || value > 1) {
        return {
          ok: false,
          error: {
            code: 'invalid-number',
            flag: 'merge.threshold',
            raw,
            message: `Invalid threshold value: ${raw} (must be between 0 and 1)`,
            retryable: false
          }
        }
      }
      // v1.2.0 追加: 0.75 未満の閾値は無効
      if (value < 0.75) {
        return {
          ok: false,
          error: {
            code: 'invalid-number',
            flag: 'merge.threshold',
            raw,
            message: `Invalid threshold value: ${raw} (must be >= 0.75)`,
            retryable: false
          }
        }
      }
      return { ok: true, value }
    }
  },
  'plugins.enable': {
    name: 'plugins.enable',
    envKey: 'VITE_PLUGINS_ENABLE',
    storageKey: 'plugins.enable',
    phase: 'phase-a1' as const,
    defaultValue: DEFAULT_FLAGS.plugins.enable,
    coerce: (raw: string): FlagCoerceResult<boolean> => {
      const normalized = raw.trim().toLowerCase()
      if (normalized === 'true' || normalized === '1') {
        return { ok: true, value: true }
      }
      if (normalized === 'false' || normalized === '0') {
        return { ok: true, value: false }
      }
      return {
        ok: false,
        error: {
          code: 'invalid-boolean',
          flag: 'plugins.enable',
          raw,
          message: `Invalid boolean value: ${raw}`,
          retryable: false
        }
      }
    }
  }
} as const

// 単一フラグ解決関数
export function resolveFeatureFlag<Name extends FeatureFlagName>(
  name: Name,
  options?: ResolveOptions
): FlagValueSnapshot<FeatureFlagValue<Name>> {
  const definition = FEATURE_FLAG_DEFINITIONS[name]
  if (!definition) {
    throw new Error(`Unknown feature flag: ${name}`)
  }

  const env = options?.env || (typeof process !== 'undefined' ? process.env : {}) || {}
  const storage = options?.storage
  const workspace = options?.workspace
  const clock = options?.clock || (() => new Date())
  
  // エラーを蓄積する配列
  const errors: FlagValidationError[] = []

  // 1. 環境変数から取得
  if (env[definition.envKey]) {
    const rawValue = String(env[definition.envKey])
    if (definition.coerce) {
      const result = definition.coerce(rawValue)
      if (result.ok) {
        return {
          value: result.value as FeatureFlagValue<Name>,
          source: 'env',
          errors: []
        }
      } else {
        errors.push({ ...result.error, source: 'env' })
      }
    } else {
      return {
        value: rawValue as unknown as FeatureFlagValue<Name>,
        source: 'env',
        errors: []
      }
    }
  }

  // 2. workspace設定から取得
  if (workspace && definition.workspaceKey) {
    const rawValue = workspace.get(definition.workspaceKey)
    if (rawValue !== undefined && rawValue !== null) {
      const rawString = String(rawValue)
      if (definition.coerce) {
        const result = definition.coerce(rawString)
        if (result.ok) {
          return {
            value: result.value as FeatureFlagValue<Name>,
            source: 'workspace',
            errors: []
          }
        } else {
          errors.push({ ...result.error, source: 'workspace' })
        }
      } else {
        return {
          value: rawString as unknown as FeatureFlagValue<Name>,
          source: 'workspace',
          errors: []
        }
      }
    }
  }

  // 3. localStorageから取得
  if (storage && definition.storageKey) {
    try {
      const rawValue = storage.getItem(definition.storageKey)
      if (rawValue !== null) {
        if (definition.coerce) {
          const result = definition.coerce(rawValue)
          if (result.ok) {
            return {
              value: result.value as FeatureFlagValue<Name>,
              source: 'localStorage',
              errors: []
            }
          } else {
            errors.push({ ...result.error, source: 'localStorage' })
          }
        } else {
          return {
            value: rawValue as unknown as FeatureFlagValue<Name>,
            source: 'localStorage',
            errors: []
          }
        }
      }
    } catch (e) {
      // localStorageが利用できない場合など
      console.warn(`Failed to access localStorage for flag ${name}`, e)
    }
  }

  // 4. 既定値を使用
  return {
    value: definition.defaultValue,
    source: 'default',
    errors
  }
}

// 全フラグ解決関数
export function resolveFlags(options?: ResolveOptions): FlagSnapshot {
  const clock = options?.clock || (() => new Date())
  
  const autosaveFlag = resolveFeatureFlag('autosave.enabled', options)
  const mergePrecisionFlag = resolveFeatureFlag('merge.precision', options)
  const pluginsFlag = resolveFeatureFlag('plugins.enable', options)
  
  // merge.threshold も解決（ただし、precision に依存）
  const mergeThresholdFlag = resolveFeatureFlag('merge.threshold', options)
  
  return {
    autosave: {
      enabled: autosaveFlag.value,
      value: autosaveFlag.value, // 互換性のため
      source: autosaveFlag.source,
      errors: autosaveFlag.errors
    },
    merge: {
      precision: mergePrecisionFlag.value,
      value: mergePrecisionFlag.value, // 互換性のため
      source: mergePrecisionFlag.source,
      errors: mergePrecisionFlag.errors,
      // threshold は別途保持
      threshold: mergeThresholdFlag.value
    },
    plugins: {
      enable: pluginsFlag.value,
      value: pluginsFlag.value, // 互換性のため
      source: pluginsFlag.source,
      errors: pluginsFlag.errors
    },
    updatedAt: clock().toISOString()
  }
}