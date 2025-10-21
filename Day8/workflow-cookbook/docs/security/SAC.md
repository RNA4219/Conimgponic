# Security Architecture Contract (SAC) v0.1

対象: 全リポジトリ／エージェント実装／Chainlit派生UI

## 原則

1. Secretsはサーバ側管理のみとし、ログ出力を禁止する
2. LLM出力は不信任とみなし、HTML無効化・リンクは `rel="noopener"` を強制する
3. 外部通信はホワイトリスト方式とし、LLM API・静的配信先のみ許可（ループバック・メタデータIPは禁止）
4. ツール実行時はスキーマ検証を通過し、許可ドメインのみアクセス可能とする
5. CSRF/CORS/CSPヘッダを強制する（推奨CSPは付録Aを参照）
6. Rate/Quota を設定し、RPS・同時実行・日次トークン上限を明文化する
7. 依存バージョンは固定し、既知脆弱性は CI で検出次第ブロックする
8. 監査ログは PII をマスクし、改ざん検知を適用する
9. モデル切替はサーバ設定のみ許可し、クライアントからの変更を禁止する
10. リリース前に SAST / Secrets / 依存 / Container の4種ゲートを通過する

### 付録A: 推奨CSP

```text
default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://api.openai.com https://generativelanguage.googleapis.com; frame-ancestors 'none'; base-uri 'none'
```
