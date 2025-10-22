# フェーズ別ロールアウト & テレメトリ設計仕様

## 0. 目的
- `docs/IMPLEMENTATION-PLAN.md` §2 で整理されたフェーズゲートとロールバック手順を、実装チームが運用できる設計仕様として定着させる。
- AutoSave 保存ポリシーと復元 API（`docs/AUTOSAVE-DESIGN-IMPL.md`）を前提に、Collector→Analyzer→Reporter パイプライン（Day8 `03_architecture.md`）へ必要なメトリクス/イベントを組み込む。
- フラグ既定値・計測項目・ロールバック動線を明確化し、Phase A/B の切替を安全に実行できる状態を保証する。

## 1. フラグ既定値とフェーズゲート
### 1.1 フェーズ別デフォルト
| フェーズ | `autosave.enabled` | `merge.precision` | 対象ユーザー | 備考 |
| --- | --- | --- | --- | --- |
| Phase A-0 (準備) | `false` | `legacy` | 全ユーザー | 保存遅延 P95>2.5s が 1 日 3 回超過した場合はロールバック判定会議を開く。【F:docs/IMPLEMENTATION-PLAN.md†L52-L60】 |
| Phase A-1 (QA Canary) | `true` (QA のみ) | `legacy` | 開発・QA | 保存 P95 ≤2.5s かつ QA 10 ケース完了で Phase A-2 移行可。ロールバック条件は 保存 P95>2.5s または 復旧成功率<99.5%。【F:docs/IMPLEMENTATION-PLAN.md†L56-L69】 |
| Phase A-2 (β) | `true` | `legacy` | ベータ招待 | 復元 QA 12/12 合格かつ SLO 違反ゼロで Phase B-0 へ進行。復元失敗率≥0.5% または クラッシュ率 baseline+5% でロールバック。【F:docs/IMPLEMENTATION-PLAN.md†L57-L69】 |
| Phase B-0 (Merge β) | `true` | `beta` | ベータ招待 | Diff Merge QA 20 ケース完了、自動マージ率≥80% で Phase B-1 検討。ロールバックは自動マージ率<80% または重大バグ>3 件/日。【F:docs/IMPLEMENTATION-PLAN.md†L58-L69】 |
| Phase B-1 (GA) | `true` | `stable` | 全ユーザー | AutoSave/マージ SLO を 5 日連続達成かつリリースノート承認で GA 維持。任意 SLO 未達が 24h 継続 または重大事故発生で即時ロールバック。【F:docs/IMPLEMENTATION-PLAN.md†L60-L75】 |

### 1.2 フラグ解決シーケンス
- `import.meta.env` → `localStorage` → `docs/CONFIG_FLAGS.md` 既定値の順に解決する。`FlagSnapshot.source` を保持しロールバック調査時の証跡とする。【F:docs/IMPLEMENTATION-PLAN.md†L9-L52】
- Phase A-1 までは QA 対象アカウントに限り `localStorage` 上書きを許容し、Phase A-2 以降は Collector が配布する `flags:push --env beta` による集中管理へ切り替える。【F:docs/IMPLEMENTATION-PLAN.md†L69-L110】

### 1.3 フェーズ移行判定フロー
1. Analyzer が 15 分毎に算出したメトリクスを `metrics/autosave_merge/<date>.json` に書き出し、`phase` キーで対象フェーズを明示する（Phase 移行時に履歴を切り分けるため）。【F:Day8/docs/day8/design/03_architecture.md†L12-L31】
2. Release Captain は日次の `reports/rollout/<date>.md` を参照し、ゲート基準を満たすか判定する。レポートには `autosave_p95`・`restore_success_rate`・`merge_auto_success_rate` のウィンドウ別推移と QA チェックリスト完了状況を添付する。【F:docs/IMPLEMENTATION-PLAN.md†L52-L101】
3. 判定結果は `governance/phase-ledger.yaml` に記録し、`flags:push --phase <next>` を実行した責任者とタイムスタンプを合わせて残す。Ledger はロールバック時の参照ポイントとなる。【F:docs/IMPLEMENTATION-PLAN.md†L69-L118】
4. Phase B 以降は Merge Precision の既定値が変化するため、`flags:push` 完了後に `MergeDock` の UI スモークテスト（`tests/merge/phase_smoke.spec.ts`）を実行し、Diff Merge タブ露出とメトリクス送信が有効化されていることを確認する。【F:docs/IMPLEMENTATION-PLAN.md†L24-L48】

## 2. テレメトリとメトリクス
### 2.1 主要イベント
| イベント | 発火元 | 必須フィールド | 指標 | 備考 |
| --- | --- | --- | --- | --- |
| `autosave.save.completed` | `src/lib/autosave.ts` 保存完了フック | `duration_ms`, `phase`, `retry_count`, `bytes`, `feature="autosave"` | `autosave_p95`, リトライ率 | AutoSave ポリシーの `awaiting-lock` → `updating-index` 遷移完了を表す。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L96-L214】 |
| `autosave.restore.result` | `restoreFrom*` API | `success`, `source`, `duration_ms`, `feature="autosave"` | `restore_success_rate` | 失敗時は `retryable=false` を付与し再試行抑止。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L158-L214】 |
| `autosave.lock.error` | ロック API (`src/lib/locks.ts`) | `code`, `retryable`, `attempt`, `lease_id`, `feature="autosave"` | ロック失敗監視 | `retryable` に応じた指数バックオフを Analyzer が再計算。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L184-L214】 |
| `merge.diff.apply` | Merge Engine | `precision`, `auto_accept_ratio`, `auto_accepted`, `hunk_count`, `feature="merge"` | `merge_auto_success_rate` | `precision` 値で Phase B の露出状態を可視化。【F:docs/IMPLEMENTATION-PLAN.md†L58-L69】 |
| `rollback.executed` | `scripts/monitor/collect-metrics.ts` | `phase_from`, `phase_to`, `trigger_metric`, `timestamp` | ロールバック履歴 | Reporter が incident ログを作成するトリガー。【F:docs/IMPLEMENTATION-PLAN.md†L76-L118】 |

### 2.2 集計ロジック
1. Collector は JSONL を `workflow-cookbook/logs/<feature>/<YYYY-MM-DD>.jsonl` に追記し、Day8 アーキテクチャの冪等管理（`.meta/state.json`）を利用する。【F:Day8/docs/day8/design/03_architecture.md†L1-L31】【F:docs/TELEMETRY-COLLECTOR-AUTOSAVE.md†L13-L61】
2. Analyzer は 15 分バッチで以下を算出し `metrics/autosave_merge/<date>.json` に出力する。
   - `autosave_p95`: `autosave.save.completed.duration_ms` の P95（1h/24h 窓）。
   - `restore_success_rate`: `autosave.restore.result.success` の成功率（overall/current/history）。
   - `merge_auto_success_rate`: `merge.diff.apply.auto_accepted=true` の比率（`precision` ごとに分解）。【F:docs/IMPLEMENTATION-PLAN.md†L86-L151】
3. Reporter は Analyzer 出力を読み、SLO 違反時に incident ブロックと Slack/PagerDuty 通知を生成する。【F:docs/IMPLEMENTATION-PLAN.md†L69-L118】

### 2.3 メトリクス閾値
| 指標 | 警告 | 致命 (ロールバック起点) | 関連フェーズ |
| --- | --- | --- | --- |
| `autosave_p95` (1h) | >700ms | >900ms or P95>2.5s が 1 日 3 回 | Phase A 系列【F:docs/IMPLEMENTATION-PLAN.md†L52-L69】 |
| `restore_success_rate` | <0.97 | <0.995 | Phase A-1/A-2【F:docs/IMPLEMENTATION-PLAN.md†L56-L69】 |
| `merge_auto_success_rate` | <0.85 | <0.80 | Phase B-0/B-1【F:docs/IMPLEMENTATION-PLAN.md†L58-L69】 |
| `rollback.executed` | - | 発火時に incident | 全フェーズ【F:docs/IMPLEMENTATION-PLAN.md†L76-L118】 |

### 2.4 イベントスキーマ & バリデーション
- Collector は `schemas/events/autosave.json` / `schemas/events/merge.json` を利用し、`feature`・`phase`・`retryable` 等の必須フィールドを JSON Schema で検証する。スキーマ更新は `pnpm run schema:lint` に追加し、CI で逸脱を検知する。【F:Day8/docs/day8/design/03_architecture.md†L19-L31】
- Analyzer では `phase_rollout.window` 設定（`1h`・`24h`・`7d`）に従って移動ウィンドウ集計を実施し、SLO 判定時には `phase` と `feature` の両方でパーティションを分ける。これにより Phase A/B が同日に混在しても閾値評価が崩れない。【F:docs/IMPLEMENTATION-PLAN.md†L52-L101】
- Reporter のテンプレートは `templates/reports/rollout_phase.md` を新設し、各メトリクスの最新値とダッシュボード URL (`/dashboards/autosave-merge`) を埋め込む。テンプレート適用は Day8 Reporter のプラガブルレンダラを使用する。【F:Day8/docs/day8/design/03_architecture.md†L32-L78】

## 3. ロールバック動線
### 3.1 判断フロー
```mermaid
digraph Rollback {
  rankdir=LR;
  Start[フェーズ開始];
  Collect[Collector: イベント収集\n15分サイクル];
  Analyze[Analyzer: autosave_p95 / restore_success / merge_auto_rate 算出];
  Gate[フェーズ基準判定];
  Warn[Slack #launch-autosave 警告];
  Rollback["pnpm run flags:rollback --phase <prev>"];
  Notify[Incident 通知 + RCA 着手];
  Start -> Collect -> Analyze -> Gate;
  Gate -> Warn [label="閾値未達 (警告)"];
  Gate -> Rollback [label="重大閾値"];
  Warn -> Collect;
  Rollback -> Notify -> Collect;
}
```
- フローチャートは Implementation Plan §2.1.2 をコード化したもので、Collector/Analyzer/Reporter の責務は Day8 アーキテクチャと一致させる。【F:docs/IMPLEMENTATION-PLAN.md†L69-L118】【F:Day8/docs/day8/design/03_architecture.md†L1-L31】

### 3.2 オペレーション手順
1. Analyzer が致命閾値を検知したら `incident_queue.json` に `action="notify_rollback"` を追加し、Reporter が Slack/PagerDuty 通知を送信する。【F:docs/IMPLEMENTATION-PLAN.md†L69-L118】【F:docs/TELEMETRY-COLLECTOR-AUTOSAVE.md†L92-L133】
2. On-call が `pnpm run flags:rollback --phase <prev>` を実行し、`docs/CONFIG_FLAGS.md` の既定値を前フェーズへ戻す。実行ログは `rollback.executed` イベントとして Collector へ投入する。【F:docs/IMPLEMENTATION-PLAN.md†L76-L118】
3. ロールバック後 1 営業日以内に RCA を `reports/rca/` へ格納し、Phase A-1 から再開する。Reporter は日次レポートへ RCA リンクを掲載する。【F:docs/IMPLEMENTATION-PLAN.md†L118-L155】

### 3.3 フラグ反映と監査
- Rollback コマンド完了後、`src/config/flags.ts` の `DEFAULT_FLAGS` を読み込む Smoke Test (`tests/flags/rollback.spec.ts`) を必ず実行し、`autosave.enabled` と `merge.precision` が Ledger の記録と一致することを確認する。【F:docs/IMPLEMENTATION-PLAN.md†L9-L52】
- 監査ログは `governance/audit/phase_rollout/<date>.jsonl` に記録し、`action`（`promote`/`rollback`）、`phase`, `executor`, `reason`, `metrics_snapshot` を残す。`metrics_snapshot` には Analyzer 出力ファイルのハッシュを格納し、改竄を防ぐ。【F:Day8/docs/day8/design/03_architecture.md†L42-L78】

## 4. 実装チェックリスト
- [ ] `FlagSnapshot` に `source` を保持し、Phase ごとの設定差異をトラッキングできる状態にする。【F:docs/IMPLEMENTATION-PLAN.md†L9-L52】
- [ ] AutoSave 保存/復旧イベントが `feature` ラベルで Collector に送信され、Analyzer がメトリクスを算出できることをテストで担保する。【F:docs/TELEMETRY-COLLECTOR-AUTOSAVE.md†L13-L133】
- [ ] `merge.diff.apply` イベントが `precision` と紐付いて Phase B ロールアウトの露出制御に利用できることを QA で確認する。【F:docs/IMPLEMENTATION-PLAN.md†L58-L69】
- [ ] ロールバック手順（`flags:rollback` 実行→通知→RCA）が Runbook と一致することを Incident リハーサルで検証する。【F:docs/IMPLEMENTATION-PLAN.md†L69-L133】

## 5. 依存ドキュメント
- AutoSave 保存・復元 API: [docs/AUTOSAVE-DESIGN-IMPL.md](../AUTOSAVE-DESIGN-IMPL.md)
- Collector/Analyzer パイプライン: [Day8/docs/day8/design/03_architecture.md](../../Day8/docs/day8/design/03_architecture.md)
- テレメトリ詳細設計: [docs/TELEMETRY-COLLECTOR-AUTOSAVE.md](../TELEMETRY-COLLECTOR-AUTOSAVE.md)
- ロールアウト実装計画: [docs/IMPLEMENTATION-PLAN.md](../IMPLEMENTATION-PLAN.md)
