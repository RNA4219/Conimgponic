export type FlagSource = 'env' | 'localStorage' | 'default'
export type MergePrecision = 'legacy' | 'beta' | 'stable'
export type AutoSavePhase = 'disabled' | 'phase-a' | 'phase-b'

export interface FlagSnapshot {
  readonly autosave: { readonly enabled: boolean; readonly phase: AutoSavePhase }
  readonly merge: { readonly precision: MergePrecision }
  readonly source: {
    readonly autosaveEnabled: FlagSource
    readonly mergePrecision: FlagSource
  }
  readonly resolvedAt: number
}

export interface FlagDefinition<T> {
  name: string
  envKey: string
  storageKey: string
  defaultValue: T
  coerce?: (raw: string) => T
}

export interface ResolveOptions {
  env?: Record<string, unknown>
  storage?: Pick<Storage, 'getItem'> | null
  defaults?: FlagDefaults
  mode?: 'browser' | 'cli'
}
export interface FlagResolution<T> {
  value: T
  source: FlagSource
  resolvedAt: number
}

export interface FlagDefaults {
  readonly autosave: { readonly enabled: boolean }
  readonly merge: { readonly precision: MergePrecision }
}

export const DEFAULT_FLAGS: FlagDefaults = {
  autosave: { enabled: false },
  merge: { precision: 'legacy' }
} as const

const defaultEnv = ((import.meta as any)?.env ?? {}) as Record<string, unknown>
const defaultStorage: Pick<Storage, 'getItem'> | null =
  typeof localStorage !== 'undefined' ? localStorage : null

function coerceValue<T>(raw: string, def: FlagDefinition<T>): T {
  return def.coerce ? def.coerce(raw) : (raw as unknown as T)
}

/**
 * env → localStorage → docs/CONFIG_FLAGS.md 既定値の優先順位でフラグ値を解決する。
 * `docs/IMPLEMENTATION-PLAN.md` §0.2 の設定ソースマッピングを反映し、解決済みの
 * 値は `FlagSnapshot` として `App.tsx` / `MergeDock.tsx` へ伝達する。
 * ```mermaid
 * graph TD
 *   App[App.tsx bootstrap] -->|useFlagSnapshot| Resolver
 *   Merge[MergeDock.tsx bootstrap] -->|useFlagSnapshot| Resolver
 *   Resolver -->|envKey| Env(import.meta.env)
 *   Resolver -->|storageKey| Storage(localStorage)
 *   Resolver -->|defaults| Defaults(DEFAULT_FLAGS)
 *   Defaults -.->|docs/CONFIG_FLAGS.md| Spec
 *   Resolver --> Snapshot(FlagSnapshot with source metadata)
 *   Snapshot -->|autosave.enabled| AutoSaveRunner
 *   Snapshot -->|merge.precision| DiffMergeTab
 * ```
 */
export function resolveFlag<T>(
  def: FlagDefinition<T>,
  options: ResolveOptions = {}
): FlagResolution<T> {
  const env = options.env ?? defaultEnv
  const storage = options.mode === 'cli' ? null : options.storage ?? defaultStorage
  const resolvedAt = Date.now()

  const envValue = env[def.envKey]
  if (envValue != null && envValue !== '') {
    return {
      value: coerceValue(String(envValue), def),
      source: 'env',
      resolvedAt
    }
  }

  if (storage) {
    const stored = storage.getItem(def.storageKey)
    if (stored != null) {
      return {
        value: coerceValue(stored, def),
        source: 'localStorage',
        resolvedAt
      }
    }
  }

  const defaults = options.defaults ?? DEFAULT_FLAGS
  let fallback = def.defaultValue
  if (def.name === 'autosave.enabled' || def.name === 'autoSave.enabled') {
    fallback = defaults.autosave.enabled as unknown as T
  } else if (def.name === 'merge.precision' || def.name === 'merge.diffTab') {
    fallback = defaults.merge.precision as unknown as T
  }
  return { value: fallback, source: 'default', resolvedAt }
}

const AUTOSAVE_FLAG: FlagDefinition<boolean> = {
  name: 'autosave.enabled',
  envKey: 'VITE_AUTOSAVE_ENABLED',
  storageKey: 'autosave.enabled',
  defaultValue: DEFAULT_FLAGS.autosave.enabled,
  coerce: (raw) => {
    const lower = raw.toLowerCase()
    if (lower === 'true' || raw === '1') return true
    if (lower === 'false' || raw === '0') return false
    return DEFAULT_FLAGS.autosave.enabled
  }
}

const MERGE_PRECISION_FLAG: FlagDefinition<MergePrecision> = {
  name: 'merge.precision',
  envKey: 'VITE_MERGE_PRECISION',
  storageKey: 'merge.precision',
  defaultValue: DEFAULT_FLAGS.merge.precision,
  coerce: (raw) => (raw === 'legacy' || raw === 'beta' || raw === 'stable' ? (raw as MergePrecision) : DEFAULT_FLAGS.merge.precision)
}

export type FeatureFlagName = 'autosave.enabled' | 'merge.precision' | 'autoSave.enabled' | 'merge.diffTab'

export const FEATURE_FLAG_DEFINITIONS = {
  'autosave.enabled': AUTOSAVE_FLAG,
  'autoSave.enabled': AUTOSAVE_FLAG,
  'merge.precision': MERGE_PRECISION_FLAG
} satisfies Record<'autosave.enabled' | 'autoSave.enabled' | 'merge.precision', FlagDefinition<boolean | MergePrecision>>

export function resolveFeatureFlag(
  name: FeatureFlagName,
  options?: ResolveOptions
): FlagResolution<boolean | MergePrecision> {
  if (name === 'merge.diffTab') {
    const precision = resolveFlag(MERGE_PRECISION_FLAG, options)
    return {
      value: precision.value !== 'legacy',
      source: precision.source,
      resolvedAt: precision.resolvedAt
    }
  }

  const key = (name === 'merge.precision' ? 'merge.precision' : name === 'autoSave.enabled' ? 'autoSave.enabled' : 'autosave.enabled') as
    | 'autosave.enabled'
    | 'autoSave.enabled'
    | 'merge.precision'
  if (key === 'merge.precision') {
    return resolveFlag(MERGE_PRECISION_FLAG, options)
  }
  return resolveFlag(AUTOSAVE_FLAG, options)
}

export function resolveFlags(options: ResolveOptions = {}): FlagSnapshot {
  const autosave = resolveFlag(AUTOSAVE_FLAG, options)
  const merge = resolveFlag(MERGE_PRECISION_FLAG, options)
  const resolvedAt = Math.max(autosave.resolvedAt, merge.resolvedAt)
  return {
    autosave: { enabled: autosave.value, phase: derivePhase(autosave.value, merge.value) },
    merge: { precision: merge.value },
    source: {
      autosaveEnabled: autosave.source,
      mergePrecision: merge.source
    },
    resolvedAt
  }
}

function derivePhase(enabled: boolean, precision: MergePrecision): AutoSavePhase {
  return !enabled ? 'disabled' : precision === 'stable' ? 'phase-b' : 'phase-a'
}
