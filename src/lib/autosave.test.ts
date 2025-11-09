import { AutoSave, AutoSaveConfig, AutoSaveStorage } from './autosave'

class MockStorage implements AutoSaveStorage {
  public calls: number = 0
  private failUntil: number
  constructor(failUntil: number) {
    this.failUntil = failUntil
  }
  async write(_key: string, _value: string): Promise<void> {
    this.calls++
    if (this.calls <= this.failUntil) {
      return Promise.reject(new Error('write failed'))
    }
    return
  }
}

describe('AutoSave', () => {
  test('正常系: 1回のストレージ書き込みで完了', async () => {
    const storage = new MockStorage(0) // 0回で成功
    const cfg: AutoSaveConfig = { maxRetries: 0, retryBackoffMs: 0, storage }
    const autosave = new AutoSave(cfg)
    await autosave.save('test-key', 'test-value')
    expect(storage.calls).toBe(1)
  })

  test('再試行あり: 初回失敗 -> 1回の再試行で成功', async () => {
    const storage = new MockStorage(1) // 1回目だけ失敗
    const cfg: AutoSaveConfig = { maxRetries: 2, retryBackoffMs: 0, storage }
    const autosave = new AutoSave(cfg)
    await autosave.save('test-key', 'test-value')
    expect(storage.calls).toBe(2)
  })

  test('最大再試行超過: すべて失敗して例外', async () => {
    const storage = new MockStorage(5) // 5回失敗する設定
    const cfg: AutoSaveConfig = { maxRetries: 2, retryBackoffMs: 0, storage }
    const autosave = new AutoSave(cfg)
    await expect(autosave.save('test-key', 'test-value')).rejects.toThrow('write failed')
    // 初回 + 2回の再試行で計3回試行される
    expect(storage.calls).toBe(3)
  })

  test('再試行中に成功: 複数回失敗の後に成功', async () => {
    const storage = new MockStorage(2) // 最初の2回は失敗
    const cfg: AutoSaveConfig = { maxRetries: 5, retryBackoffMs: 0, storage }
    const autosave = new AutoSave(cfg)
    await autosave.save('test-key', 'test-value')
    expect(storage.calls).toBe(3)
  })
})
