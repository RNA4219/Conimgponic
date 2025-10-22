export type FlagSource = 'env' | 'localStorage' | 'default'
export type MergePrecision = 'legacy' | 'beta' | 'stable'
export type FlagRolloutPhase = 'phase-a0' | 'phase-a1' | 'phase-b0'

export const DEFAULT_FLAGS = {
  autosave: {
    enabled: false,
    debounceMs: 500,
    idleMs: 2000,
    maxGenerations: 20,
    maxBytes: 50 * 1024 * 1024
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

export interface FlagValidationIssue {
  readonly code: 'invalid-boolean' | 'invalid-precision'
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

export type AutosaveFlagSnapshot = FlagValueSnapshot<boolean> & {
  readonly enabled: boolean
}

export type MergePrecisionFlagSnapshot = FlagValueSnapshot<MergePrecision> & {
  readonly precision: MergePrecision
}

export interface FlagSnapshot {
  readonly autosave: AutosaveFlagSnapshot
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
}

export type FlagCoerceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: FlagValidationIssue }

export type FlagCoercer<T> = (raw: string) => FlagCoerceResult<T>

export interface ResolveOptions {
  readonly env?: Record<string, unknown>
  readonly storage?: Pick<Storage, 'getItem'> | null
  readonly clock?: () => Date
}

export interface FlagResolution<T> extends FlagValueSnapshot<T> {}

const defaultEnv = (() => {
  const metaEnv = ((import.meta as any)?.env ?? {}) as Record<string, unknown>
  const nodeProcess =
    typeof globalThis === 'object'
      ? ((globalThis as unknown as { process?: { env?: Record<string, unknown> } })
          .process ?? null)
      : null
  if (nodeProcess?.env) {
    return {
      ...nodeProcess.env,
      ...metaEnv
    }
  }
  return metaEnv
})()
const defaultStorage: Pick<Storage, 'getItem'> | null =
  typeof localStorage !== 'undefined' ? localStorage : null

function coerceValue<T>(
  raw: string,
  def: FlagDefinition<T>
): FlagCoerceResult<T> {
  if (!def.coerce) {
    return { ok: true, value: raw as unknown as T }
  }
  return def.coerce(raw)
}

function attemptResolve<T>(
  rawValue: unknown,
  source: FlagSource,
  def: FlagDefinition<T>,
  errors: FlagValidationError[]
): T | null {
  if (rawValue == null) {
    return null
  }
  const raw = String(rawValue).trim()
  if (!raw) {
    return null
  }

  const coerced = coerceValue(raw, def)
  if (coerced.ok) {
    return coerced.value
  }

  errors.push({ ...coerced.error, source })
  return null
}

/**
 * env → localStorage → docs/CONFIG_FLAGS.md 既定値の優先順位でフラグ値を解決する。
 * `docs/IMPLEMENTATION-PLAN.md` §0.2 の設定ソースマッピングと `FlagSnapshot` の
 * ソース追跡要件を満たすよう、検証失敗時は次順位へフォールバックしながら
 * エラーを蓄積する。
 *
 * ⚠️ 後方互換ポリシー: Phase-a0 では `App.tsx` などの既存呼び出しが `localStorage`
 * を直接読むフェールセーフを保持している。resolveFlags() は新ルートとして追加し、
 * 直接参照の削除は `FLAG_MIGRATION_PLAN` のフェーズ完了後に行う。
 */
export function resolveFlag<T>(
  def: FlagDefinition<T>,
  options: ResolveOptions = {}
): FlagResolution<T> {
  const env = options.env ?? defaultEnv
  const storage = options.storage ?? defaultStorage
  const errors: FlagValidationError[] = []

  const envResolved = attemptResolve(env[def.envKey], 'env', def, errors)
  if (envResolved !== null) {
    return { value: envResolved, source: 'env', errors: [...errors] }
  }

  if (storage) {
    const storageKeys = [
      def.storageKey,
      ...(def.legacyStorageKeys ?? [])
    ]
    for (const key of storageKeys) {
      const resolved = attemptResolve(
        storage.getItem(key),
        'localStorage',
        def,
        errors
      )
      if (resolved !== null) {
        return { value: resolved, source: 'localStorage', errors: [...errors] }
      }
    }
  }

  return { value: def.defaultValue, source: 'default', errors: [...errors] }
}

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
    return {
      ok: false,
      error: {
        code: 'invalid-precision',
        flag,
        raw,
        message: `${flag} expects one of: ${allowed.join(', ')}`,
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
    coerce: coerceBoolean('autosave.enabled')
  },
  'merge.precision': {
    name: 'Merge Precision Mode',
    envKey: 'VITE_MERGE_PRECISION',
    storageKey: 'merge.precision',
    legacyStorageKeys: ['flag:merge.precision'],
    defaultValue: DEFAULT_FLAGS.merge.precision,
    coerce: coerceMergePrecision('merge.precision')
  }
} as const satisfies {
  readonly 'autosave.enabled': FlagDefinition<boolean>
  readonly 'merge.precision': FlagDefinition<MergePrecision>
}

export type FeatureFlagName = keyof typeof FEATURE_FLAG_DEFINITIONS

export type FeatureFlagValue<Name extends FeatureFlagName> =
  (typeof FEATURE_FLAG_DEFINITIONS)[Name]['defaultValue']

export function resolveFeatureFlag<Name extends FeatureFlagName>(
  name: Name,
  options?: ResolveOptions
): FlagResolution<FeatureFlagValue<Name>> {
  const definition = FEATURE_FLAG_DEFINITIONS[name] as FlagDefinition<
    FeatureFlagValue<Name>
  >
  return resolveFlag(definition, options)
}

export const DEFAULT_FLAG_SNAPSHOT: FlagSnapshot = {
  autosave: {
    value: DEFAULT_FLAGS.autosave.enabled,
    source: 'default',
    errors: [],
    enabled: DEFAULT_FLAGS.autosave.enabled
  },
  merge: {
    value: DEFAULT_FLAGS.merge.precision,
    source: 'default',
    errors: [],
    precision: DEFAULT_FLAGS.merge.precision
  },
  updatedAt: new Date(0).toISOString()
}

export function resolveFlags(options?: ResolveOptions): FlagSnapshot {
  const autosave = resolveFeatureFlag('autosave.enabled', options)
  const merge = resolveFeatureFlag('merge.precision', options)
  const clock = options?.clock ?? (() => new Date())

  // Phase A 移行中は既存 UI の `localStorage` 直読フェールセーフが残るため、
  // resolveFlags() だけでは値が届かないケースも想定する。App/Merge 側で
  // snapshot 未取得時は従来挙動へフォールバックできるようガイドする。
  return {
    autosave: {
      value: autosave.value,
      source: autosave.source,
      errors: autosave.errors,
      enabled: autosave.value
    },
    merge: {
      value: merge.value,
      source: merge.source,
      errors: merge.errors,
      precision: merge.value
    },
    updatedAt: clock().toISOString()
  }
}

export interface FlagMigrationStep {
  readonly phase: FlagRolloutPhase
  readonly summary: string
  readonly exitCriteria: string
}

export const FLAG_MIGRATION_PLAN: readonly FlagMigrationStep[] = [
  {
    phase: 'phase-a0',
    summary:
      'Introduce resolveFlags() for App.tsx while keeping direct localStorage fallbacks',
    exitCriteria: 'App bootstrap reads autosave.enabled exclusively via FlagSnapshot'
  },
  {
    phase: 'phase-a1',
    summary:
      'Route AutoSave runner initialization through FlagSnapshot and emit validation telemetry',
    exitCriteria:
      'Collector captures FlagValidationError JSONL entries with source metadata'
  },
  {
    phase: 'phase-b0',
    summary:
      'Gate MergeDock Diff tab with merge.precision from FlagSnapshot and remove legacy keys',
    exitCriteria:
      'localStorage access is mediated by resolveFlags and legacy key reads drop to zero'
  }
]
