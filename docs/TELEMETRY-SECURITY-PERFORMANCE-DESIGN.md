# VS Code 拡張ブリッジ: Telemetry / セキュリティ / パフォーマンス統合設計

## 1. 目的と範囲
- Day8 パイプライン (Collector → Analyzer → Reporter) が VS Code 拡張の AutoSave・Diff Merge・フラグ解決と整合するよう、イベント定義と監視指標を統合する。【F:Day8/docs/day8/design/03_architecture.md†L3-L43】
- `docs/AUTOSAVE-DESIGN-IMPL.md` と `docs/IMPLEMENTATION-PLAN.md` で規定される保存ポリシー / Phase ガードを拡張し、CSP とパフォーマンス要件を UI ブリッジへ適用する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L1-L118】【F:docs/IMPLEMENTATION-PLAN.md†L67-L122】
- AutoSave/Merge/Export の個別実装は対象外とし、Telemetry JSONL、CSP 設定、性能計測ポイントを Day8 パイプラインへ接続する設計図を確定する。

## 2. Telemetry イベント契約 (JSONL v1)
| イベント | 送信タイミング | Collector `component/kind` | 主要フィールド | Analyzer 指標 | Reporter 連携 | ロールバック条件 |
| --- | --- | --- | --- | --- | --- | --- |
| `flag_resolution` | 拡張が設定値を正規化した直後 | `flags` / `flag_resolution` | `flags.flag_id`, `flags.source`, `flags.resolved_value`, `detail.retryable`, `status` | `flag_resolution_success_rate`, `default_fallback_rate` | `rollback_required` により Phase ガードを維持 | 同一フラグで `status="failure"` が 2 バッチ継続 → Phase 停止通知 |
| `status.autosave` | AutoSave 状態遷移 (`disabled→idle`, `awaiting-lock→saved` 等) | `autosave` / `ui` | `autosave.state`, `detail.retry_count`, `performance.flush_latency_ms` | `ui_saved_rate`, `autosave_retry_mean` | Phase A-1 / A-2 の進行確認 | `ui_saved_rate < 0.95` が 2 窓連続 → Phase 戻し |
| `snapshot.result` | `flushNow()` 成功/失敗直後 | `autosave` / `save` | `detail.duration_ms`, `detail.error_code`, `status` | `autosave_p95`, `autosave_success_rate` | SLO 達成/逸脱通知 | `autosave_success_rate < 0.95` かつ `retryable=false` 発生 → 即時ロールバック |
| `merge.result` | Diff Merge の自動適用／失敗時 | `merge` / `merge` | `merge.precision`, `merge.processing_ms`, `merge.conflict_segments`, `status` | `merge_auto_success_rate`, `merge_processing_p95` | Phase B ロールアウト判定 | `merge_auto_success_rate < 0.80` (1 バッチ) → Phase B 停止 |
| `export.result` | Export API 成功/失敗直後 | `export` / `export` | `export.format`, `export.artifact_bytes`, `detail.duration_ms`, `status` | `export_success_rate`, `export_latency_p95` | Export ガード解除前の監視 | `export_success_rate < 0.9` or `export_latency_p95 ≥ 1200` → Export 機能停止 |
| `error` | UI/ブリッジで回復不能エラーが発生 | `component`/`error` | `detail.error_code`, `detail.retryable`, `tags[]` | Incident 集約 (`retryable=false`) | PagerDuty / Slack 通知 | `retryable=false` 3 連続で Phase ロールバック |

- JSON Schema は `schemas/telemetry.schema.json` に定義し、Collector の入力検証へ適用する。`version=1` 固定、`workspace_id`/`request_id` は UUID を必須とする。
- `tags` には `feature:autosave|merge|flags|export`, `phase:A-1` 等を設定し、Analyzer がロールアウト段階と ±5% SLO を突合できるようにする。【F:docs/IMPLEMENTATION-PLAN.md†L323-L336】

## 3. Collector → Analyzer → Reporter 連結と Phase ガード
1. **Collector (15 分窓)**
   - `groupBy`: `{ component, kind, phase, tenant, client_version }` を既存の `monitor/collect-metrics` に統一。`status.autosave` と `snapshot.result` を同一リクエスト ID で突合し、`flush_latency_ms` を計測する。
   - `flag_resolution` は `flags.flag_id` 単位で成功率を算出。`default_used=true` が 5% を超えた場合は `rollback_candidate` を設定し、Analyzer へ送信する。
2. **Analyzer**
   - Phase A ガード: `autosave_p95 ≤ 750ms` かつ `ui_saved_rate ≥ 0.95` を満たす時に `phase_unlock.autosave=true`。逸脱時は `rollback_required=true` と `rollbackTo` を Phase A-0 へ設定。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L129-L177】
   - Phase B ガード: `merge_auto_success_rate ≥ 0.85` と `merge_processing_p95 < 5000ms`。`merge:precision=beta` が 3 バッチ連続で失敗した場合は Diff Merge を無効化し、AutoSave を `readonly` に戻す。
   - Export ガード: `export_success_rate ≥ 0.9`、`export_latency_p95 < 1200ms` を満たした時のみ Reporter が解放通知を送る。
3. **Reporter**
   - `rollback_required=true` の場合は `pnpm run flags:rollback --phase <rollbackTo>` を実行し、Incident へ添付する。【F:docs/design/extensions/telemetry.md†L137-L199】
   - Unlock 条件を満たすと `reports/alerts/<ts>.md` へ Phase 移行ログを追記し、Day8 ガバナンスへ通知する。

## 4. セキュリティ & CSP 設計
- Webview の `Content-Security-Policy` を `default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src vscode-resource:` に固定し、外部 `fetch` を禁止する。UI 3 ペイン構造 (Navigator / Diff / Inspector) 内からは `postMessage` のみを許可する。
- Workspace I/O は VS Code `workspace.fs` 経由に限定し、`project/autosave/` 配下と Export 出力先 (`workspaceState/export/`) をホワイトリスト化する。Collector 用 JSONL は `workflow-cookbook/logs/` への書き込みに限定し、`.lock` ファイルへアクセスしない。【F:docs/IMPLEMENTATION-PLAN.md†L289-L298】
- CSP/セキュリティ チェックリストは `docs/CSP-PERFORMANCE-CHECKLIST.md` にまとめ、リリース毎に `pnpm lint-csp` (新規追加) で自動検証する。
- 例外処理は `AutoSaveError` / `MergeError` の `retryable` 判定を Telemetry へ転送し、Collector がロールバック通知へ変換する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L78-L118】【F:docs/MERGE-DESIGN-IMPL.md†L96-L205】

## 5. パフォーマンス予算と UI 測定ポイント
| 指標 | 予算 | 測定ポイント | Telemetry 記録 | 補足 |
| --- | --- | --- | --- | --- |
| 初回描画 (First Paint) | < 300ms | Webview 起動直後に `performance.now()` で測定し `performance.first_paint_ms` として送信 | `status.autosave` イベントの `performance` セクション | Webview `ready` メッセージ内で 1 回のみ発火 |
| 主要操作 (AutoSave flush, Merge apply, Export submit) | < 100ms | 操作開始/終了で `performance.measure` を記録し、`detail.duration_ms` へ反映 | `snapshot.result`, `merge.result`, `export.result` | `duration_ms` が閾値超過した場合は `tags` に `perf:degraded` を追加 |
| スクロール (Diff ペイン) | 60 FPS (16ms/フレーム) | `requestAnimationFrame` で 120 フレーム計測し、`performance.scroll_fps` を算出 | `status.autosave` (`state="viewing"`) | Analyzer が `scroll_fps < 55` を警告として扱う |
| Telemetry エンドツーエンド遅延 | 15 分 + 5% | Collector キュー滞留時間 (`queue.lag_seconds`) | `flag_resolution` / `snapshot.result` の `detail.lag_seconds` | ±5% SLO を Day8 ダッシュボードへ送信 |

- UI は 3 ペイン構造を維持し、メインスレッドでの同期 I/O を禁止。`virtual-scroll` コンポーネントに 60 FPS 計測を組み込み、Diff Merge のハイライトは `requestIdleCallback` を利用する。【F:docs/MERGE-DESIGN-IMPL.md†L96-L207】
- パフォーマンス計測ログは `workflow-cookbook/logs/perf/` へ JSONL 追記し、Collector が `performance` フィールドを追加集計する。

## 6. Day8 パイプラインとの整合
- Collector の SLO 設定 (`±5%`) と `phase` 切替を `Day8/docs/day8/design/03_architecture.md` の責務境界へフィードバックする。新規メトリクス (`flag_resolution_success_rate`, `export_latency_p95`) を Analyzer のスコア計算に追加する。
- `workflow-cookbook/scripts/analyze.py` に `telemetry.schema.json` をバリデーションステップとして追加し、JSONL 不整合を RED テストで検出する。テストケースは `tests/telemetry/flag_resolution.trace.test.ts` を起点に追加する (詳細は §7)。
- Phase ガード解除時は Reporter が `Day8` パイプラインへ `phase_unlock` イベントを返し、`governance/policy.yaml` のフラグを同一コミットで更新するフローを維持する。【F:docs/design/extensions/telemetry.md†L137-L199】

## 7. RED テスト計画
1. `tests/telemetry/flag_resolution.trace.test.ts`: `telemetry.schema.json` で `flags.source` が未設定のログを弾き、Collector が `rollback_candidate` を生成することを検証。
2. `tests/telemetry/autosave-status.trace.test.ts`: `status.autosave` が `state="saved"` に遷移しないシナリオを入力し、Analyzer が `ui_saved_rate < 0.95` 判定で Phase ロールバックを要求することを確認。
3. `tests/telemetry/merge-export.trace.test.ts`: `merge.result` の処理時間が 5200ms、`export.result` 成功率が 0.88 のフィクスチャを投入し、Reporter が Phase B 停止と Export 停止の Incident を通知することを検証。

## 8. 運用チェックリスト (要約)
- Telemetry JSONL は `schemas/telemetry.schema.json` で検証し、Collector の 15 分窓に `flag_resolution`/`status.autosave`/`merge.result`/`export.result` が最低 1 件含まれることを確認する。
- CSP 設定・外部通信禁止・Sandbox ルールは `docs/CSP-PERFORMANCE-CHECKLIST.md` を参照し、リリース前レビューでチェックマークを付ける。
- 性能計測ログは `performance.*` フィールドで ±5% SLO を満たしているか Day8 ダッシュボードで可視化し、逸脱時は即ロールバック判定を実施する。
