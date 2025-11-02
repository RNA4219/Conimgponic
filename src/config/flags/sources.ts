import type {
  FlagDefinition,
  FlagSource,
  FlagValidationError,
  ResolveOptions,
  WorkspaceConfiguration
} from './schema'

export const defaultEnv = (() => {
  const metaEnvSource = (import.meta as ImportMeta & { env?: unknown }).env
  const metaEnv: Record<string, unknown> =
    metaEnvSource && typeof metaEnvSource === 'object'
      ? (metaEnvSource as Record<string, unknown>)
      : {}
  const nodeProcess =
    typeof globalThis === 'object'
      ? ((globalThis as { process?: { env?: Record<string, unknown> } }).process ?? null)
      : null
  if (nodeProcess?.env) {
    return {
      ...nodeProcess.env,
      ...metaEnv
    }
  }
  return metaEnv
})()

const readDefaultStorage = (): Pick<Storage, 'getItem'> | null => {
  const scope = globalThis as { localStorage?: Storage }
  const storage = scope.localStorage
  if (storage && typeof storage.getItem === 'function') {
    return { getItem: storage.getItem.bind(storage) }
  }
  return null
}

export const selectStorage = (
  storageOption: ResolveOptions['storage'] | undefined
): Pick<Storage, 'getItem'> | null => {
  if (storageOption === undefined) {
    return readDefaultStorage()
  }
  if (storageOption === null) {
    return null
  }
  return storageOption
}

export const WORKSPACE_KEY_PREFIX = 'conimg.' as const

export const workspaceKeyCandidates = (key: string): readonly string[] => {
  if (key.startsWith(WORKSPACE_KEY_PREFIX)) {
    const trimmed = key.slice(WORKSPACE_KEY_PREFIX.length)
    if (trimmed) {
      return [key, trimmed]
    }
    return [key]
  }
  if (key) {
    return [key, `${WORKSPACE_KEY_PREFIX}${key}`]
  }
  return [key]
}

export function readWorkspaceValue(
  workspace: WorkspaceConfiguration | null | undefined,
  key: string
): unknown {
  if (!workspace) {
    return undefined
  }

  const candidates = workspaceKeyCandidates(key)

  const withGetter = workspace as {
    readonly get?: <T = unknown>(candidate: string) => T | undefined
  }
  if (typeof withGetter.get === 'function') {
    for (const candidate of candidates) {
      try {
        const value = withGetter.get(candidate)
        if (value !== undefined) {
          return value
        }
      } catch (error) {
        if (!candidate.startsWith(WORKSPACE_KEY_PREFIX)) {
          throw error
        }
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
    const resolved = candidate
      .split('.')
      .reduce<unknown>((current, segment) => {
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

export const attemptResolveFromWorkspace = <T>(
  workspace: WorkspaceConfiguration | null | undefined,
  def: FlagDefinition<T>,
  errors: FlagValidationError[]
): T | null => {
  if (!def.workspaceKey) {
    return null
  }

  const rawValue = readWorkspaceValue(workspace, def.workspaceKey)
  if (rawValue == null) {
    return null
  }

  return attemptResolve(rawValue, 'workspace', def, errors)
}

export const attemptResolve = <T>(
  rawValue: unknown,
  source: FlagSource,
  def: FlagDefinition<T>,
  errors: FlagValidationError[]
): T | null => {
  if (rawValue == null) {
    return null
  }
  const raw = String(rawValue).trim()
  if (!raw) {
    return null
  }

  if (!def.coerce) {
    return raw as unknown as T
  }

  const coerced = def.coerce(raw)
  if (coerced.ok) {
    return coerced.value
  }

  errors.push({ ...coerced.error, source, phase: def.phase })
  return null
}
