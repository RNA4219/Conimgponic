# セキュリティ & ガバナンス

## ポリシー（例）
```yaml
# governance/policy.yaml（例）
owners: ["@RNA4219"]
slo:
  max_duration_p95_ms: 2000
  min_pass_rate: 0.95
allow_actions:
  - read_logs
  - open_issue_draft
  - commit_reports
deny_actions:
  - modify_prod_code
  - external_secrets_exfiltration
rate_limits:
  issues_per_day: 5
  report_commits_per_day: 3
protected_paths:
  - "src/**"
  - "infra/**"
```

## セキュリティレビュー手順
1. **準備** — [workflow-cookbook/SECURITY.md](../../../workflow-cookbook/SECURITY.md) の承認フローを確認し、リスク分類と例外記録テンプレートを更新する。
2. **ヒアリング** — 変更内容に紐づく Secrets / OAuth / ログ出力箇所を `git grep` で洗い出し、[docs/addenda/G_Security_Privacy.md](../../addenda/G_Security_Privacy.md) の運用ノートへ差分を記録する。
3. **レビュー** — 本チェックリストの各項目を実施し、結果を PR 本文と Birdseye Capsule（`docs/birdseye/caps/*.json`）へ記録する。
4. **ハンドオフ** — `docs/safety.md` のフェイルセーフ手順を再確認し、必要な場合は Birdseye Hot リストへ更新を反映する。

## Secrets / Rate limit / CORS / OAuth チェック
- [ ] **Secrets** — 環境変数・CI シークレットは Git 管理外で Vault 経由。ローテーション記録を `workflow-cookbook/SECURITY.md` と Appendix G に同期。
- [ ] **Rate limit** — `governance/policy.yaml` の `rate_limits` を最新化し、API 呼び出し増加時は緩和策を Checklists に追加。
- [ ] **CORS** — 新規エンドポイントは `allowlist` 方式。`docs/addenda/G_Security_Privacy.md` の通信保護手順に沿い、プリフライト応答を検証。
- [ ] **OAuth** — スコープ最小化・リダイレクト URI 制限を確認。クライアント情報は Vault 格納を確認し、例外は `docs/safety.md` で承認履歴を残す。

## PII/機微情報の取り扱い
- ログ収集時にマスキングを適用
- 外部送信は行わない

## 参照
- [workflow-cookbook/SECURITY.md](../../../workflow-cookbook/SECURITY.md)
- [workflow-cookbook/SAFETY.md](../../../workflow-cookbook/SAFETY.md)
- [docs/addenda/G_Security_Privacy.md](../../addenda/G_Security_Privacy.md)
- [docs/safety.md](../../safety.md)
