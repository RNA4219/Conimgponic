import type { AutoSavePhaseGuardSnapshot } from '../lib/autosave'

import type { FlagSnapshot, ResolveOptions } from './flags'

import {
  FLAG_MIGRATION_PLAN,
  resolveFlags
} from './flags'

export {
  DEFAULT_FLAG_SNAPSHOT,
  DEFAULT_FLAGS,
  FEATURE_FLAG_DEFINITIONS,
  FLAG_MIGRATION_PLAN,
  resolveFeatureFlag,
  resolveFlags
} from './flags'

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
} from './flags'

type FlagRolloutPhase = (typeof FLAG_MIGRATION_PLAN)[number]['phase']

export interface AutoSaveBootstrapPlan {
  readonly snapshot: FlagSnapshot
  readonly guard: AutoSavePhaseGuardSnapshot
  readonly failSafePhase: FlagRolloutPhase | null
}

export function resolveAutoSaveBootstrapPlan(
  options?: ResolveOptions,
  config?: { readonly optionsDisabled?: boolean }
): AutoSaveBootstrapPlan {
  const snapshot = resolveFlags(options)
  const phaseA0 = FLAG_MIGRATION_PLAN.find((step) => step.phase === 'phase-a0')

  return {
    snapshot,
    guard: {
      featureFlag: {
        value: snapshot.autosave.enabled,
        source: snapshot.autosave.source
      },
      optionsDisabled: config?.optionsDisabled ?? false
    },
    failSafePhase: phaseA0?.phase ?? null
  }
}
