import { resolveAutoSavePolicy } from '../lib/autosave.js'
import type { AutoSavePhaseGuardSnapshot, AutoSavePolicy } from '../lib/autosave.js'

import { publishFlagResolution } from '../telemetry/day8Collector.js'
import type { FlagSnapshot, ResolveOptions, WorkspaceConfiguration } from './flags.js'

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
}

export interface PluginBridgeBootstrapPlan {
  readonly snapshot: FlagSnapshot
  readonly enableFlag: boolean
  readonly errors: readonly FlagValidationError[]
}

export function resolveAutoSaveBootstrapPlan(
  options?: ResolveOptions,
  config?: { readonly optionsDisabled?: boolean }
): AutoSaveBootstrapPlan {
  const { snapshot, errors } = resolveFlags(options, { withErrors: true })

  publishFlagResolution('app.autosave', 'bootstrap', snapshot, errors)
  const phaseA0 = FLAG_MIGRATION_PLAN.find((step) => step.phase === 'phase-a0')

  const workspacePolicy = resolveAutoSavePolicy(options?.workspace)

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
    policy: workspacePolicy
  }
}

export function resolvePluginBridgeBootstrapPlan(
  options?: ResolveOptions
): PluginBridgeBootstrapPlan {
  const { snapshot, errors } = resolveFlags(options, { withErrors: true })

  publishFlagResolution('vscode.plugins', 'bootstrap', snapshot, errors)
  return {
    snapshot,
    enableFlag: snapshot.plugins.enabled,
    errors
  }
}
