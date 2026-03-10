import { resolveAutoSavePolicy, AUTOSAVE_POLICY } from '../lib/autosave.js'
import type { AutoSavePhaseGuardSnapshot } from '../lib/autosave.js'

import {
  publishFlagResolution,
  type FlagResolutionEventPayload
} from '../telemetry/day8Collector.js'
import type {
  FeatureFlagName,
  FlagSnapshot,
  FlagSource,
  FlagValidationError,
  MergePrecision,
  ResolveFlagsResult,
  ResolveOptions,
  WorkspaceConfiguration
} from './flags.js'

import {
  DEFAULT_FLAGS,
  FLAG_MIGRATION_PLAN,
  FEATURE_FLAG_DEFINITIONS,
  resolveFlags,
  workspaceKeyCandidates
} from './flags.js'

export {
  DEFAULT_FLAG_SNAPSHOT,
  DEFAULT_FLAGS,
  FEATURE_FLAG_DEFINITIONS,
  FLAG_MIGRATION_PLAN,
  BETA_THRESHOLD_DEFAULT,
  STABLE_THRESHOLD_DEFAULT,
  coerceMergeThresholdValue,
  resolveFeatureFlag,
  resolveFlags
} from './flags.js'

export type {
  AutosaveFlagSnapshot,
  FeatureFlagName,
  FeatureFlagValue,
  FlagDefinition,
  FlagMigrationStep,
  FlagResolution,
  FlagSnapshot,
  FlagSource,
  FlagValidationError,
  FlagValidationIssue,
  FlagValueSnapshot,
  MergePrecision,
  ResolveOptions,
  WorkspaceConfiguration
} from './flags.js'

export type { FlagResolutionEventPayload } from '../telemetry/day8Collector.js'

const errorKey = (error: FlagValidationError): string =>
  `${error.code}:${error.source}:${error.raw}:${error.phase}`

const mergeErrors = (
  flag: FeatureFlagName,
  snapshotErrors: readonly FlagValidationError[],
  planErrors: readonly FlagValidationError[]
): readonly FlagValidationError[] => {
  if (snapshotErrors.length === 0 && planErrors.length === 0) {
    return []
  }
  const unique = new Map<string, FlagValidationError>()
  for (const error of snapshotErrors) {
    unique.set(errorKey(error), error)
  }
  for (const error of planErrors) {
    if (error.flag === flag && !unique.has(errorKey(error))) {
      unique.set(errorKey(error), error)
    }
  }
  return [...unique.values()]
}

const readWorkspaceTelemetryId = (
  workspace: WorkspaceConfiguration | null | undefined
): string | undefined => {
  if (!workspace) {
    return undefined
  }

  const candidates = workspaceKeyCandidates('workspace_id')
  const withGetter = workspace as {
    readonly get?: <T = unknown>(candidate: string) => T | undefined
  }

  if (typeof withGetter.get === 'function') {
    for (const candidate of candidates) {
      try {
        const value = withGetter.get(candidate)
        if (typeof value === 'string') {
          const normalized = value.trim()
          if (normalized) {
            return normalized
          }
        }
      } catch (error) {
        if (!candidate.startsWith('conimg.')) {
          throw error
        }
      }
    }
  }

  const record = workspace as Record<string, unknown>
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(record, candidate)) {
      const value = record[candidate]
      if (typeof value === 'string') {
        const normalized = value.trim()
        if (normalized) {
          return normalized
        }
      }
    }
  }

  return undefined
}

const toFlagPayload = (
  flag: FeatureFlagName,
  variant: unknown,
  source: FlagSource,
  snapshotErrors: readonly FlagValidationError[],
  planErrors: readonly FlagValidationError[],
  evaluationMs: number,
  options?: { readonly threshold?: number; readonly precision?: MergePrecision }
): FlagResolutionEventPayload => {
  const errors = mergeErrors(flag, snapshotErrors, planErrors)
  const retryable = errors.some((error) => error.retryable)
  const status: FlagResolutionEventPayload['status'] =
    errors.length === 0 ? 'success' : 'failure'
  const thresholdValue = options?.threshold ?? null
  const precision: FlagResolutionEventPayload['precision'] = options?.precision ?? null
  const defaultThresholdUsed =
    flag === 'merge.precision' &&
    thresholdValue === DEFAULT_FLAGS.merge.profile.threshold &&
    errors.some((error) => error.flag === flag)
  const defaultUsed = source === 'default' || defaultThresholdUsed

  return {
    flag,
    variant: String(variant),
    source,
    phase: FEATURE_FLAG_DEFINITIONS[flag].phase as FlagRolloutPhase,
    evaluation_ms: evaluationMs,
    errors,
    precision,
    threshold: thresholdValue,
    status,
    detail: { retryable, default_used: defaultUsed }
  }
}

export const collectFlagResolutionPayloads = (
  snapshot: FlagSnapshot,
  errors: readonly FlagValidationError[],
  evaluationMs: number
): readonly FlagResolutionEventPayload[] => {
  const evaluation = Math.max(0, evaluationMs)
  return [
    toFlagPayload(
      'autosave.enabled',
      snapshot.autosave.value,
      snapshot.autosave.source,
      snapshot.autosave.errors,
      errors,
      evaluation
    ),
    toFlagPayload(
      'plugins.enable',
      snapshot.plugins.value,
      snapshot.plugins.source,
      snapshot.plugins.errors,
      errors,
      evaluation
    ),
    toFlagPayload(
      'merge.precision',
      snapshot.merge.value,
      snapshot.merge.source,
      snapshot.merge.errors,
      errors,
      evaluation,
      { threshold: snapshot.merge.threshold, precision: snapshot.merge.value }
    )
  ]
}

type FlagRolloutPhase = (typeof FLAG_MIGRATION_PLAN)[number]['phase']

export interface AutoSaveBootstrapPlan {
  readonly snapshot: FlagSnapshot
  readonly guard: AutoSavePhaseGuardSnapshot
  readonly failSafePhase: FlagRolloutPhase | null
  readonly policy: typeof AUTOSAVE_POLICY
  readonly errors: readonly FlagValidationError[]
}

export interface PluginBridgeBootstrapPlan {
  readonly snapshot: FlagSnapshot
  readonly enableFlag: boolean
  readonly errors: readonly FlagValidationError[]
  readonly evaluationMs: number
}

const readClock = (): number => {
  const perf = globalThis.performance
  if (perf && typeof perf.now === 'function') {
    return perf.now.call(perf)
  }
  return Date.now()
}

export function resolveAutoSaveBootstrapPlan(
  options?: ResolveOptions,
  config?: { readonly optionsDisabled?: boolean }
): AutoSaveBootstrapPlan {
  const startedAt = readClock()
  const result = resolveFlags(options, { withErrors: true }) as ResolveFlagsResult
  const { snapshot, errors } = result
  const evaluationMs = Math.max(0, Math.round(readClock() - startedAt))
  const planErrors = errors satisfies readonly FlagValidationError[]

  const payloads = collectFlagResolutionPayloads(snapshot, planErrors, evaluationMs)
  const workspaceTelemetryId = readWorkspaceTelemetryId(options?.workspace)
  const envelopeOverrides = workspaceTelemetryId
    ? { workspace_id: workspaceTelemetryId }
    : undefined
  publishFlagResolution(
    'app.autosave',
    'bootstrap',
    payloads,
    evaluationMs,
    envelopeOverrides
  )
  
  // Determine the current phase based on snapshot.autosave.source and Migration Plan
  let currentPhase: FlagRolloutPhase | null = null
  
  // Check if feature flag is disabled, and if so, determine the appropriate phase for failSafe
  if (!snapshot.autosave.value) {
    // If the flag source is env or workspace, we're past phase-a0
    if (snapshot.autosave.source === 'env' || snapshot.autosave.source === 'workspace') {
      const phaseB0 = FLAG_MIGRATION_PLAN.find((step) => step.phase === 'phase-b0')
      currentPhase = phaseB0?.phase ?? null
    } 
    // If the flag source is localStorage or default, this is considered phase-a0 failsafe
    // according to docs/IMPLEMENTATION-PLAN.md and docs/CONFIG_FLAGS.md
    // localStorage フェールセーフも default フェールセーフも phase-a0 として扱う
    else if (snapshot.autosave.source === 'localStorage' || snapshot.autosave.source === 'default') {
      const phaseA0 = FLAG_MIGRATION_PLAN.find((step) => step.phase === 'phase-a0')
      currentPhase = phaseA0?.phase ?? null
    }
    else {
      // For any other source, default to phase-a0
      const phaseA0 = FLAG_MIGRATION_PLAN.find((step) => step.phase === 'phase-a0')
      currentPhase = phaseA0?.phase ?? null
    }
  } else {
    // If feature flag is enabled, we are beyond phase-a0
    const phaseA1 = FLAG_MIGRATION_PLAN.find((step) => step.phase === 'phase-a1')
    currentPhase = phaseA1?.phase ?? null
  }

  // If options are disabled, return null or the appropriate phase
  if (config?.optionsDisabled) {
    currentPhase = null
  }

  const workspaceInput: WorkspaceConfiguration | null | undefined = options?.workspace
  // Phase A: `resolveAutoSavePolicy` は入力に関わらず固定値を返す（docs/AUTOSAVE-DESIGN-IMPL.md §1.1）。
  const workspacePolicy = resolveAutoSavePolicy()

  return {
    snapshot,
    guard: {
      featureFlag: {
        value: snapshot.autosave.value,
        source: snapshot.autosave.source
      },
      optionsDisabled: config?.optionsDisabled ?? false
    },
    failSafePhase: currentPhase,
    policy: workspacePolicy,
    errors: planErrors
  }
}

export function resolvePluginBridgeBootstrapPlan(
  options?: ResolveOptions
): PluginBridgeBootstrapPlan {
  const startedAt = readClock()
  const result = resolveFlags(options, { withErrors: true }) as ResolveFlagsResult
  const { snapshot, errors } = result
  const evaluationMs = Math.max(0, Math.round(readClock() - startedAt))

  const payloads = collectFlagResolutionPayloads(snapshot, errors, evaluationMs)
  const workspaceTelemetryId = readWorkspaceTelemetryId(options?.workspace)
  const envelopeOverrides = workspaceTelemetryId
    ? { workspace_id: workspaceTelemetryId }
    : undefined
  publishFlagResolution(
    'vscode.plugins',
    'bootstrap',
    payloads,
    evaluationMs,
    envelopeOverrides
  )
  return {
    snapshot,
    enableFlag: snapshot.plugins.value,
    errors,
    evaluationMs
  }
}
