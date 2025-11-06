import {
  BETA_THRESHOLD_DEFAULT,
  DEFAULT_FLAGS,
  FEATURE_FLAG_DEFINITIONS,
  STABLE_THRESHOLD_DEFAULT,
  type AutosaveFlagSnapshot,
  type FeatureFlagName,
  type FeatureFlagValue,
  type FeatureFlagSnapshot,
  type FlagCoerceResult,
  type FlagDefinition,
  type FlagMigrationStep,
  type FlagResolution,
  type FlagResolutionError,
  type FlagSnapshot,
  type FlagValidationError,
  type MergePrecision,
  type MergePrecisionFlagSnapshot,
  type PluginEnableFlagSnapshot,
  type ResolveOptions
} from './schema'
import {
  attemptResolve,
  attemptResolveFromWorkspace,
  defaultEnv,
  readWorkspaceValue,
  selectStorage
} from './sources'

export function coerceMergeThresholdValue(
  rawValue: unknown
): FlagCoerceResult<number> | null {
  if (rawValue == null) {
    return null
  }

  if (typeof rawValue === 'number') {
    if (!Number.isFinite(rawValue) || rawValue < 0 || rawValue > 1) {
      return {
        ok: false,
        error: {
          code: 'invalid-precision',
          flag: 'merge.precision',
          raw: String(rawValue),
          message: 'merge.precision threshold must be within [0, 1]',
          retryable: false
        }
      }
    }
    
    // Check if the value is less than 0.75, which is the minimum threshold
    if (rawValue < 0.75) {
      return {
        ok: false,
        error: {
          code: 'invalid-precision',
          flag: 'merge.precision',
          raw: String(rawValue),
          message: 'merge.precision threshold must be >= 0.75',
          retryable: false
        }
      }
    }
    
    return { ok: true, value: rawValue }
  }

  const normalized = String(rawValue).trim()
  if (!normalized) {
    return null
  }

  const lowered = normalized.toLowerCase()
  if (lowered === 'legacy') {
    return {
      ok: true,
      value: DEFAULT_FLAGS.merge.profile.threshold
    }
  }

  if (lowered === 'beta') {
    return {
      ok: true,
      value: Math.max(BETA_THRESHOLD_DEFAULT, DEFAULT_FLAGS.merge.profile.threshold)
    }
  }

  if (lowered === 'stable') {
    return {
      ok: true,
      value: STABLE_THRESHOLD_DEFAULT
    }
  }

  const numeric = Number.parseFloat(normalized)
  if (!Number.isFinite(numeric)) {
    return {
      ok: false,
      error: {
        code: 'invalid-precision',
        flag: 'merge.precision',
        raw: normalized,
        message: 'merge.precision threshold must be within [0, 1]',
        retryable: false
      }
    }
  }

  if (numeric < 0 || numeric > 1) {
    return {
      ok: false,
      error: {
        code: 'invalid-precision',
        flag: 'merge.precision',
        raw: normalized,
        message: 'merge.precision threshold must be within [0, 1]',
        retryable: false
      }
    }
  }

  // Check if the numeric value is less than 0.75, which is the minimum threshold
  if (numeric < 0.75) {
    return {
      ok: false,
      error: {
        code: 'invalid-precision',
        flag: 'merge.precision',
        raw: normalized,
        message: 'merge.precision threshold must be >= 0.75',
        retryable: false
      }
    }
  }

  return { ok: true, value: numeric }
}

export function resolveFlag<T>(
  def: FlagDefinition<T>,
  options: ResolveOptions = {}
): FlagResolution<T> {
  const env = options.env ?? defaultEnv
  const storage = selectStorage(options.storage)
  const workspace = options.workspace ?? null
  const errors: FlagValidationError[] = []

  const envResolved = attemptResolve(env[def.envKey], 'env', def, errors)
  if (envResolved !== null) {
    return { value: envResolved, source: 'env', errors: [...errors] }
  }

  const workspaceResolved = attemptResolveFromWorkspace(workspace, def, errors)
  if (workspaceResolved !== null) {
    return { value: workspaceResolved, source: 'workspace', errors: [...errors] }
  }

  if (storage) {
    const storageKeys = [def.storageKey, ...(def.legacyStorageKeys ?? [])]
    for (const key of storageKeys) {
      const resolved = attemptResolve(storage.getItem(key), 'localStorage', def, errors)
      if (resolved !== null) {
        return { value: resolved, source: 'localStorage', errors: [...errors] }
      }
    }
  }

  return { value: def.defaultValue, source: 'default', errors: [...errors] }
}

function resolveMergeThreshold(
  options: ResolveOptions | undefined,
  errors: FlagValidationError[]
): number {
  const env = options?.env ?? defaultEnv
  const storage = selectStorage(options?.storage)
  const workspace = options?.workspace ?? null
  const definition = FEATURE_FLAG_DEFINITIONS['merge.precision']

  const attempt = (rawValue: unknown, source: 'env' | 'workspace' | 'localStorage'): number | null => {
    const result = coerceMergeThresholdValue(rawValue)
    if (result === null) {
      return null
    }
    if (result.ok) {
      return result.value
    }
    errors.push({ ...result.error, source, phase: definition.phase })
    return null
  }

  const envThreshold = attempt(env[definition.envKey], 'env')
  if (envThreshold !== null) {
    return envThreshold
  }

  if (definition.workspaceKey) {
    const workspaceValue = readWorkspaceValue(workspace, definition.workspaceKey)
    const workspaceThreshold = attempt(workspaceValue, 'workspace')
    if (workspaceThreshold !== null) {
      return workspaceThreshold
    }
  }

  if (storage) {
    const storageKeys = [definition.storageKey, ...(definition.legacyStorageKeys ?? [])]
    for (const key of storageKeys) {
      const storageThreshold = attempt(storage.getItem(key), 'localStorage')
      if (storageThreshold !== null) {
        return storageThreshold
      }
    }
  }

  return DEFAULT_FLAGS.merge.profile.threshold
}

export function resolveFeatureFlag(
  name: 'autosave.enabled',
  options?: ResolveOptions
): AutosaveFlagSnapshot
export function resolveFeatureFlag(
  name: 'plugins.enable',
  options?: ResolveOptions
): PluginEnableFlagSnapshot
export function resolveFeatureFlag(
  name: 'merge.precision',
  options?: ResolveOptions
): MergePrecisionFlagSnapshot
export function resolveFeatureFlag<Name extends FeatureFlagName>(
  name: Name,
  options?: ResolveOptions
): FeatureFlagSnapshot<Name> {
  const definition =
    FEATURE_FLAG_DEFINITIONS[name] as FlagDefinition<FeatureFlagValue<Name>>
  const resolution = resolveFlag(definition, options)

  switch (name) {
    case 'merge.precision': {
      const precision = resolution.value as MergePrecision
      const mergeErrors: FlagValidationError[] = [...resolution.errors]
      const threshold = resolveMergeThreshold(options, mergeErrors)
      const snapshot: MergePrecisionFlagSnapshot = {
        value: precision,
        source: resolution.source,
        errors: mergeErrors,
        precision,
        threshold
      }
      return snapshot as FeatureFlagSnapshot<Name>
    }
    case 'autosave.enabled': {
      const enabled = resolution.value as boolean
      const snapshot: AutosaveFlagSnapshot = {
        value: enabled,
        source: resolution.source,
        errors: resolution.errors,
        enabled
      }
      return snapshot as FeatureFlagSnapshot<Name>
    }
    case 'plugins.enable': {
      const enabled = resolution.value as boolean
      const snapshot: PluginEnableFlagSnapshot = {
        value: enabled,
        source: resolution.source,
        errors: resolution.errors,
        enabled
      }
      return snapshot as FeatureFlagSnapshot<Name>
    }
  }

  throw new Error(`Unsupported feature flag: ${name}`)
}

export interface FlagResolutionSummary {
  readonly snapshot: FlagSnapshot
  readonly errors: readonly FlagResolutionError[]
}

export function resolveFlags(options?: ResolveOptions): FlagSnapshot
export function resolveFlags(
  options: ResolveOptions | undefined,
  config: { readonly withErrors: true }
): FlagResolutionSummary
export function resolveFlags(
  options?: ResolveOptions,
  config?: { readonly withErrors?: boolean }
): FlagSnapshot | FlagResolutionSummary {
  const autosave = resolveFeatureFlag('autosave.enabled', options)
  const plugins = resolveFeatureFlag('plugins.enable', options)
  const merge = resolveFeatureFlag('merge.precision', options)
  const clock = options?.clock ?? (() => new Date())

  const snapshot: FlagSnapshot = {
    autosave,
    plugins,
    merge,
    updatedAt: clock().toISOString()
  }

  if (config?.withErrors) {
    const errors: FlagResolutionError[] = [
      ...autosave.errors,
      ...plugins.errors,
      ...merge.errors
    ]
    return {
      snapshot,
      errors
    }
  }

  return snapshot
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
