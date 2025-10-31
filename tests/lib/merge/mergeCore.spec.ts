import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_MERGE_PROFILE, type MergeInput, type ResolvedMergeProfile } from '../../../src/lib/merge.ts'
import { resolveThreshold } from '../../../src/lib/merge/profile.ts'
import { splitSections } from '../../../src/lib/merge/sections.ts'

const withProfile = (overrides: Partial<ResolvedMergeProfile> = {}): ResolvedMergeProfile => ({
  ...DEFAULT_MERGE_PROFILE,
  ...overrides,
})

const createInput = (overrides: Partial<MergeInput> = {}): MergeInput => ({
  base: 'base-a\n\nbase-b\n\nbase-c',
  ours: 'manual-a\n\nmanual-b\n\nmanual-c',
  theirs: 'ai-a\n\nai-b\n\nai-c',
  ...overrides,
})

test('resolveThreshold clamps overrides within precision bounds', () => {
  const threshold = resolveThreshold('beta', { threshold: 0.4 })

  assert.equal(threshold, 0.75)
})

test('resolveThreshold prefers overrides over environment fallback', () => {
  const previous = process.env.CONIMG_MERGE_THRESHOLD
  process.env.CONIMG_MERGE_THRESHOLD = '0.9'
  try {
    const threshold = resolveThreshold('stable', { threshold: 0.86 })

    assert.equal(threshold, 0.86)
  } finally {
    if (previous === undefined) {
      delete process.env.CONIMG_MERGE_THRESHOLD
    } else {
      process.env.CONIMG_MERGE_THRESHOLD = previous
    }
  }
})

test('splitSections merges descriptors, locks, and defaults deterministically', () => {
  const input = createInput({
    sections: ['intro', 'details'],
    sectionDescriptors: [
      { id: 'intro', label: 'Introduction', range: [0, 1], preferred: 'ai' },
      { id: 'details', label: 'Deep Dive', range: [1, 2], preferred: 'ai' },
    ],
    locks: new Map([
      ['details', 'manual'],
    ]),
  })
  const profile = withProfile({ prefer: 'none' })

  const sections = splitSections(input, profile)

  assert.equal(sections.length, 3)
  assert.deepEqual(sections.map((section) => section.id), ['intro', 'details', 'section-3'])
  assert.deepEqual(
    sections.map((section) => ({ label: section.label, prefer: section.prefer, locked: section.locked })),
    [
      { label: 'intro', prefer: 'ai', locked: false },
      { label: 'details', prefer: 'manual', locked: true },
      { label: 'section-3', prefer: 'none', locked: false },
    ],
  )
  assert.deepEqual(
    sections.map((section) => ({ base: section.base, manual: section.manual, ai: section.ai })),
    [
      { base: 'base-a', manual: 'manual-a', ai: 'ai-a' },
      { base: 'base-b', manual: 'manual-b', ai: 'ai-b' },
      { base: 'base-c', manual: 'manual-c', ai: 'ai-c' },
    ],
  )
})
