import type { MergeHunk, MergeResult, MergeInput, MergeProfileOverrides } from './types';
import { DEFAULT_MERGE_ENGINE } from './engine';
import type { MergeDockPhaseStats } from './phasePlan';

export interface DiffHunkFacadeOptions {
  readonly precision: 'beta' | 'stable';
  readonly threshold: number;
  readonly phaseStats?: MergeDockPhaseStats | null;
  readonly autoSaveEnabled: boolean;
}

export interface DiffHunkResult {
  readonly hunks: readonly MergeHunk[];
  readonly stats: {
    readonly autoDecisions: number;
    readonly conflictDecisions: number;
    readonly averageSimilarity: number;
    readonly processingMillis: number;
    readonly lockedDecisions: number;
    readonly aiDecisions: number;
  };
}

/**
 * Facade function that gets hunks and stats from the merge engine based on precision and phaseStats
 */
export function getDiffHunksFromEngine(
  options: DiffHunkFacadeOptions,
  input?: MergeInput
): DiffHunkResult {
  // Only generate hunks if precision is beta or stable and autosave is enabled
  if ((options.precision === 'beta' || options.precision === 'stable') && options.autoSaveEnabled) {
    // Use a default input if none provided for testing purposes
    const mergeInput: MergeInput = input || {
      base: 'Base content for merge',
      ours: 'Ours content for merge', 
      theirs: 'Theirs content for merge',
      sceneId: 'test-scene'
    };

    // Create the profile with the appropriate precision and threshold
    const profile: MergeProfileOverrides = {
      precision: options.precision,
      threshold: options.threshold
    };

    // Use the default merge engine to get the result
    const result: MergeResult = DEFAULT_MERGE_ENGINE.merge3(mergeInput, {
      profile
    });

    return {
      hunks: result.hunks,
      stats: result.stats
    };
  }

  // Return empty hunks if conditions are not met
  return {
    hunks: [],
    stats: {
      autoDecisions: 0,
      conflictDecisions: 0,
      averageSimilarity: 0,
      processingMillis: 0,
      lockedDecisions: 0,
      aiDecisions: 0
    }
  };
}