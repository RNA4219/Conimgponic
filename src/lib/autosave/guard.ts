import { workspaceKeyCandidates } from '../../config/flags.js'
import type { FlagSnapshot, WorkspaceConfiguration } from '../../config/flags.js'

import type { AutoSavePhaseGuardSnapshot } from '../autosave.js'

const LOCAL_STORAGE_GUARD_KEYS = Object.freeze([
  'autosave.enabled',
  'flag:autoSave.enabled'
] as const)

const truthy = /^(1|true)$/i
const falsy = /^(0|false)$/i

const asBool = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
  }
  if (typeof value === 'string') {
    const normalized = value.trim()
    if (truthy.test(normalized)) return true
    if (falsy.test(normalized)) return false
  }
  return null
}

const guardSource = (
  value: unknown
): AutoSavePhaseGuardSnapshot['featureFlag']['source'] =>
  value === 'env' || value === 'workspace' || value === 'localStorage' || value === 'default'
    ? value
    : 'default'

const readWorkspaceValue = (
  workspace: WorkspaceConfiguration | null | undefined,
  key: string
): unknown => {
  if (!workspace) {
    return undefined
  }
  const candidates = workspaceKeyCandidates(key)
  const candidateWithGetter = workspace as { get?: (name: string) => unknown }
  if (typeof candidateWithGetter.get === 'function') {
    for (const candidate of candidates) {
      const value = candidateWithGetter.get(candidate)
      if (value !== undefined) {
        return value
      }
    }
  }
  const recordWorkspace = workspace as Record<string, unknown>
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(recordWorkspace, candidate)) {
      return recordWorkspace[candidate]
    }
  }
  for (const candidate of candidates) {
    const resolved = candidate.split('.').reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object') {
        return undefined
      }
      const record = current as Record<string, unknown>
      return segment in record ? record[segment] : undefined
    }, workspace)
    if (resolved !== undefined) {
      return resolved
    }
  }
  return undefined
}

export const readImportMetaEnv = (): Record<string, unknown> | undefined => {
  try {
    const meta = import.meta as { env?: unknown }
    const env = meta?.env
    return typeof env === 'object' && env !== null ? (env as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

export interface AutoSaveFlagSnapshot {
  readonly autosave: {
    readonly enabled: boolean
    readonly phase?: string
    readonly source?: string
  }
}

export type AutoSaveInitGuardInput =
  | AutoSaveFlagSnapshot
  | AutoSaveFlagSnapshot['autosave']
  | AutoSavePhaseGuardSnapshot
  | FlagSnapshot

export type AutoSaveGuardSnapshotSource = 'provided' | 'environment'

export interface ResolveAutoSaveGuardOptions {
  readonly flagSnapshot?: AutoSaveInitGuardInput
  readonly fallbackOptionsDisabled: boolean
  readonly policyDisabled: boolean
  readonly scope?: AutoSaveGuardScope
}

export interface AutoSaveGuardScope {
  readonly runtimeFlag?: boolean | null
  readonly workspace?: WorkspaceConfiguration | null
  readonly localStorage?: { getItem?: (key: string) => string | null }
  readonly processEnv?: Record<string, unknown> | undefined
  readonly importMetaEnv?: Record<string, unknown>
}

const resolveDefaultScope = (): AutoSaveGuardScope => {
  const scope = globalThis as typeof globalThis & {
    __AUTOSAVE_ENABLED__?: boolean
    __AUTOSAVE_WORKSPACE__?: WorkspaceConfiguration | null
    localStorage?: { getItem?: (key: string) => string | null }
    process?: { env?: Record<string, unknown> }
  }
  return {
    runtimeFlag:
      typeof scope.__AUTOSAVE_ENABLED__ === 'boolean' ? scope.__AUTOSAVE_ENABLED__ : null,
    workspace: scope.__AUTOSAVE_WORKSPACE__ ?? null,
    localStorage: scope.localStorage,
    processEnv: scope.process?.env,
    importMetaEnv: readImportMetaEnv()
  }
}

const normalizeGuard = (
  candidate: AutoSaveInitGuardInput | undefined,
  fallbackOptionsDisabled: boolean
): AutoSavePhaseGuardSnapshot | null => {
  if (!candidate || typeof candidate !== 'object') return null
  if ('featureFlag' in candidate && candidate.featureFlag && typeof candidate.featureFlag === 'object') {
    const guard = candidate as AutoSavePhaseGuardSnapshot
    if (typeof guard.featureFlag?.value === 'boolean') {
      return {
        featureFlag: {
          value: guard.featureFlag.value,
          source: guardSource(guard.featureFlag.source)
        },
        optionsDisabled: !!guard.optionsDisabled
      }
    }
  }
  const record = candidate as Record<string, unknown>
  if ('autosave' in record && record.autosave && typeof record.autosave === 'object') {
    const auto = record.autosave as { enabled?: unknown; source?: unknown }
    return {
      featureFlag: {
        value: !!auto?.enabled,
        source: guardSource(auto?.source)
      },
      optionsDisabled: fallbackOptionsDisabled
    }
  }
  if ('enabled' in record) {
    const auto = record as { enabled?: unknown; source?: unknown }
    return {
      featureFlag: {
        value: !!auto.enabled,
        source: guardSource(auto.source)
      },
      optionsDisabled: fallbackOptionsDisabled
    }
  }
  return null
}

const resolveGuardFromEnvironment = (
  fallbackOptionsDisabled: boolean,
  policyDisabled: boolean,
  scope: AutoSaveGuardScope
): AutoSavePhaseGuardSnapshot => {
  const env =
    scope.runtimeFlag ??
    asBool(scope.importMetaEnv?.VITE_AUTOSAVE_ENABLED ?? scope.processEnv?.VITE_AUTOSAVE_ENABLED)
  if (env != null) {
    return {
      featureFlag: { value: env, source: 'env' },
      optionsDisabled: fallbackOptionsDisabled
    }
  }
  const workspaceValue = asBool(readWorkspaceValue(scope.workspace ?? null, 'conimg.autosave.enabled'))
  if (workspaceValue != null) {
    return {
      featureFlag: { value: workspaceValue, source: 'workspace' },
      optionsDisabled: fallbackOptionsDisabled
    }
  }
  if (scope.localStorage && typeof scope.localStorage.getItem === 'function') {
    for (const key of LOCAL_STORAGE_GUARD_KEYS) {
      const storage = asBool(scope.localStorage.getItem(key))
      if (storage != null) {
        return {
          featureFlag: { value: storage, source: 'localStorage' },
          optionsDisabled: fallbackOptionsDisabled
        }
      }
    }
  }
  return {
    featureFlag: { value: !policyDisabled, source: 'default' },
    optionsDisabled: fallbackOptionsDisabled
  }
}

export interface ResolveAutoSaveGuardResult {
  readonly guard: AutoSavePhaseGuardSnapshot
  readonly snapshotSource: AutoSaveGuardSnapshotSource
}

export const resolveAutoSaveGuard = (
  options: ResolveAutoSaveGuardOptions
): ResolveAutoSaveGuardResult => {
  const fallbackOptionsDisabled = options.fallbackOptionsDisabled
  const candidate = normalizeGuard(options.flagSnapshot, fallbackOptionsDisabled)
  if (candidate) {
    return { guard: candidate, snapshotSource: 'provided' }
  }
  const scope = options.scope ?? resolveDefaultScope()
  const guard = resolveGuardFromEnvironment(fallbackOptionsDisabled, options.policyDisabled, scope)
  return { guard, snapshotSource: 'environment' }
}

export { normalizeGuard as normalizeAutoSaveGuard }
