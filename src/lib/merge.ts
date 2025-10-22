/**
 * 精緻マージ API 仕様定義。
 *
 * `docs/MERGE-DESIGN-IMPL.md` の性能要件と決定プロセスに基づく。
 *
 * ### 決定フローチャート
 * ```mermaid
 * flowchart TD
 *   Start([merge3]) --> Seg[セクション分割]
 *   Seg --> Score[類似度スコアリング]
 *   Score -->|>=profile.threshold| Auto[自動適用]
 *   Score -->|<profile.threshold & !lock| Review[手動レビュー]
 *   Score -->|<profile.minAutoThreshold or lock| Conflict[衝突確定]
 *   Auto --> EmitStats[統計・トレース更新]
 *   Review --> EmitStats
 *   Conflict --> EmitStats
 *   EmitStats --> End([結果組立])
 * ```
 *
 * ### テストシナリオ（先行定義）
 * - auto: lock 無し、`similarity>=threshold` のハッピーパス（統計・トレース更新を含む）
 * - conflict: `similarity<minAutoThreshold` で手動介入、スコアと決定ログの整合性を検証
 * - lock: `locks` で強制されたセクションが `decision='conflict'` になることを確認
 */

export type MergeTokenizer = 'char' | 'word' | 'morpheme';

export type MergeGranularity = 'section' | 'line';

export type MergePreference = 'manual' | 'ai' | 'none';

export interface MergeProfile {
  readonly tokenizer: MergeTokenizer;
  readonly granularity: MergeGranularity;
  readonly threshold: number;
  readonly prefer: MergePreference;
  readonly seed?: string;
}

export interface MergeSectionDescriptor {
  readonly id: string;
  readonly label: string;
  readonly range: readonly [number, number];
  readonly preferred?: MergePreference;
}

export interface ResolvedMergeProfile extends MergeProfile {
  readonly minAutoThreshold: number;
  readonly maxProcessingMillis: number;
  readonly similarityBands: {
    readonly auto: number;
    readonly review: number;
  };
  readonly lockPolicy: 'strict' | 'advisory';
  readonly sectionSizeHint: number;
}

export interface MergeInput {
  readonly base: string;
  readonly ours: string;
  readonly theirs: string;
  readonly sections?: readonly string[];
  readonly sectionDescriptors?: readonly MergeSectionDescriptor[];
  readonly locks?: ReadonlyMap<string, MergePreference>;
  readonly sceneId?: string;
}

export type MergeDecision = 'auto' | 'conflict';

export interface MergeHunk {
  readonly id: string;
  readonly section: string | null;
  readonly decision: MergeDecision;
  readonly similarity: number;
  readonly merged: string;
  readonly manual: string;
  readonly ai: string;
  readonly base: string;
  readonly prefer: MergePreference;
}

export interface MergeStats {
  readonly autoDecisions: number;
  readonly conflictDecisions: number;
  readonly averageSimilarity: number;
  readonly processingMillis: number;
  readonly lockedDecisions: number;
  readonly aiDecisions: number;
}

export interface MergeResult {
  readonly hunks: readonly MergeHunk[];
  readonly mergedText: string;
  readonly stats: MergeStats;
  readonly trace: MergeTrace;
}

export interface MergeScoringInput {
  readonly baseTokens: readonly string[];
  readonly manualTokens: readonly string[];
  readonly aiTokens: readonly string[];
}

export interface MergeScoringMetrics {
  readonly jaccard: number;
  readonly cosine: number;
  readonly blended: number;
}

export type MergeScoringStrategy = (
  input: MergeScoringInput,
  profile: ResolvedMergeProfile,
) => MergeScoringMetrics;

export interface MergeTelemetryEvent {
  readonly type: 'merge:start' | 'merge:finish' | 'merge:hunk-decision';
  readonly sceneId: string;
  readonly profile: ResolvedMergeProfile;
  readonly stats?: MergeStats;
  readonly hunk?: MergeHunk;
  readonly trace?: MergeTrace;
}

export type MergeTelemetrySink = (event: MergeTelemetryEvent) => void;

export interface MergeDecisionEvent {
  readonly type: 'merge:auto-applied' | 'merge:conflict-detected';
  readonly hunk: MergeHunk;
  readonly sceneId: string;
  readonly retryable: boolean;
  readonly trace: MergeTrace;
}

export type MergeDecisionListener = (event: MergeDecisionEvent) => void;

export interface MergeEventHub {
  readonly publish: (event: MergeDecisionEvent) => void;
  readonly subscribe: (listener: MergeDecisionListener) => () => void;
}

export interface MergeEngineOptions {
  readonly profile?: Partial<MergeProfile>;
  readonly scoring?: MergeScoringStrategy;
  readonly telemetry?: MergeTelemetrySink;
  readonly events?: MergeEventHub;
  readonly abortSignal?: AbortSignal;
}

export interface MergeEngine {
  readonly merge3: (input: MergeInput, options?: MergeEngineOptions) => MergeResult;
  readonly resolveProfile: (overrides?: Partial<MergeProfile>) => ResolvedMergeProfile;
  readonly score: MergeScoringStrategy;
}

export interface MergeTraceEntry {
  readonly stage: 'segment' | 'score' | 'decide' | 'emit';
  readonly startedAt: number;
  readonly durationMs: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MergeTrace {
  readonly sceneId: string;
  readonly entries: readonly MergeTraceEntry[];
}

export class MergeError extends Error {
  readonly code: 'timeout' | 'aborted';
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(code: 'timeout' | 'aborted', message: string, options: { retryable: boolean; cause?: unknown }) {
    super(message);
    this.code = code;
    this.retryable = options.retryable;
    this.cause = options.cause;
    this.name = 'MergeError';
  }
}

export const DEFAULT_MERGE_PROFILE: ResolvedMergeProfile = {
  tokenizer: 'char',
  granularity: 'section',
  threshold: 0.75,
  prefer: 'none',
  seed: undefined,
  minAutoThreshold: 0.7,
  maxProcessingMillis: 5_000,
  similarityBands: {
    auto: 0.85,
    review: 0.7,
  },
  lockPolicy: 'strict',
  sectionSizeHint: 640,
};

export const DEFAULT_SCORING_STRATEGY: MergeScoringStrategy = () => {
  throw new MergeError('aborted', 'Merge scoring is not implemented.', { retryable: false });
};

export const DEFAULT_MERGE_ENGINE: MergeEngine = {
  merge3: () => {
    throw new MergeError('aborted', 'Merge engine is not implemented.', { retryable: false });
  },
  resolveProfile: () => DEFAULT_MERGE_PROFILE,
  score: DEFAULT_SCORING_STRATEGY,
};
