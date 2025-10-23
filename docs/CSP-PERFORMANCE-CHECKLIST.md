# CSP / 性能チェックリスト (VS Code 拡張ブリッジ)

## 1. Webview セキュリティ
- [ ] `Content-Security-Policy`: `default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src vscode-resource:` を `package.json` の `contributes.webview` 設定へ適用したか。
- [ ] Webview からの `fetch` / `XMLHttpRequest` を禁止し、IPC は `acquireVsCodeApi().postMessage` のみに限定しているか。
- [ ] VS Code `workspace.fs` のアクセス先を `project/autosave/`, `workspaceState/export/`, `workflow-cookbook/logs/` に制限し、`.lock` ファイルや外部パスへアクセスしないことを確認したか。【F:docs/IMPLEMENTATION-PLAN.md†L289-L298】
- [ ] Telemetry 送信時に `request_id` / `workspace_id` を UUID v4 で生成し、個人情報やローカルファイル名を含めていないか。

## 2. Telemetry / Day8 連携
- [ ] `schemas/telemetry.schema.json` で JSONL を検証し、`flag_resolution`/`status.autosave`/`merge.result`/`export.result` が定義済みフィールドを満たしているか。
- [ ] `workflow-cookbook/scripts/analyze.py` へスキーマ検証フックを追加し、Collector 15 分窓の投入前に構造エラーを排除しているか。【F:Day8/docs/day8/design/03_architecture.md†L3-L43】
- [ ] `tests/telemetry/*.trace.test.ts` の RED ケース (フラグ欠損 / AutoSave 成功率低下 / Merge & Export SLO 超過) を実行し、Analyzer/Reporter のロールバック通知が期待通りであることを確認したか。

## 3. パフォーマンス計測
- [ ] 初回描画 (`performance.first_paint_ms`) が 300ms 未満であることを Telemetry と DevTools 計測の両方で確認したか。
- [ ] AutoSave flush / Merge apply / Export submit の操作が 100ms 未満 (`detail.duration_ms`) を維持し、超過時に `tags` へ `perf:degraded` を付与する実装を確認したか。
- [ ] Diff ペインのスクロールが 60FPS を維持 (`performance.scroll_fps ≥ 60`) し、仮想スクロールと `requestIdleCallback` が有効になっているか。【F:docs/MERGE-DESIGN-IMPL.md†L96-L207】
- [ ] Collector の Telemetry キュー滞留時間が 15 分 + 5% を超えない (`detail.lag_seconds` で監視) ことを Day8 ダッシュボードで確認したか。

## 4. Phase ガード / ロールバック
- [ ] Analyzer が `autosave_p95` / `ui_saved_rate` / `merge_auto_success_rate` / `export_latency_p95` を監視し、逸脱時に `rollback_required=true` を出力することを RED テストで確認したか。【F:docs/TELEMETRY-SECURITY-PERFORMANCE-DESIGN.md†L30-L96】
- [ ] Reporter が `pnpm run flags:rollback --phase <rollbackTo>` のログを Incident へ添付し、Day8 ガバナンス通知が完了したか。【F:docs/design/extensions/telemetry.md†L137-L199】
- [ ] Phase 解除条件 (`phase_unlock.autosave`, `phase_unlock.merge`, `export_unlock`) が満たされた際に、Collector の集計結果と `governance/policy.yaml` の更新が同一コミットで反映されているか。
