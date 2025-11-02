import { clamp, PRECISION_CONFIG } from './profile';
import {
  computeCosine,
  computeJaccard,
  tokenize,
  type MergeSection,
} from './sections';
import type {
  MergeScoringInput,
  MergeScoringMetrics,
  MergeScoringStrategy,
  ResolvedMergeProfile,
} from './types';

export const blendedScore = (
  metrics: { jaccard: number; cosine: number },
  profile: ResolvedMergeProfile,
): number => {
  const weights = PRECISION_CONFIG[profile.precision].weights;
  const historyBoost = 0;
  return clamp(weights.jaccard * metrics.jaccard + weights.cosine * metrics.cosine + historyBoost, 0, 1);
};

export const scoreSection = (
  section: MergeSection,
  profile: ResolvedMergeProfile,
  scoring: MergeScoringStrategy,
): MergeScoringMetrics => {
  const tokens: MergeScoringInput = {
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
