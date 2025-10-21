export type MergeTokenizer = 'char' | 'word' | 'morpheme';
export type MergeGranularity = 'section' | 'line';
export type MergePrefer = 'manual' | 'ai' | 'none';
export type MergePrecision = 'legacy' | 'beta' | 'stable';

export interface MergeProfile { readonly tokenizer: MergeTokenizer; readonly granularity: MergeGranularity; readonly threshold: number; readonly prefer: MergePrefer; }

export const DEFAULT_MERGE_PROFILE: Readonly<MergeProfile> = Object.freeze({ tokenizer: 'char', granularity: 'section', threshold: 0.75, prefer: 'none' });

export interface MergeInput { readonly base: string; readonly ours: string; readonly theirs: string; readonly sections?: readonly string[]; }

export type MergeHunkDecision = 'auto' | 'conflict';

export interface MergeHunk { readonly section: string | null; readonly decision: MergeHunkDecision; readonly similarity?: number; readonly merged?: string; readonly manual?: string; readonly ai?: string; }

export interface MergeStats { readonly auto: number; readonly conflicts: number; readonly avgSim: number; }

export interface MergeResult { readonly hunks: readonly MergeHunk[]; readonly mergedText: string; readonly stats: MergeStats; }

export type MergeCommand =
  | { readonly type: 'setManual'; readonly hunkId: string }
  | { readonly type: 'setAI'; readonly hunkId: string }
  | { readonly type: 'commitManualEdit'; readonly hunkId: string; readonly text: string }
  | { readonly type: 'resetDecision'; readonly hunkId: string }
  | { readonly type: 'refreshStats' }
  | { readonly type: 'persistTrace'; readonly hunkIds?: readonly string[] };

export type MergeEvent =
  | { readonly type: 'merge:hunk:decision'; readonly hunkId: string; readonly decision: MergeHunkDecision }
  | { readonly type: 'merge:stats:refreshed'; readonly stats: MergeStats }
  | { readonly type: 'merge:trace:persisted'; readonly path: string }
  | { readonly type: 'merge:trace:error'; readonly error: MergeTraceError }
  | { readonly type: 'merge:autosave:lock'; readonly state: 'acquired' | 'released'; readonly leaseId: string };

export type MergeEventListener = (event: MergeEvent) => void;

export interface MergeEventBus { subscribe(listener: MergeEventListener): () => void; emit(event: MergeEvent): void; }

export type MergeErrorCode =
  | 'invalid-input'
  | 'tokenizer-failed'
  | 'profile-unsupported'
  | 'stats-divergence'
  | 'trace-write-failed';

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

export class MergeTraceError extends MergeError {
  readonly tracePath?: string;

  constructor(message: string, options: { retryable: boolean; cause?: unknown; tracePath?: string }) {
    super('trace-write-failed', message, options);
    this.tracePath = options.tracePath;
    this.name = 'MergeTraceError';
  }
}

export type MergeExecutor = (input: MergeInput, profile?: Partial<MergeProfile>) => MergeResult;

export const merge3: MergeExecutor = (input, profile) => {
  void input;
  void profile;
  throw new MergeError('invalid-input', 'merge3 is not implemented yet', { retryable: false });
};

export type MergeCommandQueue = (command: MergeCommand) => Promise<void>;
