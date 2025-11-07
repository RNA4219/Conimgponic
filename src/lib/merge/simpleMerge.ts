// src/lib/merge/simpleMerge.ts
// 以前に作成したmerge.tsの内容をsimpleMerge3として保存
import { tokenizeForSimilarity } from '../tokenizer';

export type MergePrecision = 'legacy' | 'beta' | 'stable';

export type MergePreference = 'manual' | 'ai' | 'none';

export interface MergeProfile {
  readonly tokenizer?: 'char' | 'word' | 'morpheme';
  readonly granularity?: 'section' | 'line';
  readonly threshold?: number;
  readonly prefer?: MergePreference;
  readonly seed?: string;
}

export interface MergeInput {
  readonly base: string;
  readonly ours: string;
  readonly theirs: string;
  readonly sections?: readonly string[];
  readonly locks?: ReadonlyMap<string, MergePreference>;
}

export interface MergeHunk {
  readonly id: string;
  readonly section: string | null;
  readonly base: string;
  readonly ours: string;
  readonly theirs: string;
  readonly decision: 'auto' | 'conflict';
  readonly similarity: number;
  readonly merged: string;
  readonly manual: string;
  readonly ai: string;
  readonly prefer: MergePreference;
}

export interface MergeStats {
  readonly autoDecisions: number;
  readonly conflictDecisions: number;
  readonly averageSimilarity: number;
  readonly processingMillis: number;
}

export interface MergeResult {
  readonly hunks: readonly MergeHunk[];
  readonly mergedText: string;
  readonly stats: MergeStats;
}

// デフォルトプロファイル
const DEFAULT_PROFILE: Required<MergeProfile> = {
  tokenizer: 'char',
  granularity: 'section',
  threshold: 0.75,
  prefer: 'none',
  seed: ''
} as const;

/**
 * 3-wayマージを実行する
 */
export function simpleMerge3(input: MergeInput, profile?: Partial<MergeProfile>): MergeResult {
  const start = performance.now();
  const resolvedProfile = { ...DEFAULT_PROFILE, ...profile } as Required<MergeProfile>;
  
  // セクション分割 (行単位で分割)
  const lines = input.base.split('\n');
  const oursLines = input.ours.split('\n');
  const theirsLines = input.theirs.split('\n');
  
  const sections = lines.map((line, i) => ({
    id: `line-${i}`,
    base: line,
    ours: oursLines[i] ?? '',
    theirs: theirsLines[i] ?? ''
  }));
  
  const hunks: MergeHunk[] = sections.map((sectionPart, index) => {
    const { base, ours, theirs } = sectionPart;
    const manual = ours;
    const ai = theirs;
    const similarity = computeSimilarity(manual, ai);
    const locked = input.locks?.get(sectionPart.id) ?? null;
    const prefer = locked ?? resolvedProfile.prefer;

    // ロックされている場合は常にオートと見なす（優先度を尊重）
    const decision = locked ? 'auto' : (similarity >= resolvedProfile.threshold ? 'auto' : 'conflict');
    
    const merged = decision === 'auto' 
      ? (prefer === 'ai' ? ai : manual) 
      : manual || ai;
    
    return {
      id: `hunk-${index}`,
      section: sectionPart.id,
      base,
      ours,
      theirs,
      decision,
      similarity,
      merged,
      manual,
      ai,
      prefer
    };
  });
  
  const autoDecisions = hunks.filter(h => h.decision === 'auto').length;
  const conflictDecisions = hunks.length - autoDecisions;
  const averageSimilarity = hunks.reduce((sum, h) => sum + h.similarity, 0) / hunks.length || 0;
  
  const end = performance.now();
  
  const stats: MergeStats = {
    autoDecisions,
    conflictDecisions,
    averageSimilarity,
    processingMillis: end - start
  };
  
  const mergedText = hunks.map(h => h.merged).join('\n');
  
  return {
    hunks,
    mergedText,
    stats
  };
}

// ヘルパー関数
function computeSimilarity(a: string, b: string): number {
  const left = tokenizeForSimilarity(a);
  const right = tokenizeForSimilarity(b);
  
  if (left.length === 0 && right.length === 0) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  
  const leftSet = new Set(left);
  let intersection = 0;
  for (const token of right) {
    if (leftSet.has(token)) {
      intersection++;
    }
  }
  
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}