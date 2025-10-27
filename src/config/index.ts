import { resolveAutoSavePolicy } from '../lib/autosave.js'
import type { AutoSavePhaseGuardSnapshot, AutoSavePolicy } from '../lib/autosave.js'

import {
  publishFlagResolution,
  type FlagResolutionEventPayload
} from '../telemetry/day8Collector.js'
import type {
  FeatureFlagName,
  FlagSnapshot,
  FlagSource,
  FlagValidationError,
  ResolveOptions,
  WorkspaceConfiguration
} from './flags.js'

import {
  FLAG_MIGRATION_PLAN,
  FEATURE_FLAG_DEFINITIONS,
  resolveFlags
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
  ResolveOptions
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

const toFlagPayload = (
  flag: FeatureFlagName,
  variant: unknown,
  source: FlagSource,
  snapshotErrors: readonly FlagValidationError[],
  planErrors: readonly FlagValidationError[],
  evaluationMs: number,
  options?: { readonly threshold?: number }
): FlagResolutionEventPayload => ({
  flag,
  variant: String(variant),
  source,
  phase: FEATURE_FLAG_DEFINITIONS[flag].phase,
  evaluation_ms: evaluationMs,
  errors: mergeErrors(flag, snapshotErrors, planErrors),
  threshold: options?.threshold ?? null
})

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
      { threshold: snapshot.merge.threshold }
    )
  ]
}

type FlagRolloutPhase = (typeof FLAG_MIGRATION_PLAN)[number]['phase']

export interface AutoSaveBootstrapPlan {
  readonly snapshot: FlagSnapshot
  readonly guard: AutoSavePhaseGuardSnapshot
  readonly failSafePhase: FlagRolloutPhase | null
  readonly policy: AutoSavePolicy
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
  const { snapshot, errors } = resolveFlags(options, { withErrors: true })
  const evaluationMs = Math.max(0, Math.round(readClock() - startedAt))
  const planErrors = errors satisfies readonly FlagValidationError[]

  const payloads = collectFlagResolutionPayloads(snapshot, planErrors, evaluationMs)
  publishFlagResolution('app.autosave', 'bootstrap', payloads, evaluationMs)
  const phaseA0 = FLAG_MIGRATION_PLAN.find((step) => step.phase === 'phase-a0')

  const workspaceInput: WorkspaceConfiguration | null | undefined = options?.workspace
  // Phase A: `resolveAutoSavePolicy` は入力に関わらず固定値を返す（docs/AUTOSAVE-DESIGN-IMPL.md §1.1）。
  const workspacePolicy = resolveAutoSavePolicy(workspaceInput)

  return {
    snapshot,
    guard: {
      featureFlag: {
        value: snapshot.autosave.enabled,
        source: snapshot.autosave.source
      },
      optionsDisabled: config?.optionsDisabled ?? false
    },
    failSafePhase: phaseA0?.phase ?? null,
    policy: workspacePolicy,
    errors: planErrors
  }
}

export function resolvePluginBridgeBootstrapPlan(
  options?: ResolveOptions
): PluginBridgeBootstrapPlan {
  const startedAt = readClock()
  const { snapshot, errors } = resolveFlags(options, { withErrors: true })
  const evaluationMs = Math.max(0, Math.round(readClock() - startedAt))

  const payloads = collectFlagResolutionPayloads(snapshot, errors, evaluationMs)
  publishFlagResolution('vscode.plugins', 'bootstrap', payloads, evaluationMs)
  return {
    snapshot,
    enableFlag: snapshot.plugins.enabled,
    errors,
    evaluationMs
  }
}
