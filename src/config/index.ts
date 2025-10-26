import { resolveAutoSavePolicy } from '../lib/autosave.js'
import type { AutoSavePhaseGuardSnapshot, AutoSavePolicy } from '../lib/autosave.js'

import { publishFlagResolution } from '../telemetry/day8Collector.js'
import type {
  FlagSnapshot,
  FlagValidationError,
  ResolveOptions,
  WorkspaceConfiguration
} from './flags.js'

import {
  FLAG_MIGRATION_PLAN,
  resolveFlags
} from './flags.js'

export {
  DEFAULT_FLAG_SNAPSHOT,
  DEFAULT_FLAGS,
  FEATURE_FLAG_DEFINITIONS,
  FLAG_MIGRATION_PLAN,
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

  publishFlagResolution('app.autosave', 'bootstrap', snapshot, planErrors, evaluationMs)
  const phaseA0 = FLAG_MIGRATION_PLAN.find((step) => step.phase === 'phase-a0')

  const workspaceInput: WorkspaceConfiguration | null | undefined = options?.workspace
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

  publishFlagResolution('vscode.plugins', 'bootstrap', snapshot, errors, evaluationMs)
  return {
    snapshot,
    enableFlag: snapshot.plugins.enabled,
    errors,
    evaluationMs
  }
}
