export type FlagSource = 'env' | 'localStorage' | 'default'

export interface FlagSnapshot {
  readonly autosave: { readonly enabled: boolean }
  readonly merge: { readonly precision: 'legacy' | 'beta' | 'stable' }
  readonly source: {
    readonly autosaveEnabled: FlagSource
    readonly mergePrecision: FlagSource
  }
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
}
export interface FlagResolution<T> {
  value: T
  source: FlagSource
}

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
  const storage = options.storage ?? defaultStorage

  const envValue = env[def.envKey]
  if (envValue != null && envValue !== '') {
    return {
      value: coerceValue(String(envValue), def),
      source: 'env'
    }
  }

  if (storage) {
    const stored = storage.getItem(def.storageKey)
    if (stored != null) {
      return {
        value: coerceValue(stored, def),
        source: 'localStorage'
      }
    }
  }

  return { value: def.defaultValue, source: 'default' }
}

export type FeatureFlagName = 'autoSave.enabled' | 'merge.diffTab'

export const FEATURE_FLAG_DEFINITIONS: Record<FeatureFlagName, FlagDefinition<boolean>>
  = {
  'autoSave.enabled': {
    name: 'AutoSave Enabled',
    envKey: 'VITE_FLAG_AUTOSAVE',
    storageKey: 'flag:autoSave.enabled',
    defaultValue: false,
    coerce: (raw) => raw === '1' || raw.toLowerCase() === 'true'
  },
  'merge.diffTab': {
    name: 'Merge Dock Diff Tab',
    envKey: 'VITE_FLAG_MERGE_DIFF',
    storageKey: 'flag:merge.diffTab',
    defaultValue: true,
    coerce: (raw) => raw === '1' || raw.toLowerCase() === 'true'
  }
}

export function resolveFeatureFlag(name: FeatureFlagName, options?: ResolveOptions) {
  return resolveFlag(FEATURE_FLAG_DEFINITIONS[name], options)
}
