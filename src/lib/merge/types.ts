import type { ProjectLockLease } from '../locks';

export type MergeTokenizer = 'char' | 'word' | 'morpheme';

export type MergeGranularity = 'section' | 'line';

export type MergePreference = 'manual' | 'ai' | 'none';

export type MergePrecision = 'legacy' | 'beta' | 'stable';

export interface MergeProfile {
  readonly tokenizer: MergeTokenizer;
  readonly granularity: MergeGranularity;
  readonly threshold: number;
  readonly prefer: MergePreference;
  readonly seed?: string;
}

export type MergeProfileOverrides = Partial<MergeProfile> & { readonly precision?: MergePrecision };

export interface MergeSectionDescriptor {
  readonly id: string;
  readonly label: string;
  readonly range: readonly [number, number];
  readonly preferred?: MergePreference;
}

export interface ResolvedMergeProfile extends MergeProfile {
  readonly precision: MergePrecision;
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
  readonly locked: boolean;
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

export interface MergeTraceEntry {
  readonly stage: 'segment' | 'score' | 'decide' | 'emit' | 'queue';
  readonly startedAt: number;
  readonly durationMs: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MergeTraceDecisionEntry {
  readonly hunkId: string;
  readonly section: string | null;
  readonly decision: MergeDecision;
  readonly similarity: number;
  readonly threshold: number;
}

export interface MergeTraceSummary {
  readonly threshold: number;
  readonly autoAdoptionRate: number;
}

export interface MergeTrace {
  readonly sceneId: string;
  readonly entries: readonly MergeTraceEntry[];
  readonly decisions: readonly MergeTraceDecisionEntry[];
  readonly summary: MergeTraceSummary;
}

export type MergePipelineStage = 'segment' | 'score' | 'decide' | 'queue';

export type MergePlanPhase = 'phase-a' | 'phase-b';

export type MergePlanBand = 'auto' | 'review' | 'conflict';

export type MergePlanRecommendedCommand =
  | 'queue:auto-apply'
  | 'queue:request-review'
  | 'queue:manual-intervention'
  | 'queue:force-lock-resolution';

export type MergePlanPhaseBReason = 'review-band' | 'locked-conflict' | 'low-similarity';

export interface MergePlanEntry {
  readonly hunkId: string;
  readonly section: string | null;
  readonly decision: MergeDecision;
  readonly similarity: number;
  readonly locked: boolean;
  readonly band: MergePlanBand;
  readonly phase: MergePlanPhase;
  readonly recommendedCommand: MergePlanRecommendedCommand;
}

export interface MergePlanSummary {
  readonly total: number;
  readonly phaseA: number;
  readonly phaseB: number;
  readonly reviewBand: number;
  readonly locked: number;
}

export interface MergePlanPhaseB {
  readonly required: boolean;
  readonly reasons: readonly MergePlanPhaseBReason[];
}

export interface MergePlanHunk {
  readonly id: string;
  readonly section: string | null;
  readonly decision: MergeDecision;
  readonly similarity: number;
  readonly locked: boolean;
  readonly preferred: MergePreference;
  readonly queueAction: 'apply' | 'hold';
}

export interface MergePlan {
  readonly sceneId: string;
  readonly precision: MergePrecision;
  readonly stats: MergeStats;
  readonly hunks: readonly MergePlanHunk[];
  readonly stages: readonly MergePipelineStage[];
  readonly entries: readonly MergePlanEntry[];
  readonly summary: MergePlanSummary;
  readonly phaseB: MergePlanPhaseB;
}

export type MergePlanResult =
  | { readonly kind: 'ok'; readonly plan: MergePlan }
  | { readonly kind: 'error'; readonly error: MergeDecisionError; readonly plan: MergePlan };

export interface MergeDecisionError {
  readonly code: 'locked-conflict' | 'score-underflow' | 'aborted';
  readonly message: string;
  readonly retryable: boolean;
  readonly sceneId: string;
  readonly precision: MergePrecision;
}

export type MergeErrorCode = 'timeout' | 'aborted';

export interface MergeQueueCommand {
  readonly type: 'merge:enqueue';
  readonly sceneId: string;
  readonly precision: MergePrecision;
  readonly hunks: readonly MergePlanHunk[];
}

export interface MergeUiPrecisionState {
  readonly badge: string;
  readonly description: string;
  readonly allowsAutoApply: boolean;
  readonly requiresReview: boolean;
}

export interface MergeResult {
  readonly hunks: readonly MergeHunk[];
  readonly mergedText: string;
  readonly stats: MergeStats;
  readonly trace: MergeTrace;
  readonly plan?: MergePlan;
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

export type MergeDecisionEvent =
  | {
      readonly type: 'merge:auto-applied' | 'merge:conflict-detected';
      readonly hunk: MergeHunk;
      readonly sceneId: string;
      readonly retryable: boolean;
      readonly trace: MergeTrace;
    }
  | {
      readonly type: 'merge:autosave:lock';
      readonly stage: 'acquired' | 'released';
      readonly lease: ProjectLockLease;
    };

export type MergeDecisionListener = (event: MergeDecisionEvent) => void;

export interface MergeEventHub {
  readonly publish: (event: MergeDecisionEvent) => void;
  readonly subscribe: (listener: MergeDecisionListener) => () => void;
}

export interface MergeEngineOptions {
  readonly profile?: MergeProfileOverrides;
  readonly scoring?: MergeScoringStrategy;
  readonly telemetry?: MergeTelemetrySink;
  readonly events?: MergeEventHub;
  readonly queueMergeCommand?: (command: MergeQueueCommand) => void;
  readonly abortSignal?: AbortSignal;
}

export interface MergeEngine {
  readonly merge3: (input: MergeInput, options?: MergeEngineOptions) => MergeResult;
  readonly resolveProfile: (overrides?: MergeProfileOverrides) => ResolvedMergeProfile;
  readonly score: MergeScoringStrategy;
}
