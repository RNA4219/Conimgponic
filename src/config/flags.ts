export type FlagSource = 'env' | 'localStorage' | 'default'

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
 * env → localStorage → default の優先順位でフラグ値を解決する。
 * ```mermaid
 * sequenceDiagram
 *   participant R as FlagResolver
 *   participant E as Env
 *   participant L as localStorage
 *   participant D as Default
 *   R->>E: lookup(envKey)
 *   alt env hit
 *     E-->>R: raw
 *   else env miss
 *     R->>L: getItem(storageKey)
 *     alt local hit
 *       L-->>R: raw
 *     else local miss
 *       R->>D: use defaultValue
 *       D-->>R: fallback
 *     end
 *   end
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
