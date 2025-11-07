import type { FlagSnapshot } from '../config/flags'

// 型定義
export type MergePreference = 'manual' | 'ai' | 'none'

export type MergePrecision = 'legacy' | 'beta' | 'stable'

export type MergePlanPhase = 'disabled' | 'idle' | 'awaiting-lock' | 'locked' | 'saving' | 'saved' | 'readonly' | 'error'

export interface MergeProfileOverrides {
  threshold?: number
  prefer?: MergePreference
  precision?: MergePrecision
}

export interface MergeTrace {
  runId: string
  profile: MergeProfile
  hunks: MergeHunk[]
  stats: MergeStats
}

export class MergeError extends Error {
  readonly retryable: boolean
  readonly code: string

  constructor(message: string, code: string, retryable: boolean = true) {
    super(message)
    this.name = 'MergeError'
    this.code = code
    this.retryable = retryable
  }
}

export const PRECISION_THRESHOLD_CLAMP = {
  beta: { min: 0.75 },
  stable: { min: 0.82 },
} as const

export interface MergeProfile {
  tokenizer: 'char' | 'word' | 'morpheme'
  granularity: 'section' | 'line'
  threshold: number
  prefer: MergePreference
  seed?: string
}

export interface MergeInput {
  base: string
  ours: string
  theirs: string
  sections?: string[]
  locks?: ReadonlyMap<string, MergePreference>
  sceneId?: string
}

export interface MergeHunk {
  id: string
  section: string | null
  decision: 'auto' | 'conflict'
  similarity: number
  merged: string
  manual: string
  ai: string
  base: string
  prefer: MergePreference
}

export interface MergeStats {
  autoDecisions: number
  conflictDecisions: number
  averageSimilarity: number
  processingMillis: number
}

export interface MergeResult {
  hunks: MergeHunk[]
  mergedText: string
  stats: MergeStats
  trace?: MergeTrace
}

export interface MergeDecisionEvent {
  type: 'merge:auto-applied' | 'merge:conflict-detected' | 'merge:autosave:lock'
  hunk?: MergeHunk
  lease?: any
  stage?: 'acquired' | 'released'
  retryable?: boolean
}

export interface MergeDecisionListener {
  (event: MergeDecisionEvent): void
}

export interface MergeEventHub {
  publish: (event: MergeDecisionEvent) => void
  subscribe: (listener: (event: MergeDecisionEvent) => void) => () => void
}

export interface ProjectLockLease {
  readonly leaseId: string;
  readonly ownerId: string;
  readonly strategy: string;
  readonly viaFallback: boolean;
  readonly resource: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
  readonly ttlMillis: number;
  readonly heartbeatIntervalMs: number;
  readonly nextHeartbeatAt: number;
  readonly renewAttempt: number;
}

export const attachAutoSaveLockEvents = (hub: MergeEventHub): (() => void) => {
  // AutoSaveのロックイベントを購読するための処理
  // 実際にはAutoSaveのロック状態を監視して、マージ処理に影響を与える
  return () => {
    // クリーンアップ処理
  }
}

export type MergeQueueCommandPayload = any

export type QueueMergeCommand = (payload: MergeQueueCommandPayload) => Promise<any>

export interface MergeEngine {
  merge3: (input: MergeInput, options?: MergeOptions) => MergeResult
  resolveProfile?: (precision: MergePrecision, overrides?: MergeProfileOverrides) => MergeProfile
}

export interface MergeOptions {
  profile?: Partial<MergeProfile>
  events?: MergeEventHub
  queueMergeCommand?: (command: any) => void
}

// 既定値
const DEFAULT_PROFILE: MergeProfile = {
  tokenizer: 'char',
  granularity: 'section',
  threshold: 0.75,
  prefer: 'none'
}

// セクションを検出する関数
const detectSections = (text: string): string[] => {
  // セクションラベル（[主語]...）または空行で分割
  const lines = text.split('\n')
  const sections: string[] = []
  let currentSection = ''
  
  for (const line of lines) {
    if (line.trim().startsWith('[') || line.trim() === '') {
      if (currentSection.trim() !== '') {
        sections.push(currentSection)
        currentSection = ''
      }
    }
    currentSection += line + '\n'
  }
  
  if (currentSection.trim() !== '') {
    sections.push(currentSection)
  }
  
  return sections.length > 0 ? sections : [text]
}

// 類似度を計算する関数（Jaccard係数の簡易版）
const computeSimilarity = (text1: string, text2: string): number => {
  if (text1 === text2) return 1
  if (!text1 && !text2) return 1
  if (!text1 || !text2) return 0
  
  // シンプルなトークン化
  const tokenize = (text: string): string[] => 
    text
      .toLowerCase()
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length > 0)
  
  const tokens1 = tokenize(text1)
  const tokens2 = tokenize(text2)
  
  if (tokens1.length === 0 && tokens2.length === 0) return 1
  if (tokens1.length === 0 || tokens2.length === 0) return 0
  
  const set1 = new Set(tokens1)
  const set2 = new Set(tokens2)
  
  const intersection = [...set1].filter(token => set2.has(token)).length
  const union = new Set([...set1, ...set2]).size
  
  return union === 0 ? 0 : intersection / union
}

// マージを実行する関数
export const merge3 = (input: MergeInput, options?: MergeOptions): MergeResult => {
  const start = performance.now()
  
  // プロファイルを統合
  const profile: MergeProfile = {
    ...DEFAULT_PROFILE,
    ...options?.profile
  }
  
  // セクションを取得（指定がなければ検出）
  const sections = input.sections || detectSections(input.base)
  
  // 各セクションでマージを実行
  const hunks: MergeHunk[] = sections.map((section, index) => {
    // セクションIDを生成
    const id = `${input.sceneId || 'scene'}-${index}`
    
    // ロックを確認
    const locked = input.locks?.has(id)
    const lockPrefer = locked ? input.locks!.get(id)! : null
    
    // 類似度を計算
    const similarity = computeSimilarity(input.ours, input.theirs)
    
    // 決定を下す
    let decision: 'auto' | 'conflict' = 'conflict'
    let prefer: MergePreference = lockPrefer || profile.prefer
    
    if (lockPrefer) {
      // ロックがあればそれを優先
      decision = 'auto'
    } else if (similarity >= profile.threshold) {
      // 閾値以上であれば自動採用
      decision = 'auto'
    }
    
    // 結合テキストを決定
    let merged = decision === 'auto' ? 
      (prefer === 'ai' ? input.theirs : input.ours) : 
      input.ours || input.theirs
    
    return {
      id,
      section: section || null,
      decision,
      similarity,
      merged,
      manual: input.ours,
      ai: input.theirs,
      base: input.base,
      prefer
    }
  })
  
  // 統計を計算
  const autoDecisions = hunks.filter(h => h.decision === 'auto').length
  const conflictDecisions = hunks.length - autoDecisions
  const averageSimilarity = hunks.reduce((sum, h) => sum + h.similarity, 0) / hunks.length || 0
  
  const end = performance.now()
  
  const stats: MergeStats = {
    autoDecisions,
    conflictDecisions,
    averageSimilarity,
    processingMillis: end - start
  }
  
  // すべてのハンクを結合したテキストを生成
  const mergedText = hunks.map(h => h.merged).join('\n\n')
  
  // 結果を返す
  return {
    hunks,
    mergedText,
    stats
  }
}

// 既定のマージエンジン
export const DEFAULT_MERGE_ENGINE: MergeEngine = {
  merge3
}

// マージエンジンからDiffのhunksを取得する関数
export const getDiffHunksFromEngine = (
  context: { precision: MergePrecision; threshold: number; phaseStats: any; autoSaveEnabled: boolean },
  input: MergeInput
): MergeResult => {
  return merge3(input, {
    profile: {
      threshold: context.threshold,
      precision: context.precision
    }
  })
}