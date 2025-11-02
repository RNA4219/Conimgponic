import type {
  MergeHunk,
  MergePlan,
  MergePlanBand,
  MergePlanEntry,
  MergePlanHunk,
  MergePlanPhase,
  MergePlanPhaseB,
  MergePlanPhaseBReason,
  MergePlanRecommendedCommand,
  MergePlanResult,
  MergePlanSummary,
  MergePrecision,
  MergeQueueCommand,
  MergeStats,
  MergeUiPrecisionState,
  ResolvedMergeProfile,
} from './types';

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
    } satisfies MergePlanEntry;
  });

  const phaseATotal = planEntries.filter((entry) => entry.phase === 'phase-a').length;
  const summary: MergePlanSummary = {
    total: planEntries.length,
    phaseA: phaseATotal,
    phaseB: planEntries.length - phaseATotal,
    reviewBand: planEntries.filter((entry) => entry.band === 'review').length,
    locked: planEntries.filter((entry) => entry.locked).length,
  } satisfies MergePlanSummary;

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
  } satisfies MergePlanPhaseB;

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
    } satisfies MergePlanHunk;
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
  } satisfies MergePlan;

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
    } satisfies MergePlanResult;
  }

  return { kind: 'ok', plan } satisfies MergePlanResult;
};

export const createQueueMergeCommand = (plan: MergePlan): MergeQueueCommand => ({
  type: 'merge:enqueue',
  sceneId: plan.sceneId,
  precision: plan.precision,
  hunks: plan.hunks,
});

