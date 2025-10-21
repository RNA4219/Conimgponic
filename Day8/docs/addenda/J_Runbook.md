# Day8 運用ランブック付録（Appendix J）

Katamari 付録 J をベースに、Day8 の代表的な運用事象と一次切り分けフローを整理したランブック。Day8 の Guardrails を満たす最小限の対応ステップのみを掲載し、詳細な再発防止策は `workflow-cookbook/docs/IN-*.md` や `workflow-cookbook/CHECKLISTS.md` を参照する。

## 想定シグナルと初動

| 事象 | 主な検知シグナル | 初動ステップ | エスカレーション基準 |
| --- | --- | --- | --- |
| SSE 断（サーバー送信イベントの途切れ） | - `logs/test.jsonl` に `EventSource disconnect` が 3 分以内に連続記録<br>- UI のストリームが 10 秒超停止 | 1. `workflow-cookbook/scripts/analyze.py --root . --emit report --focus runtime` を実行し、断線時刻とリトライ回数を確認。<br>2. `docs/day8/ops/04_ops.md` の SSE 設定値（`retry`, `keepalive`）を比較し、差分がないか確認。<br>3. Birdseye Hot に暫定タグ `sse-outage` を追加し、復旧状況を共有。 | - 断が 5 分以上継続<br>- リトライ回数が Guardrail 上限（10 回）を超過 |
| 初回応答遅延（Cold Start 遅延） | - `workflow-cookbook/reports/today.md` の P95 応答時間が 5 秒超<br>- `logs/test.jsonl` に `cold_start=true` が集中 | 1. `workflow-cookbook/scripts/analyze.py --root . --emit report --focus latency` を実行し、対象リクエスト ID を特定。<br>2. `docs/day8/perf/03_performance.md` のウォームアップ手順に沿って `scripts/warmup.sh` を再実行。<br>3. Birdseye Capsule `docs/day8/perf/03_performance.md` の `maintenance.refresh` に遅延計測値をメモ。 | - P95 が 10 分間改善しない<br>- SLA 2 分超のリクエストが 3 件以上 |
| OAuth 認証失敗 | - `logs/test.jsonl` の `oauth_error` カウントが 5 分で 3 件超<br>- PagerDuty の `auth-gateway` サービスが Warning | 1. `workflow-cookbook/scripts/analyze.py --root . --emit report --focus auth` を実行し、エラーコードとテナントを抽出。<br>2. `docs/addenda/G_Security_Privacy.md` のトークン回転手順に沿って、直近のキー更新状況を確認。<br>3. `workflow-cookbook/tools/codemap/update.py --targets docs/birdseye/index.json --emit index` を実行し、依存更新の有無を可視化。 | - `invalid_client` が連続 5 件<br>- 管理者テナントの `invalid_grant` が発生 |

## 影響評価とフォローアップ

1. **影響スコープの記録** — 事象別に `workflow-cookbook/logs/test.jsonl` の対象行を `workflow-cookbook/docs/IN-YYYYMMDD-XXX.md` へ添付し、タイムスタンプと関連ロールを明記する。
2. **Birdseye 同期** — 本付録を参照した際は、`docs/birdseye/index.json` と該当 Capsule の `generated_at` を同一値へ揃え、`maintenance.refresh` に一次切り分け結果を残す。
3. **再発防止の接続** — 断続的な障害が続く場合は `docs/addenda/L_Config_Reference.md` と `workflow-cookbook/CHECKLISTS.md` を併読し、設定値やデイリー手順の修正を検討する。

## 参照リンク

- [docs/day8/ops/04_ops.md](../day8/ops/04_ops.md)：SSE 運用設定。
- [docs/day8/perf/03_performance.md](../day8/perf/03_performance.md)：性能計測とウォームアップ手順。
- [docs/addenda/G_Security_Privacy.md](G_Security_Privacy.md)：OAuth 周辺のキー管理と監査ログ。
- [workflow-cookbook/RUNBOOK.md](../../workflow-cookbook/RUNBOOK.md)：全体運用フローとロール責務。
