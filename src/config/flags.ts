import type { WorkspaceConfiguration } from './flags/schema.js'

export type FlagSource = 'env' | 'workspace' | 'localStorage' | 'default'

export type MergePrecision = 'legacy' | 'beta' | 'stable'

export interface FlagValidationIssue {
  readonly code: 'invalid-boolean' | 'invalid-precision' | 'invalid-threshold'
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

export interface FlagSnapshot {
  readonly autosave: FlagValueSnapshot<boolean>
  readonly plugins: FlagValueSnapshot<boolean>
  readonly merge: FlagValueSnapshot<MergePrecision> & {
    readonly threshold?: number
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
  readonly phase: string
}

export interface ResolveOptions {
  readonly env?: Record<string, unknown>
  readonly storage?: Pick<Storage, 'getItem'> | null
  readonly workspace?: WorkspaceConfiguration | null
  readonly clock?: () => Date
}

export type FeatureFlagName = 'autosave.enabled' | 'merge.precision' | 'plugins.enable'

export type FeatureFlagValue<Name extends FeatureFlagName> =
  (typeof FEATURE_FLAG_DEFINITIONS)[Name]['defaultValue']

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
      threshold: 0.75,
      prefer: 'none' as const
    }
  }
} as const

// フェーズ定義
export const FLAG_MIGRATION_PLAN = [
  { phase: 'phase-a0', description: '初期フェーズ（AutoSave無効）' },
  { phase: 'phase-a1', description: 'AutoSave有効化（Beta精度）' },
  { phase: 'phase-b0', description: 'Beta精度マージ有効化' },
  { phase: 'phase-b1', description: 'Stable精度マージ有効化' }
] as const

const coerceBoolean: FlagCoercer<boolean> = (raw: string) => {
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
      flag: 'unknown',
      raw,
      message: `Invalid boolean value: ${raw}`,
      retryable: false
    }
  }
}

const coerceMergePrecision: FlagCoercer<MergePrecision> = (raw: string) => {
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'legacy' || normalized === 'beta' || normalized === 'stable') {
    return { ok: true, value: normalized }
  }
  return {
    ok: false,
    error: {
      code: 'invalid-precision',
      flag: 'merge.precision',
      raw,
      message: `Invalid precision value: ${raw} (expected: legacy, beta, or stable)`,
      retryable: false
    }
  }
}

export const coerceMergeThresholdValue: FlagCoercer<number> = (raw: string) => {
  const num = Number(raw)
  if (isNaN(num)) {
    return {
      ok: false,
      error: {
        code: 'invalid-threshold',
        flag: 'merge.threshold',
        raw,
        message: `Invalid threshold value: ${raw} (not a number)`,
        retryable: false
      }
    }
  }
  // 0.75未満の場合はエラーとして扱い、既定値へフォールバック
  if (num < 0.75) {
    return {
      ok: false,
      error: {
        code: 'invalid-threshold',
        flag: 'merge.threshold',
        raw,
        message: `Threshold value ${raw} is below minimum 0.75`,
        retryable: false
      }
    }
  }
  if (num < 0 || num > 1) {
    return {
      ok: false,
      error: {
        code: 'invalid-threshold',
        flag: 'merge.threshold',
        raw,
        message: `Threshold value ${raw} is out of range [0, 1]`,
        retryable: false
      }
    }
  }
  return { ok: true, value: num }
}

export const workspaceKeyCandidates = (baseKey: string): readonly string[] => {
  return [
    `conimg.${baseKey}`,
    `imgponic.${baseKey}`,
    baseKey
  ]
}

export const FEATURE_FLAG_DEFINITIONS: Record<FeatureFlagName, FlagDefinition<unknown>> = {
  'autosave.enabled': {
    name: 'autosave.enabled',
    envKey: 'VITE_AUTOSAVE_ENABLED',
    storageKey: 'autosave.enabled',
    legacyStorageKeys: ['flag:autoSave.enabled'],
    defaultValue: DEFAULT_FLAGS.autosave.enabled,
    coerce: coerceBoolean,
    workspaceKey: 'conimg.autosave.enabled',
    phase: 'phase-a0'
  },
  'merge.precision': {
    name: 'merge.precision',
    envKey: 'VITE_MERGE_PRECISION',
    storageKey: 'merge.precision',
    legacyStorageKeys: ['flag:merge.precision'],
    defaultValue: DEFAULT_FLAGS.merge.precision,
    coerce: coerceMergePrecision,
    workspaceKey: 'conimg.merge.threshold',
    phase: 'phase-b0'
  },
  'plugins.enable': {
    name: 'plugins.enable',
    envKey: 'VITE_PLUGINS_ENABLE',
    storageKey: 'plugins.enable',
    defaultValue: DEFAULT_FLAGS.plugins.enable,
    coerce: coerceBoolean,
    workspaceKey: 'conimg.plugins.enable',
    phase: 'phase-a0'
  }
} as const

const readFromEnv = (key: string, env?: Record<string, unknown>): string | null => {
  if (!env) {
    // Check for test mock of import.meta.env first
    const globalScope = globalThis as Record<string, unknown>
    const importMetaEnv = globalScope.__IMPORT_META_ENV__ as Record<string, unknown> | undefined
    if (importMetaEnv && key in importMetaEnv) {
      const value = importMetaEnv[key]
      if (value !== undefined) {
        return String(value)
      }
    }

    // ブラウザ環境ではimport.meta.envを使用
    try {
      // TypeScript構文解析エラーを避けるため、文字列としてアクセス
      const envValue = (globalThis as any).import?.meta?.env?.[key];
      if (envValue !== undefined) {
        return String(envValue)
      }
    } catch {
      // import.meta.envが存在しない場合やアクセスできない場合
    }
    // Node.js環境ではprocess.envを使用
    if (typeof globalThis !== 'undefined') {
      const proc = globalScope.process as Record<string, unknown> | undefined
      const procEnv = proc?.env as Record<string, unknown> | undefined
      if (procEnv && key in procEnv) {
        return String(procEnv[key] ?? null)
      }
    }
    return null
  }
  const value = env[key]
  return value != null ? String(value) : null
}

const readFromWorkspace = (
  workspace: WorkspaceConfiguration | null | undefined,
  workspaceKey: string
): unknown => {
  if (!workspace) {
    return undefined
  }

  const withGetter = workspace as {
    readonly get?: <T = unknown>(candidate: string) => T | undefined
  }

  if (typeof withGetter.get === 'function') {
    try {
      return withGetter.get(workspaceKey)
    } catch {
      // conimg以外のキーは例外を再スロー
      if (!workspaceKey.startsWith('conimg.')) {
        throw new Error(`Failed to read workspace key: ${workspaceKey}`)
      }
      // conimgキーは例外を無視
      return undefined
    }
  }

  const record = workspace as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(record, workspaceKey)) {
    return record[workspaceKey]
  }

  return undefined
}

const readFromStorage = (
  storage: Pick<Storage, 'getItem'> | null | undefined,
  storageKey: string
): string | null => {
  if (!storage) {
    // ブラウザ環境でstorageがnullでない場合、localStorageを使用
    // Node.jsテスト環境ではglobalThis.localStorageを使用
    const localStorageCandidate = typeof window !== 'undefined'
      ? window.localStorage
      : (globalThis as { localStorage?: Pick<Storage, 'getItem'> }).localStorage

    if (localStorageCandidate && storage !== null) {
      try {
        return localStorageCandidate.getItem(storageKey)
      } catch {
        // localStorageが利用不可でもエラーとしない
        return null
      }
    }
    return null
  }
  try {
    return storage.getItem(storageKey)
  } catch {
    return null
  }
}

const resolveFlagValue = <T>(
  definition: FlagDefinition<T>,
  options?: ResolveOptions
): { value: T; source: FlagSource; errors: FlagValidationError[] } => {
  const errors: FlagValidationError[] = []
  
  // 1. 環境変数 (env)
  const envValue = readFromEnv(definition.envKey, options?.env)
  if (envValue != null && envValue !== '') {
    if (definition.coerce) {
      const result = definition.coerce(envValue)
      if (result.ok) {
        return { value: result.value, source: 'env', errors }
      } else {
        errors.push({
          ...result.error,
          source: 'env',
          flag: definition.name,
          phase: definition.phase
        })
      }
    } else {
      // coerceがない場合は文字列のまま値を返す
      return { value: envValue as unknown as T, source: 'env', errors }
    }
  }

  // 2. VSCodeワークスペース設定 (workspace)
  if (options?.workspace && definition.workspaceKey) {
    const workspaceValue = readFromWorkspace(options?.workspace, definition.workspaceKey)
    if (workspaceValue != null) {
      // ワークスペース設定は数値として保存される場合があるため、特別処理が必要
      if (definition.name === 'merge.precision' && typeof workspaceValue === 'number') {
        // conimg.merge.threshold は数値として保存され、0.75未満の場合はエラー
        if (workspaceValue < 0.75) {
          errors.push({
            code: 'invalid-threshold',
            flag: definition.name,
            raw: String(workspaceValue),
            message: `Threshold value ${workspaceValue} is below minimum 0.75`,
            retryable: false,
            phase: definition.phase,
            source: 'workspace'
          })
        } else if (workspaceValue >= 0.82) {
          return { value: 'stable' as T, source: 'workspace', errors }
        } else if (workspaceValue >= 0.75) {
          return { value: 'beta' as T, source: 'workspace', errors }
        } else {
          errors.push({
            code: 'invalid-threshold',
            flag: definition.name,
            raw: String(workspaceValue),
            message: `Threshold value ${workspaceValue} is out of range`,
            retryable: false,
            phase: definition.phase,
            source: 'workspace'
          })
        }
      } else if (definition.coerce) {
        const workspaceValueStr = String(workspaceValue)
        const result = definition.coerce(workspaceValueStr)
        if (result.ok) {
          return { value: result.value, source: 'workspace', errors }
        } else {
          errors.push({
            ...result.error,
            source: 'workspace',
            flag: definition.name,
            phase: definition.phase
          })
        }
      } else {
        return { value: workspaceValue as T, source: 'workspace', errors }
      }
    }
  }

  // 3. localStorage
  // まずメインのstorageKeyをチェック
  let storageValue = readFromStorage(options?.storage, definition.storageKey)

  // メインキーに値がない場合、legacyStorageKeysをチェック
  if ((storageValue == null || storageValue === '') && definition.legacyStorageKeys) {
    for (const legacyKey of definition.legacyStorageKeys) {
      const legacyValue = readFromStorage(options?.storage, legacyKey)
      if (legacyValue != null && legacyValue !== '') {
        storageValue = legacyValue
        break
      }
    }
  }

  if (storageValue != null && storageValue !== '') {
    if (definition.coerce) {
      const result = definition.coerce(storageValue)
      if (result.ok) {
        return { value: result.value, source: 'localStorage', errors }
      } else {
        errors.push({
          ...result.error,
          source: 'localStorage',
          flag: definition.name,
          phase: definition.phase
        })
      }
    } else {
      return { value: storageValue as unknown as T, source: 'localStorage', errors }
    }
  }

  // 4. 既定値 (default)
  return { value: definition.defaultValue, source: 'default', errors }
}

export const resolveFeatureFlag = <Name extends FeatureFlagName>(
  name: Name,
  options?: ResolveOptions
): FlagValueSnapshot<FeatureFlagValue<Name>> => {
  const definition = FEATURE_FLAG_DEFINITIONS[name] as FlagDefinition<FeatureFlagValue<Name>>
  const result = resolveFlagValue(definition, options)
  return {
    value: result.value,
    source: result.source,
    errors: result.errors
  }
}

export interface ResolveFlagsResult {
  snapshot: FlagSnapshot
  errors: readonly FlagValidationError[]
}

export function resolveFlags(
  options?: ResolveOptions,
  config?: { withErrors?: boolean }
): FlagSnapshot | ResolveFlagsResult {
  const clock = options?.clock || (() => new Date())
  const updatedAt = clock().toISOString()

  // 各フラグを解決
  const autosaveResult = resolveFlagValue(FEATURE_FLAG_DEFINITIONS['autosave.enabled'], options)
  const pluginsResult = resolveFlagValue(FEATURE_FLAG_DEFINITIONS['plugins.enable'], options)
  
  // merge.precisionの特別処理
  let mergeResult = resolveFlagValue(FEATURE_FLAG_DEFINITIONS['merge.precision'], options)
  
  // conimg.merge.thresholdのようなワークスペース設定からprecisionを導出する場合、
  // threshold値も保存する
  let thresholdValue: number | undefined = undefined
  if (options?.workspace) {
    // workspaceKeyCandidatesの各候補をチェック
    const candidates = workspaceKeyCandidates('merge.threshold')
    for (const candidate of candidates) {
      const workspaceValue = readFromWorkspace(options.workspace, candidate)
      if (workspaceValue != null) {
        const threshold = Number(workspaceValue)
        if (!isNaN(threshold) && threshold >= 0.75) {
          thresholdValue = threshold
          break
        }
      }
    }
  }

  const snapshot: FlagSnapshot = {
    autosave: {
      value: autosaveResult.value as boolean,
      source: autosaveResult.source,
      errors: autosaveResult.errors
    },
    plugins: {
      value: pluginsResult.value as boolean,
      source: pluginsResult.source,
      errors: pluginsResult.errors
    },
    merge: {
      value: mergeResult.value as MergePrecision,
      source: mergeResult.source,
      errors: mergeResult.errors,
      threshold: thresholdValue
    },
    updatedAt
  }

  if (config?.withErrors) {
    const allErrors = [
      ...autosaveResult.errors,
      ...pluginsResult.errors,
      ...mergeResult.errors
    ]
    return {
      snapshot,
      errors: allErrors
    }
  }

  return snapshot
}

// Default flag snapshot for use when no configuration is available
export const DEFAULT_FLAG_SNAPSHOT: FlagSnapshot = {
  autosave: { value: false, source: 'default', errors: [] },
  plugins: { value: false, source: 'default', errors: [] },
  merge: { value: 'legacy', source: 'default', errors: [] },
  updatedAt: new Date().toISOString()
}

// Re-export WorkspaceConfiguration from schema
export type { WorkspaceConfiguration } from './flags/schema.js'

// Re-export FlagRolloutPhase from schema
export type { FlagRolloutPhase } from './flags/schema.js'

// Type aliases for backwards compatibility
export type AutosaveFlagSnapshot = FlagValueSnapshot<boolean>
export type FlagMigrationStep = { readonly from: string; readonly to: string }
export type FlagResolution<T> = FlagValueSnapshot<T>