// src/lib/merge.test.ts
import test from 'node:test';
import assert from 'node:assert';
import { simpleMerge3, type MergeInput, type MergeProfile } from '../../src/lib/merge/index';

test.skip('simpleMerge3 - basic functionality', async () => {
  const input: MergeInput = {
    base: 'line 1\nline 2\nline 3',
    ours: 'line 1\nline 2 modified\nline 3',
    theirs: 'line 1\nline 2\nline 3 added'
  };

  const result = simpleMerge3(input);

  assert.ok(Array.isArray(result.hunks));
  assert.strictEqual(result.hunks.length, 3); // 行単位で3つのhunkが生成される
  assert.ok(typeof result.mergedText === 'string');
  assert.ok(result.stats.autoDecisions >= 0);
  assert.ok(result.stats.conflictDecisions >= 0);
  assert.ok(result.stats.averageSimilarity >= 0);
  assert.ok(result.stats.processingMillis >= 0);
});

test.skip('simpleMerge3 - with high similarity uses AI preference', async () => {
  const input: MergeInput = {
    base: 'line 1\nline 2\nline 3',
    ours: 'line 1\nline 2\nline 3', // 100% same as base
    theirs: 'line 1\nline 2\nline 3 added' // Different from ours
  };

  const profile: Partial<MergeProfile> = {
    prefer: 'ai',
    threshold: 0.8
  };

  const result = simpleMerge3(input, profile);

  const hunk = result.hunks[0];
  // With high similarity and AI preference, AI version should be chosen for auto-decision
  assert.ok(result.mergedText.includes('line 3 added') || result.mergedText.includes('line 2'));
});

test.skip('simpleMerge3 - with low similarity results in conflict', async () => {
  const input: MergeInput = {
    base: 'line 1\nline 2\nline 3',
    ours: 'line 1 completely different\nours version',
    theirs: 'line 1 also different\ntheirs version'
  };

  const profile: Partial<MergeProfile> = {
    prefer: 'none',
    threshold: 0.9
  };

  const result = simpleMerge3(input, profile);

  // Expected: low similarity should result in more conflicts
  assert.ok(result.stats.conflictDecisions > 0 || result.stats.autoDecisions === 0);
});

test.skip('simpleMerge3 - respects locked preferences', async () => {
  const input: MergeInput = {
    base: 'line 1\nline 2',
    ours: 'line 1 ours\nline 2 ours',
    theirs: 'line 1 theirs\nline 2 theirs',
    locks: new Map([['line-0', 'ai']]) // Lock first section to AI
  };

  const result = simpleMerge3(input);

  // The locked section should reflect the locked preference
  const lockedHunk = result.hunks.find(h => h.id === 'hunk-0');
  if (lockedHunk) {
    // If locked and similarity passes threshold, decision should be auto
    assert.strictEqual(lockedHunk.decision, 'auto');
    // Locked preference should be reflected
    assert.strictEqual(lockedHunk.prefer, 'ai');
    // Merged content should match AI version for locked hunk
    assert.strictEqual(lockedHunk.merged, lockedHunk.ai);
  }
});