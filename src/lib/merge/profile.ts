import type { MergePrecision, MergeProfileOverrides } from './types';

export type PrecisionThresholdClamp = { readonly min: number; readonly max?: number };

const DEFAULT_THRESHOLD = 0.75;
const PRECISION_FALLBACK: MergePrecision = 'legacy';

const DEFAULT_MAX_CLAMP = 0.99;

type MaybeNodeProcess = { readonly env?: Record<string, string | undefined> };

const readEnvVar = (key: string): string | undefined => {
  const scope = globalThis as typeof globalThis & { process?: MaybeNodeProcess };
  return scope.process?.env?.[key];
};

export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

const normalizePrecision = (value?: string | null): MergePrecision => {
  if (!value) {
    return PRECISION_FALLBACK;
  }
  const normalized = value.toLowerCase();
  if (normalized === 'beta' || normalized === 'stable' || normalized === 'legacy') {
    return normalized;
  }
  return PRECISION_FALLBACK;
};

const parseThreshold = (value?: string | null): number | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return undefined;
};

export const PRECISION_THRESHOLD_CLAMP: Record<MergePrecision, PrecisionThresholdClamp> = {
  legacy: { min: 0.65 },
  beta: { min: 0.75, max: 0.9 },
  stable: { min: 0.82, max: 0.94 },
} as const;

export const PRECISION_CONFIG: Record<MergePrecision, {
  readonly min: number;
  readonly autoDelta: (threshold: number) => number;
  readonly reviewDelta: (threshold: number) => number;
  readonly weights: { readonly jaccard: number; readonly cosine: number };
  readonly lockPolicy: 'strict' | 'advisory';
  readonly thresholdClamp: (value: number) => number;
}> = {
  legacy: {
    min: PRECISION_THRESHOLD_CLAMP.legacy.min,
    autoDelta: (threshold) => threshold + 0.08,
    reviewDelta: (threshold) => threshold - 0.04,
    weights: { jaccard: 0.5, cosine: 0.5 },
    lockPolicy: 'strict',
    thresholdClamp: (value) => Math.max(value, PRECISION_THRESHOLD_CLAMP.legacy.min),
  },
  beta: {
    min: PRECISION_THRESHOLD_CLAMP.beta.min,
    autoDelta: (threshold) => clamp(threshold + 0.05, 0.8, 0.92),
    reviewDelta: (threshold) => threshold - 0.02,
    weights: { jaccard: 0.4, cosine: 0.6 },
    lockPolicy: 'strict',
    thresholdClamp: (value) => clamp(value, PRECISION_THRESHOLD_CLAMP.beta.min, PRECISION_THRESHOLD_CLAMP.beta.max ?? DEFAULT_MAX_CLAMP),
  },
  stable: {
    min: PRECISION_THRESHOLD_CLAMP.stable.min,
    autoDelta: (threshold) => clamp(threshold + 0.03, 0.86, 0.95),
    reviewDelta: (threshold) => threshold - 0.01,
    weights: { jaccard: 0.3, cosine: 0.7 },
    lockPolicy: 'strict',
    thresholdClamp: (value) => clamp(value, PRECISION_THRESHOLD_CLAMP.stable.min, PRECISION_THRESHOLD_CLAMP.stable.max ?? DEFAULT_MAX_CLAMP),
  },
};

export const resolvePrecision = (overrides?: MergeProfileOverrides): MergePrecision => {
  const envPrecision = readEnvVar('MERGE_PRECISION');
  const candidate = overrides?.precision ?? envPrecision;
  return normalizePrecision(candidate ?? undefined);
};

export const resolveThreshold = (
  precision: MergePrecision,
  overrides?: MergeProfileOverrides,
): number => {
  const config = PRECISION_CONFIG[precision];
  const overrideValue = overrides?.threshold;
  const envThreshold = parseThreshold(readEnvVar('CONIMG_MERGE_THRESHOLD') ?? null);
  const base = overrideValue ?? envThreshold ?? DEFAULT_THRESHOLD;
  return config.thresholdClamp(base);
};

export { DEFAULT_THRESHOLD, PRECISION_FALLBACK };
