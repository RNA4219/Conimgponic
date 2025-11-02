export * from './types';

export { attachAutoSaveLockEvents } from './events';
export { DEFAULT_MERGE_ENGINE, MergeError } from './engine';
export {
  DEFAULT_MAX_PROCESSING_MILLIS,
  DEFAULT_MERGE_PROFILE,
  DEFAULT_SECTION_SIZE_HINT,
  resolveProfile,
} from './profile-resolver';
export {
  clamp,
  DEFAULT_THRESHOLD,
  PRECISION_CONFIG,
  PRECISION_FALLBACK,
  PRECISION_THRESHOLD_CLAMP,
  resolvePrecision,
  resolveThreshold,
} from './profile';
export {
  buildMergePlan,
  createQueueMergeCommand,
  getPrecisionUiState,
} from './plan';
export { DEFAULT_SCORING_STRATEGY } from './scoring';
export { computeCosine, computeJaccard, splitSections, tokenSections, tokenize } from './sections';

