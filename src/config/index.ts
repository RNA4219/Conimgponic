import { AUTOSAVE_POLICY } from '../lib/autosave.js'
import type { AutoSavePhaseGuardSnapshot, AutoSavePolicy } from '../lib/autosave.js'

import { publishFlagResolution } from '../telemetry/day8Collector.js'
import type { FlagSnapshot, ResolveOptions, WorkspaceConfiguration } from './flags.js'

import {
  FLAG_MIGRATION_PLAN,
  resolveFlags
} from './flags.js'

const BYTES_PER_MEGABYTE = 1024 * 1024

const readWorkspaceValue = (
  workspace: WorkspaceConfiguration | null | undefined,
  key: string
): unknown => {
  if (!workspace) {
    return undefined
  }
  const candidate = workspace as { get?: (name: string) => unknown }
  if (typeof candidate.get === 'function') {
    return candidate.get(key)
  }
  if (Object.prototype.hasOwnProperty.call(workspace, key)) {
    return (workspace as Record<string, unknown>)[key]
  }
  return key.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') {
      return undefined
    }
    const record = current as Record<string, unknown>
    return segment in record ? record[segment] : undefined
  }, workspace)
}

const asFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

const asPositiveInteger = (value: unknown): number | null => {
  const numeric = asFiniteNumber(value)
  if (numeric == null) {
    return null
  }
  const truncated = Math.floor(numeric)
  return truncated > 0 ? truncated : null
}

const asPositiveMegabytes = (value: unknown): number | null => {
  const numeric = asFiniteNumber(value)
  if (numeric == null || numeric <= 0) {
    return null
  }
  const rounded = Math.round(numeric * BYTES_PER_MEGABYTE)
  return rounded > 0 ? rounded : null
}

const resolveAutoSavePolicy = (
  workspace: WorkspaceConfiguration | null | undefined
): AutoSavePolicy => {
  const historyLimit = asPositiveInteger(
    readWorkspaceValue(workspace, 'conimg.autosave.historyLimit')
  )
  const sizeLimitBytes = asPositiveMegabytes(
    readWorkspaceValue(workspace, 'conimg.autosave.sizeLimitMB')
  )

  return {
    ...AUTOSAVE_POLICY,
    maxGenerations: historyLimit ?? AUTOSAVE_POLICY.maxGenerations,
    maxBytes: sizeLimitBytes ?? AUTOSAVE_POLICY.maxBytes
  }
}

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
    enableFlag: snapshot.plugins.enabled
  }
}
