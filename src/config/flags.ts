import type { FlagResolutionEventPayload } from '../telemetry/day8Collector.js'

export type FlagSource = 'env' | 'workspace' | 'localStorage' | 'default'

export type MergePrecision = 'legacy' | 'beta' | 'stable'

export interface FlagValidationIssue {
  readonly code: 'invalid-boolean' | 'invalid-precision' | 'invalid-number'
  readonly flag: string
  readonly raw: string
  readonly message: string
  readonly retryable: false
  readonly phase?: string
}

export interface FlagValidationError extends FlagValidationIssue {
  readonly source: FlagSource
}

export interface FlagValueSnapshot<T> {
  readonly value: T
  readonly source: FlagSource
  readonly errors: readonly FlagValidationError[]
}

// autosave.enabled専用の型定義
export interface AutosaveFlagValueSnapshot extends FlagValueSnapshot<boolean> {
  readonly enabled: boolean
}

// plugins.enable専用の型定義  
export interface PluginsFlagValueSnapshot extends FlagValueSnapshot<boolean> {
  readonly enabled: boolean
}

// merge.precision専用の型定義
export interface MergeFlagValueSnapshot extends FlagValueSnapshot<MergePrecision> {
  readonly precision: MergePrecision
  readonly threshold?: number
}

export interface FlagSnapshot {
  readonly autosave: AutosaveFlagValueSnapshot
  readonly plugins: PluginsFlagValueSnapshot
  readonly merge: MergeFlagValueSnapshot
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
  readonly phase: string
}

export interface ResolveOptions {
  readonly env?: Record<string, unknown>
  readonly storage?: Pick<Storage, 'getItem'> | null
  readonly workspace?: WorkspaceConfiguration | null
  readonly clock?: () => Date
  readonly phase?: string
}

export type FeatureFlagName = 'autosave.enabled' | 'plugins.enable' | 'merge.precision'

// フラグ定義を別に定義
const autosaveFlagDefinition: FlagDefinition<boolean> = {
  name: 'autosave.enabled',
  envKey: 'VITE_AUTOSAVE_ENABLED',
  storageKey: 'autosave.enabled',
  defaultValue: false,
  coerce: (raw: string): FlagCoerceResult<boolean> => {
    if (raw === 'true' || raw === '1') return { ok: true, value: true }
    if (raw === 'false' || raw === '0') return { ok: true, value: false }
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
  },
  phase: 'phase-a0'
}

const pluginsFlagDefinition: FlagDefinition<boolean> = {
  name: 'plugins.enable',
  envKey: 'VITE_PLUGINS_ENABLE',
  storageKey: 'plugins.enable',
  defaultValue: false,
  coerce: (raw: string): FlagCoerceResult<boolean> => {
    if (raw === 'true' || raw === '1') return { ok: true, value: true }
    if (raw === 'false' || raw === '0') return { ok: true, value: false }
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
  },
  phase: 'phase-a0'
}

const mergeFlagDefinition: FlagDefinition<MergePrecision> = {
  name: 'merge.precision',
  envKey: 'VITE_MERGE_PRECISION',
  storageKey: 'merge.precision',
  defaultValue: 'legacy',
  coerce: (raw: string): FlagCoerceResult<MergePrecision> => {
    if (raw === 'legacy' || raw === 'beta' || raw === 'stable') {
      return { ok: true, value: raw }
    }
    return {
      ok: false,
      error: {
        code: 'invalid-precision',
        flag: 'merge.precision',
        raw,
        message: `Invalid precision value: ${raw}, expected 'legacy', 'beta', or 'stable'`,
        retryable: false
      }
    }
  },
  phase: 'phase-a0'
}

// フラグ定義マップ
export const FEATURE_FLAG_DEFINITIONS: Record<FeatureFlagName, FlagDefinition<any>> = {
  'autosave.enabled': autosaveFlagDefinition,
  'plugins.enable': pluginsFlagDefinition,
  'merge.precision': mergeFlagDefinition
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

// フラグの値の型を取得
export type FeatureFlagValue<Name extends FeatureFlagName> =
  Name extends 'autosave.enabled' ? boolean :
  Name extends 'plugins.enable' ? boolean :
  Name extends 'merge.precision' ? MergePrecision :
  never

export type WorkspaceConfiguration =
  | { readonly get: (key: string) => unknown }
  | Record<string, unknown>

// マージ閾値の定数
export const BETA_THRESHOLD_DEFAULT = 0.75
export const STABLE_THRESHOLD_DEFAULT = 0.82

// マージ閾値の変換
export const coerceMergeThresholdValue = (raw: string): FlagCoerceResult<number> => {
  const num = Number(raw)
  if (isNaN(num)) {
    return {
      ok: false,
      error: {
        code: 'invalid-number',
        flag: 'merge.precision',
        raw,
        message: `Invalid threshold value: ${raw} (not a number)`,
        retryable: false
      }
    }
  }
  
  // v1.2.0以降: 0.75未満は無効
  if (num < 0.75) {
    return {
      ok: false,
      error: {
        code: 'invalid-precision',
        flag: 'merge.precision',
        raw,
        message: `Merge threshold must be >= 0.75, got: ${num}`,
        retryable: false
      }
    }
  }
  
  if (num < 0 || num > 1) {
    return {
      ok: false,
      error: {
        code: 'invalid-precision',
        flag: 'merge.precision',
        raw,
        message: `Merge threshold must be between 0 and 1, got: ${num}`,
        retryable: false
      }
    }
  }
  
  return { ok: true, value: num }
}

// VSCodeワークスペース設定のキーオプション
export const workspaceKeyCandidates = (key: string): string[] => {
  return [
    `conimg.${key}`,
    key
  ]
}

// フラグ解決関数
export function resolveFlags(
  options?: ResolveOptions,
  config?: { withErrors?: boolean }
): { snapshot: FlagSnapshot; errors: readonly FlagValidationError[] } {
  const clock = options?.clock ?? (() => new Date())
  const updatedAt = clock().toISOString()
  
  // 各フラグを解決
  const autosaveResult = resolveFeatureFlag('autosave.enabled', options, FEATURE_FLAG_DEFINITIONS['autosave.enabled'])
  const pluginsResult = resolveFeatureFlag('plugins.enable', options, FEATURE_FLAG_DEFINITIONS['plugins.enable'])
  const mergeResult = resolveFeatureFlag('merge.precision', options, FEATURE_FLAG_DEFINITIONS['merge.precision'])
  
  // エラー収集
  const allErrors: FlagValidationError[] = []
  allErrors.push(...autosaveResult.errors, ...pluginsResult.errors, ...mergeResult.errors)
  
  // merge.precision に閾値情報を追加
  let mergeThreshold: number | undefined
  if (options?.workspace) {
    const thresholdKeyCandidates = workspaceKeyCandidates('merge.threshold')
    const withGetter = options.workspace as { readonly get?: <T = unknown>(candidate: string) => T | undefined }
    
    if (typeof withGetter.get === 'function') {
      for (const candidate of thresholdKeyCandidates) {
        try {
          const value = withGetter.get(candidate)
          if (typeof value === 'number' || typeof value === 'string') {
            const raw = typeof value === 'number' ? String(value) : value
            const coerced = coerceMergeThresholdValue(raw)
            if (coerced.ok) {
              mergeThreshold = coerced.value
              break
            } else {
              allErrors.push({
                ...coerced.error,
                source: 'workspace',
                phase: options?.phase
              })
              // フォールバックとして既定値を使用
              mergeThreshold = DEFAULT_FLAGS.merge.profile.threshold
            }
          }
        } catch (error) {
          if (!candidate.startsWith('conimg.')) {
            throw error
          }
          // conimg. で始まるキーのエラーは無視
        }
      }
    }
    
    // getter が利用できない場合はレコードとしてアクセス
    if (mergeThreshold === undefined) {
      const record = options.workspace as Record<string, unknown>
      for (const candidate of thresholdKeyCandidates) {
        if (Object.prototype.hasOwnProperty.call(record, candidate)) {
          const value = record[candidate]
          if (typeof value === 'number' || typeof value === 'string') {
            const raw = typeof value === 'number' ? String(value) : value
            const coerced = coerceMergeThresholdValue(raw)
            if (coerced.ok) {
              mergeThreshold = coerced.value
              break
            } else {
              allErrors.push({
                ...coerced.error,
                source: 'workspace',
                phase: options?.phase
              })
              // フォールバックとして既定値を使用
              mergeThreshold = DEFAULT_FLAGS.merge.profile.threshold
            }
          }
        }
      }
    }
  }
  
  const snapshot: FlagSnapshot = {
    autosave: {
      ...autosaveResult,
      enabled: autosaveResult.value
    },
    plugins: {
      ...pluginsResult,
      enabled: pluginsResult.value
    },
    merge: {
      ...mergeResult,
      precision: mergeResult.value,
      threshold: mergeThreshold
    },
    updatedAt
  }
  
  return {
    snapshot,
    errors: config?.withErrors ? allErrors : []
  }
}

// 個別のフラグ解決関数
export function resolveFeatureFlag<Name extends FeatureFlagName>(
  name: Name,
  options?: ResolveOptions,
  definition?: FlagDefinition<FeatureFlagValue<Name>>
): FlagValueSnapshot<FeatureFlagValue<Name>> {
  const def = definition ?? FEATURE_FLAG_DEFINITIONS[name]
  if (!def) {
    throw new Error(`Unknown flag: ${name}`)
  }
  
  // 環境変数から取得 (最優先)
  const envValue = options?.env?.[def.envKey] ?? globalThis?.import?.meta?.env?.[def.envKey]
  if (envValue !== undefined && envValue !== null) {
    const raw = String(envValue)
    if (def.coerce) {
      const result = def.coerce(raw)
      if (result.ok) {
        return {
          value: result.value,
          source: 'env',
          errors: []
        }
      } else {
        return {
          value: def.defaultValue,
          source: 'env',
          errors: [{
            ...result.error,
            source: 'env',
            phase: options?.phase
          }]
        }
      }
    } else {
      return {
        value: raw as any,
        source: 'env',
        errors: []
      }
    }
  }
  
  // VSCodeワークスペース設定から取得 (第二優先)
  if (options?.workspace) {
    const withGetter = options.workspace as { readonly get?: <T = unknown>(candidate: string) => T | undefined }
    if (typeof withGetter.get === 'function') {
      try {
        const value = withGetter.get(def.workspaceKey || def.storageKey)
        if (value !== undefined) {
          const raw = String(value)
          if (def.coerce) {
            const result = def.coerce(raw)
            if (result.ok) {
              return {
                value: result.value,
                source: 'workspace',
                errors: []
              }
            } else {
              return {
                value: def.defaultValue,
                source: 'workspace',
                errors: [{
                  ...result.error,
                  source: 'workspace',
                  phase: options?.phase
                }]
              }
            }
          } else {
            return {
              value: raw as any,
              source: 'workspace',
              errors: []
            }
          }
        }
      } catch (error) {
        // conimg. で始まるキーのエラーは無視 (安全のため)
        if (!def.storageKey.startsWith('conimg.')) {
          throw error
        }
      }
    }
    
    // getterが利用できない場合はレコードとしてアクセス
    const record = options.workspace as Record<string, unknown>
    if (Object.prototype.hasOwnProperty.call(record, def.storageKey)) {
      const value = record[def.storageKey]
      if (value !== undefined) {
        const raw = String(value)
        if (def.coerce) {
          const result = def.coerce(raw)
          if (result.ok) {
            return {
              value: result.value,
              source: 'workspace',
              errors: []
            }
          } else {
            return {
              value: def.defaultValue,
              source: 'workspace',
              errors: [{
                ...result.error,
                source: 'workspace',
                phase: options?.phase
              }]
            }
          }
        } else {
          return {
            value: raw as any,
            source: 'workspace',
            errors: []
          }
        }
      }
    }
  }
  
  // localStorageから取得 (第三優先)
  if (options?.storage !== null) {
    const storage = options?.storage ?? (typeof window !== 'undefined' ? window.localStorage : null)
    if (storage) {
      let raw = storage.getItem(def.storageKey)
      
      // 旧キーもチェック
      if (raw === null && def.legacyStorageKeys) {
        for (const legacyKey of def.legacyStorageKeys) {
          raw = storage.getItem(legacyKey)
          if (raw !== null) break
        }
      }
      
      if (raw !== null) {
        if (def.coerce) {
          const result = def.coerce(raw)
          if (result.ok) {
            return {
              value: result.value,
              source: 'localStorage',
              errors: []
            }
          } else {
            return {
              value: def.defaultValue,
              source: 'localStorage',
              errors: [{
                ...result.error,
                source: 'localStorage',
                phase: options?.phase
              }]
            }
          }
        } else {
          return {
            value: raw as any,
            source: 'localStorage',
            errors: []
          }
        }
      }
    }
  }
  
  // 既定値を使用 (フォールバック)
  return {
    value: def.defaultValue,
    source: 'default',
    errors: []
  }
}

// フェーズ移行プラン
export const FLAG_MIGRATION_PLAN: readonly FlagMigrationStep[] = [
  { phase: 'phase-a0', description: '初期状態。AutoSaveは無効。' },
  { phase: 'phase-a1', description: 'AutoSaveを限定的に有効化。' },
  { phase: 'phase-b0', description: '精緻マージβ版を追加。' },
  { phase: 'phase-b1', description: '精緻マージを安定版として提供。' }
] as const

export interface FlagMigrationStep {
  readonly phase: string
  readonly description: string
}

// 既定のフラグスナップショット
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

// 追加の型定義
export type AutosaveFlagSnapshot = FlagValueSnapshot<boolean>
export type FlagResolution = { snapshot: FlagSnapshot; errors: readonly FlagValidationError[] }
export type FlagRolloutPhase = (typeof FLAG_MIGRATION_PLAN)[number]['phase']

