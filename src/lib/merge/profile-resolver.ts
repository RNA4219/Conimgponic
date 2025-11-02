import {
  DEFAULT_THRESHOLD,
  PRECISION_CONFIG,
  PRECISION_FALLBACK,
  resolvePrecision,
  resolveThreshold,
} from './profile';
import type { MergeProfile, MergeProfileOverrides, ResolvedMergeProfile } from './types';

export const DEFAULT_MAX_PROCESSING_MILLIS = 5_000;
export const DEFAULT_SECTION_SIZE_HINT = 640;

export const resolveProfile = (overrides?: MergeProfileOverrides): ResolvedMergeProfile => {
  const precision = resolvePrecision(overrides);
  const threshold = resolveThreshold(precision, overrides);
  const baseProfile: MergeProfile = {
    tokenizer: overrides?.tokenizer ?? DEFAULT_MERGE_PROFILE.tokenizer,
    granularity: overrides?.granularity ?? DEFAULT_MERGE_PROFILE.granularity,
    threshold,
    prefer: overrides?.prefer ?? DEFAULT_MERGE_PROFILE.prefer,
    seed: overrides?.seed ?? DEFAULT_MERGE_PROFILE.seed,
  } satisfies MergeProfile;
  const config = PRECISION_CONFIG[precision];
  const minAutoThreshold = Math.max(baseProfile.threshold, config.min);
  const similarityBands = {
    auto: config.autoDelta(baseProfile.threshold),
    review: config.reviewDelta(baseProfile.threshold),
  } as const;
  return {
    ...baseProfile,
    precision,
    minAutoThreshold,
    maxProcessingMillis: DEFAULT_MAX_PROCESSING_MILLIS,
    similarityBands,
    lockPolicy: config.lockPolicy,
    sectionSizeHint: DEFAULT_SECTION_SIZE_HINT,
  } satisfies ResolvedMergeProfile;
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

