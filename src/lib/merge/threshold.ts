import { useMemo } from 'react'

import { resolveFlags, workspaceKeyCandidates, type FlagSnapshot } from '../../config/flags'
import { resolveMergeThresholdPlan } from './phasePlan'
import type { MergePrecision } from '../merge'

export const MERGE_THRESHOLD_STORAGE_KEY = 'conimg.merge.threshold'

export const parseMergePrecision = (value: unknown): MergePrecision | undefined => {
  if (value === 'legacy' || value === 'beta' || value === 'stable') {
    return value
  }
  return undefined
}

type ParseThresholdInput = number | string | null | undefined

const parseMergeThreshold = (value: ParseThresholdInput): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

const clampThresholdToPrecisionMinimum = (precision: MergePrecision, value: number): number => {
  const plan = resolveMergeThresholdPlan(precision, value)
  return value < plan.slider.min ? plan.slider.min : value
}

export type WorkspaceConfiguration =
  | { readonly get: <T = unknown>(key: string) => T | undefined }
  | Record<string, unknown>

export type MergeThresholdStorage = Pick<Storage, 'getItem'> | null

export const readWorkspaceSetting = (
  workspace: WorkspaceConfiguration | null | undefined,
  key: string,
): unknown => {
  if (!workspace) {
    return undefined
  }

  const candidates = workspaceKeyCandidates(key)
  const accessor = workspace as { readonly get?: <T = unknown>(target: string) => T | undefined }
  if (typeof accessor.get === 'function') {
    let deferredError: unknown = undefined
    for (const candidate of candidates) {
      try {
        const value = accessor.get(candidate)
        if (value !== undefined) {
          return value
        }
      } catch (error) {
        if (!candidate.startsWith('conimg.')) {
          if (deferredError === undefined) {
            deferredError = error
          }
        }
      }
    }
    if (deferredError !== undefined) {
      throw deferredError
    }
    return undefined
  }

  if (typeof workspace === 'object' && workspace) {
    for (const candidate of candidates) {
      if (Object.prototype.hasOwnProperty.call(workspace, candidate)) {
        return (workspace as Record<string, unknown>)[candidate]
      }
    }

    for (const candidate of candidates) {
      const resolved = candidate.split('.').reduce<unknown>((current, segment) => {
        if (!current || typeof current !== 'object') {
          return undefined
        }
        if (!(segment in (current as Record<string, unknown>))) {
          return undefined
        }
        return (current as Record<string, unknown>)[segment]
      }, workspace as Record<string, unknown>)
      if (resolved !== undefined) {
        return resolved
      }
    }
  }

  return undefined
}

export interface MergeThresholdSnapshot {
  readonly precision: MergePrecision
  readonly threshold: number | undefined
}

export interface MergeThresholdSourceOptions {
  readonly precision?: MergePrecision | null
  readonly threshold?: number | null
  readonly workspace?: WorkspaceConfiguration | null
  readonly storage?: MergeThresholdStorage
  readonly flags?: Pick<FlagSnapshot, 'merge'> | null
}

export interface MergeThresholdEnvironment {
  readonly resolveFlags: (input: {
    readonly workspace: WorkspaceConfiguration | null
    readonly storage: MergeThresholdStorage
  }) => Pick<FlagSnapshot, 'merge'>
  readonly readEnvPrecision: () => string | undefined
  readonly logger?: Pick<Console, 'warn'> | null
}

const readDefaultEnvPrecision = (): string | undefined => {
  const metaCandidate = (() => {
    const meta = import.meta as ImportMeta & { env?: Record<string, unknown> }
    const raw = meta.env?.VITE_MERGE_PRECISION
    return typeof raw === 'string' ? raw : undefined
  })()
  if (metaCandidate) {
    return metaCandidate
  }
  const nodeProcess =
    typeof globalThis === 'object'
      ? ((globalThis as { process?: { env?: Record<string, unknown> } }).process ?? null)
      : null
  const processCandidate = nodeProcess?.env?.VITE_MERGE_PRECISION
  return typeof processCandidate === 'string' ? processCandidate : undefined
}

const defaultEnvironment: MergeThresholdEnvironment = {
  resolveFlags: ({ workspace, storage }) => resolveFlags({ workspace, storage }),
  readEnvPrecision: readDefaultEnvPrecision,
  logger: console,
}

export const resolveMergeThresholdSnapshot = (
  options: MergeThresholdSourceOptions = {},
  environment: MergeThresholdEnvironment = defaultEnvironment,
): MergeThresholdSnapshot => {
  const workspace = options.workspace ?? null
  const storage = options.storage ?? null
  const snapshot: Pick<FlagSnapshot, 'merge'> =
    options.flags ?? environment.resolveFlags({ workspace, storage })
  const envPrecision = parseMergePrecision(environment.readEnvPrecision())
  const precision = options.precision ?? envPrecision ?? snapshot.merge.precision
  const envOverrides = envPrecision !== undefined && options.precision === undefined && options.threshold === undefined
  const defaultThreshold = resolveMergeThresholdPlan(precision, undefined).request

  const finalize = (value: number): MergeThresholdSnapshot => ({
    precision,
    threshold: clampThresholdToPrecisionMinimum(precision, value),
  })

  const overrideThreshold = parseMergeThreshold(options.threshold)
  if (overrideThreshold !== undefined) {
    return finalize(overrideThreshold)
  }

  const flagThreshold = parseMergeThreshold(snapshot.merge.threshold)

  if (envOverrides) {
    if (flagThreshold !== undefined) {
      return finalize(flagThreshold)
    }
    return finalize(defaultThreshold)
  }

  if (flagThreshold !== undefined) {
    return finalize(flagThreshold)
  }

  const workspaceValue = readWorkspaceSetting(workspace, MERGE_THRESHOLD_STORAGE_KEY)
  const workspaceThreshold = parseMergeThreshold(workspaceValue as ParseThresholdInput)
  if (workspaceThreshold !== undefined) {
    return finalize(workspaceThreshold)
  }

  let storedThresholdRaw: string | null | undefined
  if (storage) {
    try {
      storedThresholdRaw = storage.getItem(MERGE_THRESHOLD_STORAGE_KEY)
    } catch (error) {
      const logger = environment.logger
      if (logger && typeof logger.warn === 'function') {
        logger.warn(
          'MergeDock: failed to read merge threshold from localStorage.',
          MERGE_THRESHOLD_STORAGE_KEY,
          error,
        )
      }
    }
  }
  const storedThreshold = parseMergeThreshold(storedThresholdRaw)
  if (storedThreshold !== undefined) {
    return finalize(storedThreshold)
  }

  return finalize(defaultThreshold)
}

export interface MergeThresholdHookOptions extends MergeThresholdSourceOptions {
  readonly environment?: MergeThresholdEnvironment | null
}

export const useMergeThreshold = (
  options: MergeThresholdHookOptions = {},
): MergeThresholdSnapshot => {
  const environment = options.environment ?? defaultEnvironment
  const fallbackStorage: MergeThresholdStorage =
    typeof window !== 'undefined' ? window.localStorage : null
  const storage = options.storage ?? fallbackStorage
  const workspace = options.workspace ?? null
  const providedFlags = options.flags ?? null
  const snapshot = useMemo<Pick<FlagSnapshot, 'merge'>>(
    () => providedFlags ?? environment.resolveFlags({ workspace, storage }),
    [providedFlags, environment, workspace, storage],
  )

  return useMemo(
    () =>
      resolveMergeThresholdSnapshot(
        {
          ...options,
          precision: options.precision ?? snapshot.merge.precision,
          workspace,
          storage,
          flags: snapshot,
        },
        environment,
      ),
    [
      options.precision,
      options.threshold,
      workspace,
      storage,
      snapshot,
      snapshot.merge.precision,
      snapshot.merge.threshold,
      environment,
    ],
  )
}
