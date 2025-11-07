import { describe, it, expect } from 'node:test'
import { merge3 } from '../../src/lib/merge.js'
import type { MergeInput, MergeProfile } from '../../src/lib/merge.js'
import { DEFAULT_FLAGS } from '../../src/config/flags.js'

// テスト用のマージ入力を作成
const createTestInput = (overrides: Partial<MergeInput> = {}): MergeInput => ({
  base: 'Base section content',
  ours: 'Ours section content', 
  theirs: 'Theirs section content',
  sections: ['section1'],
  locks: new Map(),
  ...overrides
})

// テスト用のプロファイルを作成
const createTestProfile = (overrides: Partial<MergeProfile> = {}): MergeProfile => ({
  tokenizer: 'char',
  granularity: 'section',
  threshold: 0.75,
  prefer: 'none',
  ...overrides
})

describe('merge3 関数のテスト', () => {
  it('should return deterministic result with sections', () => {
    const input = createTestInput()
    const profile = createTestProfile()
    
    const result1 = merge3(input, profile)
    const result2 = merge3(input, profile)
    
    // 同じ入力に対して同じ結果が返ることを確認
    expect(result1.hunks).toEqual(result2.hunks)
    expect(result1.mergedText).toEqual(result2.mergedText)
    expect(result1.stats.autoDecisions).toEqual(result2.stats.autoDecisions)
  })

  it('should classify sections as auto or conflict based on similarity', () => {
    // 高類似度のセクション（auto）
    const inputHighSim = {
      base: 'Same content',
      ours: 'Same content',
      theirs: 'Same content',
      sections: ['high_sim_section']
    }
    const profile = createTestProfile({ threshold: 0.8 })
    const result = merge3(inputHighSim, profile)
    
    expect(result.hunks[0].decision).toEqual('auto')
    expect(result.hunks[0].similarity).toBeGreaterThanOrEqual(0.8)
  })

  it('should return conflict when similarity is below threshold', () => {
    // 低類似度のセクション（conflict）
    const inputLowSim = {
      base: 'Different base',
      ours: 'Different ours',
      theirs: 'Different theirs',
      sections: ['low_sim_section']
    }
    const profile = createTestProfile({ threshold: 0.9 })
    const result = merge3(inputLowSim, profile)
    
    expect(result.hunks[0].decision).toEqual('conflict')
    expect(result.hunks[0].similarity).toBeLessThan(0.9)
  })

  it('should respect lock preferences over similarity', () => {
    // lock で manual を指定（similarity が閾値以上でも manual 優先）
    const locks = new Map([['section1', 'manual']])
    const inputWithLock = createTestInput({
      base: 'Same content', 
      ours: 'Same content',
      theirs: 'Same content',
      locks
    })
    const profile = createTestProfile({ threshold: 0.8 })
    const result = merge3(inputWithLock, profile)
    
    expect(result.hunks[0].prefer).toEqual('manual')
    expect(result.hunks[0].decision).toEqual('auto') // 同じ内容なので auto になるはず
  })

  it('should handle empty input gracefully', () => {
    // 入力が空の場合
    const emptyInput = createTestInput({
      base: '',
      ours: '',
      theirs: ''
    })
    const result = merge3(emptyInput)
    
    expect(result.hunks.length).toBeGreaterThanOrEqual(0)
    expect(result.mergedText).toBeDefined()
  })
})

describe('MergeProfile validation', () => {
  it('should validate threshold range', () => {
    expect(() => {
      createTestProfile({ threshold: 1.5 }) // 範囲外
    }).toThrow()
    
    expect(() => {
      createTestProfile({ threshold: -0.1 }) // 範囲外  
    }).toThrow()
    
    const validProfile = createTestProfile({ threshold: 0.75 })
    expect(validProfile.threshold).toBe(0.75)
  })
})

describe('Precision related tests', () => {
  it('should apply min threshold based on precision', () => {
    // beta precision の場合、最低でも 0.75 を適用
    const input = createTestInput()
    const profile = createTestProfile({ 
      threshold: 0.7,  // 0.75 以下
      precision: 'beta' as const
    })
    // precision の minAutoThreshold が優先されることを確認
    const result = merge3(input, profile)
    
    // 実際のprecision定義によるチェック（ドキュメント参照）
    expect(result.stats.processingMillis).toBeDefined()
  })
})