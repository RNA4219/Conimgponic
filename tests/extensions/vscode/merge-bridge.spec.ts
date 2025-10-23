import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// NOTE: 実装時に `createMergeBridge` (仮) へ置換する。現段階では RED ケースを明示するために失敗で固定している。

describe('VSCode Merge Bridge (RED scenarios)', () => {
  it('precision threshold を payload で上書きし、証跡JSONへ反映する', () => {
    // R: merge.request で profile.threshold=0.84 を指定し、Base/Ours/Theirs のダミー差分を準備
    const requestPayload = {
      profile: { threshold: 0.84 },
      baseUri: 'file:///story/base.json',
      oursUri: 'file:///story/ours.json',
      theirsUri: 'file:///story/theirs.json',
    }

    // E: Merge Bridge が merge.result を生成し、profile.threshold が 0.84 に上書きされた証跡を Collector へ送出（予定）
    void requestPayload

    // D: result.profile.threshold === 0.84 および evidence.profile.threshold === 0.84 を期待
    assert.fail('precision threshold 上書き処理が未実装のため RED')
  })

  it('決定不可なハンクを conflict として UI へ報告し、ロールバック用コマンドを付与する', () => {
    // R: Ours/Theirs が大幅に乖離するハンクを含む差分を準備
    const divergentHunk = {
      path: 'scenes[5].dialogue',
      ours: 'Hello there',
      theirs: 'Greetings traveler',
    }

    // E: Merge Bridge が conflict を検出し、merge.result.hunks[*].decision === "conflict" とロールバック情報を付与（予定）
    void divergentHunk

    // D: UI へ conflict レポートが通知され、rollbackCommand が付与されることを期待
    assert.fail('conflict レポートとロールバック付与が未実装のため RED')
  })

  it('traceId と evidence JSON のハッシュを Collector へ保証付きで送信する', () => {
    // R: merge.result 生成時に traceId を発行し、evidence JSON を固定順序でシリアライズする入力を準備
    const traceContext = { traceId: 'trace-merge-001', seed: 'abc123' }

    // E: Merge Bridge が Collector へ { traceId, hash(evidence) } を送出し、UI へも traceId を返却（予定）
    void traceContext

    // D: Collector への送信と UI 表示 traceId が一致し、証跡の整合性が担保されることを期待
    assert.fail('trace 保証フローが未実装のため RED')
  })
})
