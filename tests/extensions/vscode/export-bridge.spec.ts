import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// NOTE: 実装時に `createExportBridge` (仮) へ置換する。現段階では RED ケースを明示するために失敗で固定している。

describe('VSCode Export Bridge (RED scenarios)', () => {
  it('CSV 正規化: CRLF を LF へ揃え、末尾に単一の改行を維持する', () => {
    // R: CRLF 含みの CSV テキストと、tone 配列の区切りを想定した入力を準備
    //    例: ["id","tone"] -> tone は `calm;morning` へ正規化予定
    const csvInput = 'id,title,desc,tone\r\nscn_001,Opening,desc text,"calm,morning"\r\n'

    // E: Export Bridge で CSV を生成（予定）
    void csvInput

    // D: 改行が LF に統一され、末尾改行が 1 つであることを期待
    assert.fail('CSV 正規化処理が未実装のため RED — see docs/src-1.35_addon/EXPORT-IMPORT.md §6')
  })

  it('JSONL 容量上限: 50MB を超える場合は retryable=false で失敗を返す', () => {
    // R: scenes[] の連結で 50MB を超えるダミーデータを準備
    const largeScene = { id: 'scn_oversize', title: 'Huge', desc: 'x'.repeat(1024) }
    const scenes = new Array(60_000).fill(largeScene)

    // E: JSONL エクスポート要求を実行（予定）
    void scenes

    // D: エラーオブジェクトに retryable=false が含まれることを期待
    assert.fail('JSONL 容量超過ハンドリングが未実装のため RED — see docs/design/extensions/export-import.md §3')
  })

  it('atomicWrite 失敗時: UI へエラー通知と Collector WARN を送出する', () => {
    // R: fs.atomicWrite が例外を投げるようにモック
    const error = new Error('write failed')
    void error

    // E: Export Bridge が失敗結果を返却（予定）

    // D: UI 通知（エラー）と Collector WARN イベントが生成されることを期待
    assert.fail('atomicWrite 失敗時の通知が未実装のため RED — see docs/design/extensions/export-import.md §4')
  })
})
