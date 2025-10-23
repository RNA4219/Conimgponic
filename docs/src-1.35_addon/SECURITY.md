# SECURITY — セキュリティ仕様

## ポリシー概要
- **CSP**: `default-src 'none'`; `script-src 'nonce-...'`; inline/style-src は `nonce` 指定のみ許容。`connect-src` は `vscode-resource:` のみ。
- **外部通信**: 既定禁止（v1.0）。fetch/XHR/WebSocket はブロックし、必要時は拡張側で proxied fetch を提供。
- **保存**: ワークスペース配下のみ。**tmp→rename** でアトミック処理し、`plugins.failed` Telemetry と紐付ける。
- **メッセージ検証**: Envelope (`type/apiVersion/reqId/ts/correlationId/phase`) の型チェックを行い、未知イベントは破棄。
- **ログ/テレメトリ**: ローカル JSONL で Collector に渡す。個人情報・機密は redaction ポリシーに従い null 化。

## チェックリスト（CSP/Phase ガード）
- [ ] `webview.bootstrap.sample.ts` の `default-src 'none'` と `nonce` 付与が実装と一致
- [ ] 外部依存の `<script>` / `<link>` / `fetch` を追加していない
- [ ] `correlationId` 未設定メッセージを検証で拒否
- [ ] Telemetry JSONL に `sandboxViolation` が出力された場合は即座に rollbackTo を `B-0` へ設定
- [ ] `plugins.*` で `sandboxViolation=true` を検出した際に Reporter へ PagerDuty 通知を送る
