import type {
  AutoSavePhase,
  AutoSavePhaseGuardSnapshot,
  AutoSavePolicy,
  AutoSaveStatusState
} from '../../../lib/autosave.js';

export interface HistoryEntry {
  readonly generation: number;
  readonly bytes: number;
}

export interface InternalState {
  guard: AutoSavePhaseGuardSnapshot;
  lastSuccessAt?: string;
  retryCount: number;
  status: AutoSaveStatusState;
  reqCounter: number;
  correlationCounter: number;
  history: HistoryEntry[];
  retainedBytes: number;
  forceDisabled: boolean;
  flushStartedAtMs?: number;
}

export const createInitialState = (
  guard: AutoSavePhaseGuardSnapshot
): InternalState => ({
  guard,
  lastSuccessAt: undefined,
  retryCount: 0,
  status: 'disabled',
  reqCounter: 0,
  correlationCounter: 0,
  history: [],
  retainedBytes: 0,
  forceDisabled: false,
  flushStartedAtMs: undefined
});

export const isGuardEnabled = (guard: AutoSavePhaseGuardSnapshot): boolean =>
  guard.featureFlag.value && !guard.optionsDisabled;

export const mergeGuard = (
  previous: AutoSavePhaseGuardSnapshot,
  incoming: AutoSavePhaseGuardSnapshot,
  forceDisabled: boolean
): AutoSavePhaseGuardSnapshot =>
  forceDisabled
    ? { featureFlag: incoming.featureFlag, optionsDisabled: true }
    : incoming;

export const resolveGuardBlockedReason = (
  guard: AutoSavePhaseGuardSnapshot
): 'feature-flag-disabled' | 'options-disabled' =>
  guard.featureFlag.value ? 'options-disabled' : 'feature-flag-disabled';

export const statusPhaseForState = (state: AutoSaveStatusState): AutoSavePhase => {
  switch (state) {
    case 'disabled':
      return 'disabled';
    case 'dirty':
      return 'debouncing';
    case 'saving':
      return 'awaiting-lock';
    case 'saved':
      return 'idle';
    case 'error':
      return 'error';
    case 'backoff':
      return 'backoff';
  }
};

export const sumBytes = (entries: readonly HistoryEntry[]): number =>
  entries.reduce((acc, entry) => acc + entry.bytes, 0);

export const clampHistory = (
  state: InternalState,
  policy: AutoSavePolicy
): void => {
  const entries = [...state.history];
  while (entries.length > policy.maxGenerations) entries.shift();
  let retained = sumBytes(entries);
  while (retained > policy.maxBytes && entries.length > 0) {
    entries.shift();
    retained = sumBytes(entries);
  }
  state.history = entries;
  state.retainedBytes = retained;
};

export const computeFlushLatencyMs = (
  state: InternalState,
  nowMs: number
): number => {
  const startedAt = state.flushStartedAtMs;
  if (typeof startedAt !== 'number') {
    return 0;
  }
  return Math.max(0, nowMs - startedAt);
};

export const nextReqId = (state: InternalState): string => `autosave-${++state.reqCounter}`;

export const nextCorrelationId = (state: InternalState): string =>
  `autosave-corr-${++state.correlationCounter}`;

export const computeLagSeconds = (
  lastSuccessAt: string | undefined,
  timestamp: string
): number | undefined => {
  if (!lastSuccessAt) {
    return undefined;
  }
  const last = Date.parse(lastSuccessAt);
  const current = Date.parse(timestamp);
  if (
    !Number.isFinite(last) ||
    Number.isNaN(last) ||
    !Number.isFinite(current) ||
    Number.isNaN(current)
  ) {
    return undefined;
  }
  const diffMs = current - last;
  if (!Number.isFinite(diffMs) || Number.isNaN(diffMs) || diffMs < 0) {
    return undefined;
  }
  return Math.max(0, Math.floor(diffMs / 1000));
};
