// AutoSave 環境用の VSCode 拡張連携フラグのモジュール雛形

export interface FlagResolutionEventPayload {
  flag: string
  value: any
  source: 'env' | 'default'
  timestamp?: number
}

type FlagsShape = {
  enableAutoSave: boolean
  mergePrecision: number
}

export const DEFAULT_FLAGS: FlagsShape = {
  enableAutoSave: true,
  mergePrecision: 0.95,
}

// Workspace の設定を解決して返す
export function resolveWorkspaceFlags(): FlagsShape {
  const flags: FlagsShape = { ...DEFAULT_FLAGS }

  // Access process.env safely for browser/VSCode compatibility
  const globalScope = globalThis as Record<string, unknown>
  const proc = globalScope.process as Record<string, unknown> | undefined
  const procEnv = proc?.env as Record<string, unknown> | undefined

  const envVal = procEnv?.VIBE_AUTO_SAVE
  if (envVal !== undefined) {
    flags.enableAutoSave = String(envVal).toLowerCase() === 'true' || envVal === '1'
  }

  const prm = procEnv?.VIBE_MERGE_PRECISION
  if (prm !== undefined) {
    const n = Number(prm)
    if (!Number.isNaN(n)) {
      flags.mergePrecision = n
    }
  }

  return flags
}

// Collector 連携用のペイロードを生成するサンプル関数
export function collectFlagResolutionPayloads(): Array<FlagResolutionEventPayload> {
  const f = resolveWorkspaceFlags()
  const payloads: Array<FlagResolutionEventPayload> = []
  payloads.push({ flag: 'enableAutoSave', value: f.enableAutoSave, source: 'default', timestamp: Date.now() })
  payloads.push({ flag: 'mergePrecision', value: f.mergePrecision, source: 'default', timestamp: Date.now() })
  return payloads
}

// AutoSave ブートストラップのためのシンプル payload を作成
export function createAutoSaveBootstrapPayload(): any {
  const f = resolveWorkspaceFlags()
  return {
    bootstrap: {
      flags: f,
      time: new Date().toISOString(),
    },
  }
}

// Type aliases for compatibility
export type AutoSaveBootstrapPayload = ReturnType<typeof createAutoSaveBootstrapPayload>
export type ResolveWorkspaceFlagsOptions = Record<string, unknown>

// Placeholder implementations for compatibility
export function resolveWorkspaceBootstrapPayload(): AutoSaveBootstrapPayload {
  return createAutoSaveBootstrapPayload()
}

export function deriveAutoSavePhaseGuard(): { allowed: boolean; guard: { featureFlag: { value: boolean; source: string }; optionsDisabled: boolean } } {
  const flags = resolveWorkspaceFlags()
  return {
    allowed: flags.enableAutoSave,
    guard: {
      featureFlag: { value: flags.enableAutoSave, source: 'default' },
      optionsDisabled: false
    }
  }
}
