import { describe, test } from 'node:test'

// RED フェーズ: 正規化済みエクスポート出力と Webview ハンドシェイクを定義する。
describe('export bridge golden comparison (RED)', () => {
  test.todo('Markdown エクスポートを正規化し runs/<runId>/export/markdown/storyboard.md とゴールデンを厳密比較する')
  test.todo('CSV エクスポートを RFC4180 正規化後に runs/<runId>/export/csv/storyboard.csv とゴールデンで比較する')
  test.todo('JSONL エクスポートをキー順固定で正規化し runs/<runId>/export/jsonl/storyboard.jsonl と比較する')
  test.todo('Package エクスポートを展開し内包ファイルおよび export-info.json をゴールデンと比較する')
  test.todo('export.result が URI と normalized パスを返し、失敗時は { ok:false,error } で retryable を検証する')
  test.todo('AutoSave ロック競合やフォーマット未対応時のエラーが Collector へ telemetry export.failed として送信される')
})
