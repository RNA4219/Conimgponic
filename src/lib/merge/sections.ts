import type { MergeInput, MergePreference, MergeTokenizer, ResolvedMergeProfile } from '../merge.ts';

export interface MergeSection {
  readonly id: string;
  readonly label: string;
  readonly base: string;
  readonly manual: string;
  readonly ai: string;
  readonly prefer: MergePreference;
  readonly locked: boolean;
}

export const tokenSections = (text: string): readonly string[] => {
  return text
    .split(/\r?\n\r?\n/)
    .map((section) => section.trim())
    .filter((section, index, arr) => section.length > 0 || index === arr.length - 1);
};

export const tokenize = (text: string, tokenizer: MergeTokenizer): readonly string[] => {
  if (!text) {
    return [];
  }
  switch (tokenizer) {
    case 'char':
      return Array.from(text);
    case 'word':
      return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    case 'morpheme':
      return text.toLowerCase().match(/[\p{L}\p{N}]{1,2}/gu) ?? [];
    default:
      return Array.from(text);
  }
};

export const splitSections = (
  input: MergeInput,
  profile: ResolvedMergeProfile,
): readonly MergeSection[] => {
  const manualSections = tokenSections(input.ours);
  const aiSections = tokenSections(input.theirs);
  const baseSections = tokenSections(input.base);
  const labels = input.sections ?? [];
  const descriptors = new Map((input.sectionDescriptors ?? []).map((descriptor) => [descriptor.id, descriptor]));
  const sections: MergeSection[] = [];
  const maxLength = Math.max(manualSections.length, aiSections.length, baseSections.length);

  for (let index = 0; index < maxLength; index += 1) {
    const label = labels[index] ?? `section-${index + 1}`;
    const descriptor = descriptors.get(label);
    const prefer = (input.locks?.get(label) ?? descriptor?.preferred ?? profile.prefer) ?? 'none';
    sections.push({
      id: label,
      label,
      base: baseSections[index] ?? '',
      manual: manualSections[index] ?? '',
      ai: aiSections[index] ?? '',
      prefer,
      locked: input.locks?.has(label) ?? false,
    });
  }
  return sections;
};

const frequency = (tokens: readonly string[]): Map<string, number> => {
  const freq = new Map<string, number>();
  tokens.forEach((token) => {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  });
  return freq;
};

export const computeJaccard = (left: readonly string[], right: readonly string[]): number => {
  if (left.length === 0 && right.length === 0) {
    return 1;
  }
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  leftSet.forEach((token) => {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  });
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
};

export const computeCosine = (left: readonly string[], right: readonly string[]): number => {
  if (left.length === 0 && right.length === 0) {
    return 1;
  }
  const leftFreq = frequency(left);
  const rightFreq = frequency(right);
  const shared = new Set([...leftFreq.keys(), ...rightFreq.keys()]);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  shared.forEach((token) => {
    const l = leftFreq.get(token) ?? 0;
    const r = rightFreq.get(token) ?? 0;
    dot += l * r;
  });
  leftFreq.forEach((value) => {
    leftMagnitude += value * value;
  });
  rightFreq.forEach((value) => {
    rightMagnitude += value * value;
  });
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
};
