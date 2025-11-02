export * from './types';
export { attachAutoSaveLockEvents } from './events';
export { buildMergePlan, createQueueMergeCommand, getPrecisionUiState } from './plan';
export { DEFAULT_MERGE_ENGINE, MergeError } from './engine';
export { DEFAULT_SCORING_STRATEGY, blendedScore, scoreSection } from './scoring';
export {
  DEFAULT_MERGE_PROFILE,
  DEFAULT_MAX_PROCESSING_MILLIS,
  DEFAULT_SECTION_SIZE_HINT,
  resolveProfile,
} from './profileResolver';
export {
  PRECISION_THRESHOLD_CLAMP,
  PRECISION_CONFIG,
  PRECISION_FALLBACK,
  DEFAULT_THRESHOLD,
  clamp,
  resolvePrecision,
  resolveThreshold,
} from './profile';
