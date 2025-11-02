import { attachAutoSaveLockEvents } from './events';
import { buildMergePlan, createQueueMergeCommand } from './plan';
import { resolveProfile } from './profile-resolver';
import { DEFAULT_SCORING_STRATEGY, scoreSection } from './scoring';
import { splitSections, type MergeSection } from './sections';
import type {
  MergeDecision,
  MergeDecisionEvent,
  MergeEngine,
  MergeEngineOptions,
  MergeErrorCode,
  MergeHunk,
  MergePlanBand,
  MergePlanRecommendedCommand,
  MergeResult,
  MergeScoringMetrics,
  MergeStats,
  MergeTrace,
  MergeTraceEntry,
  ResolvedMergeProfile,
} from './types';

export class MergeError extends Error {
  readonly code: MergeErrorCode;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(code: MergeErrorCode, message: string, options: { retryable: boolean; cause?: unknown }) {
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

const now = (): number => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};

const ensureNotAborted = (signal?: AbortSignal): void => {
  if (!signal) {
    return;
  }
  if (!signal.aborted) {
    return;
  }
  const reason = (signal as { reason?: unknown }).reason;
  const code =
    reason === 'timeout' || (typeof reason === 'object' && reason !== null && (reason as { name?: string }).name === 'TimeoutError')
      ? 'timeout'
      : 'aborted';
  throw new MergeError(code, code === 'timeout' ? 'Merge operation timed out.' : 'Merge operation was aborted.', {
    retryable: false,
    cause: reason,
  });
};

const decideSection = (
  section: MergeSection,
  metrics: MergeScoringMetrics,
  profile: ResolvedMergeProfile,
): SectionDecision => {
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
    ? prefer === 'ai'
      ? section.ai
      : section.manual
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
  } satisfies MergeHunk;
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
  } satisfies SectionDecision;
};

const aggregateStats = (hunks: readonly SectionDecision[]): MergeStats => {
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
  } satisfies MergeStats;
};

const assembleMergedText = (hunks: readonly SectionDecision[]): string => {
  return hunks.map((entry) => entry.hunk.merged).join('\n\n');
};

const buildTrace = (
  sceneId: string | undefined,
  stages: readonly MergeTraceEntry[],
  profile: ResolvedMergeProfile,
  hunks?: readonly MergeHunk[],
): MergeTrace => {
  const decisions = (hunks ?? []).map((hunk) => ({
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
  } satisfies MergeTrace;
};

export const DEFAULT_MERGE_ENGINE: MergeEngine = {
  merge3: (input, options) => {
    const detachAutoSaveLock = attachAutoSaveLockEvents(options?.events);
    try {
      const startedAt = now();
      ensureNotAborted(options?.abortSignal);
      const profile = resolveProfile(options?.profile);
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
        const eventType: MergeDecisionEvent['type'] = 'merge:hunk-decision';
        options?.telemetry?.({ type: eventType, sceneId: input.sceneId ?? 'unknown', profile, hunk: decision.hunk });
        if (options?.events) {
          const event: MergeDecisionEvent = {
            type: decision.hunk.decision === 'auto' ? 'merge:auto-applied' : 'merge:conflict-detected',
            hunk: decision.hunk,
            sceneId: input.sceneId ?? 'unknown',
            retryable: decision.hunk.decision !== 'auto',
            trace: buildTrace(input.sceneId, stages, profile, decisions.map((entry) => entry.hunk)),
          } satisfies MergeDecisionEvent;
          options.events.publish(event);
        }
      }
      stages.push({ stage: 'decide', startedAt: scoreStart, durationMs: now() - scoreStart, metadata: { hunks: decisions.length } });

      const stats = aggregateStats(decisions);
      const mergedText = assembleMergedText(decisions);
      const processingMillis = now() - startedAt;
      const finalStats: MergeStats = { ...stats, processingMillis } satisfies MergeStats;
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
      } satisfies MergeResult;

      options?.telemetry?.({ type: 'merge:finish', sceneId: input.sceneId ?? 'unknown', profile, stats: finalStats, trace: finalTrace });

      return mergeResult;
    } finally {
      detachAutoSaveLock?.();
    }
  },
  resolveProfile,
  score: DEFAULT_SCORING_STRATEGY,
};

