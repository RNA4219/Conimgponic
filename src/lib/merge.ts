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

export type MergePrecision = 'legacy' | 'beta' | 'stable';

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

interface MergeSection {
  readonly id: string;
  readonly label: string;
  readonly base: string;
  readonly manual: string;
  readonly ai: string;
  readonly prefer: MergePreference;
  readonly locked: boolean;
}

interface SectionDecision {
  readonly hunk: MergeHunk;
  readonly similarity: number;
  readonly locked: boolean;
  readonly band: MergePlanBand;
  readonly recommendedCommand: MergePlanRecommendedCommand;
}

const PRECISION_FALLBACK: MergePrecision = 'legacy';

const PRECISION_CONFIG: Record<MergePrecision, {
  readonly min: number;
  readonly autoDelta: (threshold: number) => number;
  readonly reviewDelta: (threshold: number) => number;
  readonly weights: { readonly jaccard: number; readonly cosine: number };
  readonly lockPolicy: 'strict' | 'advisory';
}> = {
  legacy: {
    min: 0.65,
    autoDelta: (threshold) => threshold + 0.08,
    reviewDelta: (threshold) => threshold - 0.04,
    weights: { jaccard: 0.5, cosine: 0.5 },
    lockPolicy: 'strict',
  },
  beta: {
    min: 0.75,
    autoDelta: (threshold) => clamp(threshold + 0.05, 0.8, 0.92),
    reviewDelta: (threshold) => threshold - 0.02,
    weights: { jaccard: 0.4, cosine: 0.6 },
    lockPolicy: 'strict',
  },
  stable: {
    min: 0.82,
    autoDelta: (threshold) => clamp(threshold + 0.03, 0.86, 0.95),
    reviewDelta: (threshold) => threshold - 0.01,
    weights: { jaccard: 0.3, cosine: 0.7 },
    lockPolicy: 'strict',
  },
};

const DEFAULT_MAX_PROCESSING_MILLIS = 5_000;
const DEFAULT_SECTION_SIZE_HINT = 640;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function normalizePrecision(value?: string | null): MergePrecision {
  if (!value) {
    return PRECISION_FALLBACK;
  }
  const normalized = value.toLowerCase();
  if (normalized === 'beta' || normalized === 'stable' || normalized === 'legacy') {
    return normalized;
  }
  return PRECISION_FALLBACK;
}

function resolvePrecision(overrides?: Partial<MergeProfile>): MergePrecision {
  const envPrecision = typeof process !== 'undefined' && typeof process.env !== 'undefined'
    ? process.env.MERGE_PRECISION
    : undefined;
  const candidate = (overrides as { precision?: string })?.precision ?? envPrecision;
  return normalizePrecision(candidate ?? undefined);
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
    retryable: code === 'timeout',
    cause: reason,
  });
}

function splitSections(input: MergeInput, profile: ResolvedMergeProfile): readonly MergeSection[] {
  const manualSections = tokenSections(input.ours);
  const aiSections = tokenSections(input.theirs);
  const baseSections = tokenSections(input.base);
  const labels = input.sections ?? [];
  const descriptors = new Map((input.sectionDescriptors ?? []).map((descriptor) => [descriptor.id, descriptor]));
  const sections: MergeSection[] = [];
  const maxLength = Math.max(manualSections.length, aiSections.length, baseSections.length);

  for (let index = 0; index < maxLength; index += 1) {
    const label = labels[index] ?? `section-${index + 1}`;
    const descriptor = descriptors.get(label);
    const prefer = (input.locks?.get(label) ?? descriptor?.preferred ?? profile.prefer) ?? 'none';
    sections.push({
      id: label,
      label,
      base: baseSections[index] ?? '',
      manual: manualSections[index] ?? '',
      ai: aiSections[index] ?? '',
      prefer,
      locked: input.locks?.has(label) ?? false,
    });
  }
  return sections;
}

function tokenSections(text: string): readonly string[] {
  return text.split(/\r?\n\r?\n/).map((section) => section.trim()).filter((section, index, arr) => section.length > 0 || index === arr.length - 1);
}

function tokenize(text: string, tokenizer: MergeTokenizer): readonly string[] {
  if (!text) {
    return [];
  }
  switch (tokenizer) {
    case 'char':
      return Array.from(text);
    case 'word':
      return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    case 'morpheme':
      return text.toLowerCase().match(/[\p{L}\p{N}]{1,2}/gu) ?? [];
    default:
      return Array.from(text);
  }
}

function computeJaccard(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 1;
  }
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  leftSet.forEach((token) => {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  });
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function computeCosine(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 1;
  }
  const leftFreq = frequency(left);
  const rightFreq = frequency(right);
  const shared = new Set([...leftFreq.keys(), ...rightFreq.keys()]);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  shared.forEach((token) => {
    const l = leftFreq.get(token) ?? 0;
    const r = rightFreq.get(token) ?? 0;
    dot += l * r;
  });
  leftFreq.forEach((value) => {
    leftMagnitude += value * value;
  });
  rightFreq.forEach((value) => {
    rightMagnitude += value * value;
  });
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function frequency(tokens: readonly string[]): Map<string, number> {
  const freq = new Map<string, number>();
  tokens.forEach((token) => {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  });
  return freq;
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
  const prefer = section.locked ? (profile.lockPolicy === 'strict' ? section.prefer : section.prefer) : section.prefer;
  const merged = decision === 'auto'
    ? (prefer === 'ai' ? section.ai : prefer === 'manual' ? section.manual : section.manual)
    : section.base;
  const hunk: MergeHunk = {
    id: section.id,
    section: section.label,
    decision,
    similarity,
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

function buildPlan(decisions: readonly SectionDecision[], profile: ResolvedMergeProfile): MergePlan {
  const entries: MergePlanEntry[] = decisions.map((decision) => ({
    hunkId: decision.hunk.id,
    section: decision.hunk.section,
    decision: decision.hunk.decision,
    similarity: decision.hunk.similarity,
    locked: decision.locked,
    band: decision.band,
    phase: decision.band === 'auto' ? 'phase-a' : 'phase-b',
    recommendedCommand: decision.recommendedCommand,
  }));
  const phaseA = entries.filter((entry) => entry.phase === 'phase-a').length;
  const reviewBand = entries.filter((entry) => entry.band === 'review').length;
  const locked = entries.filter((entry) => entry.locked).length;
  const phaseBCount = entries.length - phaseA;
  const reasons = new Set<MergePlanPhaseBReason>();
  entries.forEach((entry) => {
    if (entry.locked) {
      reasons.add('locked-conflict');
      return;
    }
    if (entry.band === 'review') {
      reasons.add('review-band');
      return;
    }
    if (entry.phase === 'phase-b') {
      reasons.add('low-similarity');
    }
  });
  const required = profile.precision !== 'legacy' && phaseBCount > 0;
  return {
    precision: profile.precision,
    entries,
    summary: {
      total: entries.length,
      phaseA,
      phaseB: phaseBCount,
      reviewBand,
      locked,
    },
    phaseB: {
      required,
      reasons: Array.from(reasons),
    },
  };
}

function buildTrace(sceneId: string | undefined, stages: readonly MergeTraceEntry[]): MergeTrace {
  return {
    sceneId: sceneId ?? 'unknown',
    entries: stages,
  };
}

const resolveProfileInternal = (overrides?: Partial<MergeProfile>): ResolvedMergeProfile => {
  const precision = resolvePrecision(overrides);
  const baseProfile: MergeProfile = {
    tokenizer: overrides?.tokenizer ?? DEFAULT_MERGE_PROFILE.tokenizer,
    granularity: overrides?.granularity ?? DEFAULT_MERGE_PROFILE.granularity,
    threshold: overrides?.threshold ?? DEFAULT_MERGE_PROFILE.threshold,
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
  threshold: 0.75,
  prefer: 'none',
  seed: undefined,
  precision: 'legacy',
  minAutoThreshold: 0.75,
  maxProcessingMillis: DEFAULT_MAX_PROCESSING_MILLIS,
  similarityBands: {
    auto: 0.83,
    review: 0.71,
  },
  lockPolicy: 'strict',
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
          trace: buildTrace(input.sceneId, stages),
        };
        options.events.publish(event);
      }
    }
    stages.push({ stage: 'decide', startedAt: scoreStart, durationMs: now() - scoreStart, metadata: { hunks: decisions.length } });

    const stats = aggregateStats(decisions);
    const plan = buildPlan(decisions, profile);
    const mergedText = assembleMergedText(decisions);
    const processingMillis = now() - startedAt;
    const finalStats: MergeStats = { ...stats, processingMillis };
    const emitStart = now();
    stages.push({ stage: 'emit', startedAt: emitStart, durationMs: now() - emitStart, metadata: { events: decisions.length } });
    const finalTrace = buildTrace(input.sceneId, stages);

    options?.telemetry?.({ type: 'merge:finish', sceneId: input.sceneId ?? 'unknown', profile, stats: finalStats, trace: finalTrace });

    return { hunks: decisions.map((entry) => entry.hunk), mergedText, stats: finalStats, trace: finalTrace, plan };
  },
  resolveProfile: resolveProfileInternal,
  score: DEFAULT_SCORING_STRATEGY,
};
