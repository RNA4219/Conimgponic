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

  const envVal = process.env.VIBE_AUTO_SAVE
  if (envVal !== undefined) {
    flags.enableAutoSave = envVal.toLowerCase() === 'true' || envVal === '1'
  }

  const prm = process.env.VIBE_MERGE_PRECISION
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
