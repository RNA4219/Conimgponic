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

import type { ProjectLockLease } from './locks';
import { projectLockEvents } from './locks';

import {
  clamp,
  DEFAULT_THRESHOLD,
  PRECISION_CONFIG,
  PRECISION_FALLBACK,
  resolvePrecision,
  resolveThreshold,
} from './merge/profile';
import {
  computeCosine,
  computeJaccard,
  splitSections,
  tokenize,
  type MergeSection,
} from './merge/sections';

export { PRECISION_THRESHOLD_CLAMP } from './merge/profile';

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

export interface MergePlan {
  readonly precision: MergePrecision;
  readonly entries: readonly MergePlanEntry[];
  readonly summary: MergePlanSummary;
  readonly phaseB: MergePlanPhaseB;
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

interface Day8CollectorLike {
  publish(event: Record<string, unknown>): void;
}

const AUTO_SAVE_LOCK_ATTACHED = Symbol('merge.autosave.lock.attached');
const LAST_COLLECTOR_STAGES = new Map<string, 'acquired' | 'released'>();

const resolveDay8Collector = (): Day8CollectorLike | undefined => {
  const scope = globalThis as { Day8Collector?: unknown };
  const candidate = scope.Day8Collector as { publish?: unknown } | undefined;
  return candidate && typeof candidate.publish === 'function'
    ? (candidate as Day8CollectorLike)
    : undefined;
};

const publishAutoSaveLockCollectorEvent = (
  stage: 'acquired' | 'released',
  lease: ProjectLockLease,
): void => {
  const previousStage = LAST_COLLECTOR_STAGES.get(lease.leaseId);
  if (previousStage === stage) {
    return;
  }
  LAST_COLLECTOR_STAGES.set(lease.leaseId, stage);
  if (stage === 'released') {
    queueMicrotask(() => {
      if (LAST_COLLECTOR_STAGES.get(lease.leaseId) === 'released') {
        LAST_COLLECTOR_STAGES.delete(lease.leaseId);
      }
    });
  }
  const collector = resolveDay8Collector();
  if (!collector) return;
  collector.publish({
    feature: 'merge.autosave',
    event: 'autosave.lock',
    stage,
    lease: {
      id: lease.leaseId,
      owner: lease.ownerId,
      strategy: lease.strategy,
      via_fallback: lease.viaFallback,
      resource: lease.resource,
    },
  });
};

export const attachAutoSaveLockEvents = (events?: MergeEventHub): (() => void) | undefined => {
  if (!events && !resolveDay8Collector()) {
    return undefined;
  }
  const autoSaveAwareEvents = events as (MergeEventHub & {
    [AUTO_SAVE_LOCK_ATTACHED]?: boolean;
  }) | undefined;
  if (autoSaveAwareEvents?.[AUTO_SAVE_LOCK_ATTACHED]) {
    return undefined;
  }
  if (autoSaveAwareEvents) {
    autoSaveAwareEvents[AUTO_SAVE_LOCK_ATTACHED] = true;
  }
  const leases = new Map<string, ProjectLockLease>();
  const publish = (stage: 'acquired' | 'released', lease: ProjectLockLease): void => {
    events?.publish({ type: 'merge:autosave:lock', stage, lease });
    publishAutoSaveLockCollectorEvent(stage, lease);
  };
  const unsubscribe = projectLockEvents.subscribe((event) => {
    if (event.type === 'lock:acquired') {
      leases.set(event.lease.leaseId, event.lease);
      publish('acquired', event.lease);
      return;
    }
    if (event.type === 'lock:released') {
      const lease = leases.get(event.leaseId);
      if (lease) {
        leases.delete(event.leaseId);
        publish('released', lease);
      }
    }
  });
  return () => {
    leases.clear();
    unsubscribe();
    if (autoSaveAwareEvents) {
      delete autoSaveAwareEvents[AUTO_SAVE_LOCK_ATTACHED];
    }
  };
};

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
}

export interface MergeDecisionError {
  readonly code: 'locked-conflict' | 'score-underflow' | 'aborted';
  readonly message: string;
  readonly retryable: boolean;
  readonly sceneId: string;
  readonly precision: MergePrecision;
}

export type MergePlanResult =
  | { readonly kind: 'ok'; readonly plan: MergePlan }
  | { readonly kind: 'error'; readonly error: MergeDecisionError; readonly plan: MergePlan };

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

const PRECISION_PRESENTATION: Record<MergePrecision, MergeUiPrecisionState> = {
  legacy: {
    badge: 'Legacy',
    description: '従来スコアリング（閾値固定）',
    allowsAutoApply: true,
    requiresReview: false,
  },
  beta: {
    badge: 'Beta',
    description: '改良スコアリング（段階レビュー）',
    allowsAutoApply: true,
    requiresReview: true,
  },
  stable: {
    badge: 'Stable',
    description: '安定版スコアリング（厳格適用）',
    allowsAutoApply: false,
    requiresReview: true,
  },
};

export const getPrecisionUiState = (precision: MergePrecision): MergeUiPrecisionState =>
  PRECISION_PRESENTATION[precision];

export const buildMergePlan = (
  hunks: readonly MergeHunk[],
  stats: MergeStats,
  profile: ResolvedMergeProfile,
  sceneId?: string,
): MergePlanResult => {
  const precisionState = getPrecisionUiState(profile.precision);
  const hasUnderflow = hunks.some((hunk) => hunk.similarity < profile.similarityBands.review);
  const planEntries = hunks.map<MergePlanEntry>((hunk) => {
    const locked = hunk.locked;
    const meetsReviewBand = hunk.similarity >= profile.similarityBands.review;
    const band: MergePlanBand = hunk.decision === 'auto'
      ? 'auto'
      : locked
        ? 'conflict'
        : meetsReviewBand
          ? 'review'
          : 'conflict';
    const phase: MergePlanPhase = band === 'auto' && precisionState.allowsAutoApply && !locked ? 'phase-a' : 'phase-b';
    const recommendedCommand: MergePlanRecommendedCommand = locked
      ? 'queue:force-lock-resolution'
      : band === 'auto'
        ? precisionState.allowsAutoApply
          ? 'queue:auto-apply'
          : 'queue:request-review'
        : band === 'review'
          ? 'queue:request-review'
          : 'queue:manual-intervention';
    return {
      hunkId: hunk.id,
      section: hunk.section,
      decision: hunk.decision,
      similarity: hunk.similarity,
      locked,
      band,
      phase,
      recommendedCommand,
    };
  });

  const phaseATotal = planEntries.filter((entry) => entry.phase === 'phase-a').length;
  const summary: MergePlanSummary = {
    total: planEntries.length,
    phaseA: phaseATotal,
    phaseB: planEntries.length - phaseATotal,
    reviewBand: planEntries.filter((entry) => entry.band === 'review').length,
    locked: planEntries.filter((entry) => entry.locked).length,
  };

  const phaseBReasons = new Set<MergePlanPhaseBReason>();
  if (planEntries.some((entry) => entry.band === 'review')) {
    phaseBReasons.add('review-band');
  }
  if (planEntries.some((entry) => entry.locked && entry.band === 'conflict')) {
    phaseBReasons.add('locked-conflict');
  }
  if (planEntries.some((entry) => entry.band === 'conflict' && !entry.locked)) {
    phaseBReasons.add('low-similarity');
  }

  const phaseB: MergePlanPhaseB = {
    required: summary.phaseB > 0,
    reasons: summary.phaseB > 0 ? Array.from(phaseBReasons) : [],
  };

  const planHunks = planEntries.map<MergePlanHunk>((entry, index) => {
    const sourceHunk = hunks[index];
    return {
      id: entry.hunkId,
      section: entry.section,
      decision: entry.decision,
      similarity: entry.similarity,
      locked: entry.locked,
      preferred: sourceHunk?.prefer ?? 'none',
      queueAction: entry.recommendedCommand === 'queue:auto-apply' ? 'apply' : 'hold',
    };
  });

  const plan: MergePlan = {
    sceneId: sceneId ?? 'unknown',
    precision: profile.precision,
    stats,
    hunks: planHunks,
    stages: ['segment', 'score', 'decide', 'queue'],
    entries: planEntries,
    summary,
    phaseB,
  };

  if (hasUnderflow && profile.precision !== 'legacy') {
    return {
      kind: 'error',
      error: {
        code: 'score-underflow',
        message: 'スコアがレビュー帯域を下回りました。',
        retryable: true,
        sceneId: sceneId ?? 'unknown',
        precision: profile.precision,
      },
      plan,
    };
  }

  return { kind: 'ok', plan };
};

export const createQueueMergeCommand = (plan: MergePlan): MergeQueueCommand => ({
  type: 'merge:enqueue',
  sceneId: plan.sceneId,
  precision: plan.precision,
  hunks: plan.hunks,
});

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

interface SectionDecision {
  readonly hunk: MergeHunk;
  readonly similarity: number;
  readonly locked: boolean;
  readonly band: MergePlanBand;
  readonly recommendedCommand: MergePlanRecommendedCommand;
}

const DEFAULT_MAX_PROCESSING_MILLIS = 5_000;
const DEFAULT_SECTION_SIZE_HINT = 640;

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}
 
function ensureNotAborted(signal?: AbortSignal): void {
  if (!signal) {
    return;
  }
  if (!signal.aborted) {
    return;
  }
  const reason = (signal as { reason?: unknown }).reason;
  const code = reason === 'timeout' || (typeof reason === 'object' && reason !== null && (reason as { name?: string }).name === 'TimeoutError')
    ? 'timeout'
    : 'aborted';
  throw new MergeError(code, code === 'timeout' ? 'Merge operation timed out.' : 'Merge operation was aborted.', {
    retryable: false,
    cause: reason,
  });
}

function blendedScore(metrics: { jaccard: number; cosine: number }, profile: ResolvedMergeProfile): number {
  const weights = PRECISION_CONFIG[profile.precision].weights;
  const historyBoost = 0;
  return clamp(weights.jaccard * metrics.jaccard + weights.cosine * metrics.cosine + historyBoost, 0, 1);
}

function scoreSection(section: MergeSection, profile: ResolvedMergeProfile, scoring: MergeScoringStrategy): MergeScoringMetrics {
  const tokens = {
    baseTokens: tokenize(section.base, profile.tokenizer),
    manualTokens: tokenize(section.manual, profile.tokenizer),
    aiTokens: tokenize(section.ai, profile.tokenizer),
  };
  const metrics = scoring(tokens, profile);
  return {
    jaccard: clamp(metrics.jaccard, 0, 1),
    cosine: clamp(metrics.cosine, 0, 1),
    blended: clamp(metrics.blended, 0, 1),
  };
}

function decideSection(section: MergeSection, metrics: MergeScoringMetrics, profile: ResolvedMergeProfile): SectionDecision {
  const similarity = metrics.blended;
  const autoThreshold = profile.similarityBands.auto;
  const minThreshold = profile.minAutoThreshold;
  const reviewThreshold = profile.similarityBands.review;
  const isLocked = section.locked && profile.lockPolicy === 'strict';
  let decision: MergeDecision = 'conflict';
  let band: MergePlanBand = 'conflict';
  if (!isLocked) {
    if (similarity >= autoThreshold && similarity >= minThreshold) {
      decision = 'auto';
      band = 'auto';
    } else if (similarity >= reviewThreshold) {
      band = 'review';
    }
  }
  const prefer = section.prefer;
  const merged = decision === 'auto'
    ? (prefer === 'ai' ? section.ai : section.manual)
    : section.base;
  const hunk: MergeHunk = {
    id: section.id,
    section: section.label,
    decision,
    similarity,
    locked: section.locked,
    merged,
    manual: section.manual,
    ai: section.ai,
    base: section.base,
    prefer,
  };
  const recommendedCommand: MergePlanRecommendedCommand = decision === 'auto'
    ? 'queue:auto-apply'
    : isLocked
      ? 'queue:force-lock-resolution'
      : band === 'review'
        ? 'queue:request-review'
        : 'queue:manual-intervention';
  return {
    hunk,
    similarity,
    locked: isLocked,
    band,
    recommendedCommand,
  };
}

function aggregateStats(hunks: readonly SectionDecision[]): MergeStats {
  const total = hunks.length;
  const auto = hunks.filter((entry) => entry.hunk.decision === 'auto').length;
  const conflict = total - auto;
  const locked = hunks.filter((entry) => entry.locked).length;
  const ai = hunks.filter((entry) => entry.hunk.decision === 'auto' && entry.hunk.prefer === 'ai').length;
  const averageSimilarity = total === 0 ? 0 : hunks.reduce((sum, entry) => sum + entry.hunk.similarity, 0) / total;
  return {
    autoDecisions: auto,
    conflictDecisions: conflict,
    averageSimilarity,
    processingMillis: 0,
    lockedDecisions: locked,
    aiDecisions: ai,
  };
}

function assembleMergedText(hunks: readonly SectionDecision[]): string {
  return hunks.map((entry) => entry.hunk.merged).join('\n\n');
}

function buildTrace(
  sceneId: string | undefined,
  stages: readonly MergeTraceEntry[],
  profile: ResolvedMergeProfile,
  hunks?: readonly MergeHunk[],
): MergeTrace {
  const decisions = (hunks ?? []).map<MergeTraceDecisionEntry>((hunk) => ({
    hunkId: hunk.id,
    section: hunk.section,
    decision: hunk.decision,
    similarity: hunk.similarity,
    threshold: profile.threshold,
  }));
  const total = decisions.length;
  const auto = decisions.filter((entry) => entry.decision === 'auto').length;
  const autoAdoptionRate = total === 0 ? 1 : auto / total;
  return {
    sceneId: sceneId ?? 'unknown',
    entries: stages,
    decisions,
    summary: {
      threshold: profile.threshold,
      autoAdoptionRate,
    },
  };
}

const resolveProfileInternal = (overrides?: MergeProfileOverrides): ResolvedMergeProfile => {
  const precision = resolvePrecision(overrides);
  const threshold = resolveThreshold(precision, overrides);
  const baseProfile: MergeProfile = {
    tokenizer: overrides?.tokenizer ?? DEFAULT_MERGE_PROFILE.tokenizer,
    granularity: overrides?.granularity ?? DEFAULT_MERGE_PROFILE.granularity,
    threshold,
    prefer: overrides?.prefer ?? DEFAULT_MERGE_PROFILE.prefer,
    seed: overrides?.seed ?? DEFAULT_MERGE_PROFILE.seed,
  };
  const config = PRECISION_CONFIG[precision];
  const minAutoThreshold = Math.max(baseProfile.threshold, config.min);
  const similarityBands = {
    auto: config.autoDelta(baseProfile.threshold),
    review: config.reviewDelta(baseProfile.threshold),
  };
  return {
    ...baseProfile,
    precision,
    minAutoThreshold,
    maxProcessingMillis: DEFAULT_MAX_PROCESSING_MILLIS,
    similarityBands,
    lockPolicy: config.lockPolicy,
    sectionSizeHint: DEFAULT_SECTION_SIZE_HINT,
  };
};

export const DEFAULT_MERGE_PROFILE: ResolvedMergeProfile = {
  tokenizer: 'char',
  granularity: 'section',
  threshold: DEFAULT_THRESHOLD,
  prefer: 'none',
  seed: undefined,
  precision: PRECISION_FALLBACK,
  minAutoThreshold: Math.max(DEFAULT_THRESHOLD, PRECISION_CONFIG[PRECISION_FALLBACK].min),
  maxProcessingMillis: DEFAULT_MAX_PROCESSING_MILLIS,
  similarityBands: {
    auto: PRECISION_CONFIG[PRECISION_FALLBACK].autoDelta(DEFAULT_THRESHOLD),
    review: PRECISION_CONFIG[PRECISION_FALLBACK].reviewDelta(DEFAULT_THRESHOLD),
  },
  lockPolicy: PRECISION_CONFIG[PRECISION_FALLBACK].lockPolicy,
  sectionSizeHint: DEFAULT_SECTION_SIZE_HINT,
};

export const DEFAULT_SCORING_STRATEGY: MergeScoringStrategy = (input, profile) => {
  const manualVsAiJaccard = computeJaccard(input.manualTokens, input.aiTokens);
  const manualVsAiCosine = computeCosine(input.manualTokens, input.aiTokens);
  const blended = blendedScore({ jaccard: manualVsAiJaccard, cosine: manualVsAiCosine }, profile);
  return {
    jaccard: manualVsAiJaccard,
    cosine: manualVsAiCosine,
    blended,
  };
};

export const DEFAULT_MERGE_ENGINE: MergeEngine = {
  merge3: (input, options) => {
    const detachAutoSaveLock = attachAutoSaveLockEvents(options?.events);
    try {
      const startedAt = now();
      ensureNotAborted(options?.abortSignal);
      const profile = resolveProfileInternal(options?.profile);
      options?.telemetry?.({ type: 'merge:start', sceneId: input.sceneId ?? 'unknown', profile });
      const stages: MergeTraceEntry[] = [];

      const segmentStart = now();
      const sections = splitSections(input, profile);
      stages.push({ stage: 'segment', startedAt: segmentStart, durationMs: now() - segmentStart, metadata: { sections: sections.length } });

      const decisions: SectionDecision[] = [];
      ensureNotAborted(options?.abortSignal);
      const scoreStart = now();
      for (const section of sections) {
        ensureNotAborted(options?.abortSignal);
        const metrics = scoreSection(section, profile, options?.scoring ?? DEFAULT_SCORING_STRATEGY);
        const decisionStart = now();
        const decision = decideSection(section, metrics, profile);
        decisions.push(decision);
        stages.push({ stage: 'score', startedAt: decisionStart, durationMs: now() - decisionStart, metadata: { section: section.id, metrics } });
        const eventType: MergeTelemetryEvent['type'] = 'merge:hunk-decision';
        options?.telemetry?.({ type: eventType, sceneId: input.sceneId ?? 'unknown', profile, hunk: decision.hunk });
        if (options?.events) {
          const event: MergeDecisionEvent = {
            type: decision.hunk.decision === 'auto' ? 'merge:auto-applied' : 'merge:conflict-detected',
            hunk: decision.hunk,
            sceneId: input.sceneId ?? 'unknown',
            retryable: decision.hunk.decision !== 'auto',
            trace: buildTrace(input.sceneId, stages, profile, decisions.map((entry) => entry.hunk)),
          };
          options.events.publish(event);
        }
      }
      stages.push({ stage: 'decide', startedAt: scoreStart, durationMs: now() - scoreStart, metadata: { hunks: decisions.length } });

      const stats = aggregateStats(decisions);
      const mergedText = assembleMergedText(decisions);
      const processingMillis = now() - startedAt;
      const finalStats: MergeStats = { ...stats, processingMillis };
      const emitStart = now();
      stages.push({ stage: 'emit', startedAt: emitStart, durationMs: now() - emitStart, metadata: { events: decisions.length } });
      const hunks = decisions.map((entry) => entry.hunk);

      const planResult = buildMergePlan(hunks, finalStats, profile, input.sceneId);
      let includePlan = planResult.kind === 'ok';
      if (options?.queueMergeCommand) {
        const queueStartedAt = now();
        if (planResult.kind === 'ok') {
          options.queueMergeCommand(createQueueMergeCommand(planResult.plan));
          stages.push({
            stage: 'queue',
            startedAt: queueStartedAt,
            durationMs: now() - queueStartedAt,
            metadata: { hunks: planResult.plan.hunks.length, precision: planResult.plan.precision },
          });
        } else {
          stages.push({
            stage: 'queue',
            startedAt: queueStartedAt,
            durationMs: now() - queueStartedAt,
            metadata: { error: planResult.error.code, retryable: planResult.error.retryable },
          });
          includePlan = false;
        }
      } else if (planResult.kind === 'error' && planResult.error.code === 'score-underflow') {
        includePlan = true;
      }

      const finalTrace = buildTrace(input.sceneId, stages, profile, hunks);
      const mergeResult: MergeResult = {
        hunks,
        mergedText,
        stats: finalStats,
        trace: finalTrace,
        ...(includePlan ? { plan: planResult.plan } : {}),
      };

      options?.telemetry?.({ type: 'merge:finish', sceneId: input.sceneId ?? 'unknown', profile, stats: finalStats, trace: finalTrace });

      return mergeResult;
    } finally {
      detachAutoSaveLock?.();
    }
  },
  resolveProfile: resolveProfileInternal,
  score: DEFAULT_SCORING_STRATEGY,
};
