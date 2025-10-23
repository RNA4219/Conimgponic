# VS Code Extension Telemetry 統合設計

## 1. 背景
Day8 パイプラインでは Collector → Analyzer → Reporter が 15 分バッチで JSONL を授受し、AutoSave/精緻マージのメトリクスからロールバック可否を判断する。【F:Day8/docs/day8/design/03_architecture.md†L3-L44】【F:docs/IMPLEMENTATION-PLAN.md†L321-L400】
VS Code 拡張経由で送出するイベントを既存パイプラインへ統合するため、`docs/IMPLEMENTATION-PLAN.md` の Collector 連携要件と Day8 アーキテクチャを踏まえて設計を固定する。【F:docs/IMPLEMENTATION-PLAN.md†L67-L88】

## 2. イベントマッピング
既存の Collector チャネルと拡張メッセージ (`ExtToWv`) の対応を次表に定義する。【F:docs/TELEMETRY-COLLECTOR-AUTOSAVE.md†L10-L51】【F:docs/src-1.35_addon/API-CONTRACT-EXT.md†L45-L85】

| Collector イベント (既存) | 目的 / 計測指標 | 拡張イベント (Extension → Webview) | 伝搬メタデータ | 備考 |
| --- | --- | --- | --- | --- |
| `autosave.save` (`component="autosave"`, `kind="save"`) | 保存 P95、retry カウント | `snapshot.result { ok: true }` 完了直後に `status.autosave { state: "saved" }` | `request_id` は `snapshot.result` の `reqId` を採用。`detail.phase` と `detail.retry_count` を Collector に転記。【F:docs/TELEMETRY-COLLECTOR-AUTOSAVE.md†L20-L35】 | AutoSave Runner の既存 JSONL ログと突合し、`autosave_p95` を算出する。 |
| `autosave.failure` (`status="failure"`) | 保存失敗率、リトライ発火数 | `snapshot.result { ok: false, error }` と `error { code, message }` | `error.code` を `detail.error_code` に、`retryable` を Analyzer 向け `error.retryable` に写像。 | `retryable=false` を 3 件連続検出した時点で Phase ロールバック候補。 |
| `autosave.ui.*` (`feature="autosave"`) | UI 操作トラッキング (`phaseChanged` など) | `status.autosave` の `state` 遷移を UI 層が `ui.autosaveIndicator.*` に変換 | `state` → `{ fromPhase, toPhase }`、`retryCount` は `detail.retry_count` を継承。【F:docs/AUTOSAVE-INDICATOR-UI.md†L108-L123】 | 送信量は ±5% SLO 内でレート制御。【F:docs/IMPLEMENTATION-PLAN.md†L84-L88】 |
| `merge.finish` (`component="merge"`, `kind="merge"`, `status="success"`) | 自動マージ率、処理時間 | `merge.result { ok: true, trace }` | `trace.stats` を `merge` サブオブジェクトへ埋め込み、`conflict_segments` を Collector が再計算。 | Analyzer で `merge_auto_success_rate` に利用。【F:docs/TELEMETRY-COLLECTOR-AUTOSAVE.md†L63-L85】 |
| `merge.failure` (`status="failure"` or `warning`) | 衝突率、リトライ判定 | `merge.result { ok: false, error }` および `error` ブロードキャスト | `error.retryable` を Collector の `status` 変換 (`warning` / `failure`) に使用。 | `retryable=true` は Collector で最大 3 回再試行。【F:docs/IMPLEMENTATION-PLAN.md†L403-L408】 |
| `flag_resolution` (`feature="flags"`) | フラグ正規化失敗監視 | `error { code:"flag-validation", details: FlagSnapshot }` | `details.source` を `tags` へ転記し、Analyzer が配信経路ごとに SLO を確認。 | Phase 移行時の rollback 判定資料。【F:docs/IMPLEMENTATION-PLAN.md†L67-L72】 |

## 3. 15 分バッチ変換方針
`snapshot.result` / `status.autosave` / `merge.result` / `error` 系を Collector の 15 分サイクルへ集約する際のキーとロールバック閾値を定義する。【F:docs/IMPLEMENTATION-PLAN.md†L324-L395】

| 対象イベント | 集約キー (`groupBy`) | 15 分指標 | 警告 / ロールバック閾値 | 根拠 |
| --- | --- | --- | --- | --- |
| `snapshot.result` (保存) | `{ phase, tenant, client_version, feature:"autosave" }` | `duration_ms` P95, `status` 成功率 | 警告: P95 > 750ms, ロールバック: P95 ≥ 900ms or 成功率 < 0.95 | Day8 SLO と `autosave_p95` / `restore_success_rate` しきい値。【F:docs/TELEMETRY-COLLECTOR-AUTOSAVE.md†L63-L105】【F:docs/IMPLEMENTATION-PLAN.md†L330-L334】 |
| `status.autosave` (UI状態) | `{ phase, tenant, client_version }` | `state="saved"` 達成率、`retryCount` 平均 | 警告: 達成率 < 0.98, ロールバック: 達成率 < 0.95 or `retryCount` 平均 ≥ 1.0 | Phase ガード条件 (`lock:readonly` 発火数、`autosave:failure` 連続)。【F:docs/IMPLEMENTATION-PLAN.md†L77-L82】 |
| `merge.result` | `{ phase, tenant, client_version, precision }` | `status` 成功率、`trace.processing_ms` P95 | 警告: 成功率 < 0.85, ロールバック: 成功率 < 0.80 or P95 ≥ 5000ms | Phase B-0/B-1 の `merge_auto_success_rate` 基準。【F:docs/IMPLEMENTATION-PLAN.md†L333-L334】【F:docs/TELEMETRY-COLLECTOR-AUTOSAVE.md†L63-L85】 |
| `error` (拡張全般) | `{ component, code, phase }` | `retryable=false` 件数、連続失敗数 | 警告: 単一バッチで `retryable=false` ≥ 1, ロールバック: 同イベントが連続 3 バッチ | Incident トリガと再試行枯渇フロー。【F:docs/IMPLEMENTATION-PLAN.md†L403-L408】 |

`tenant`/`client_version` は既存 Collector メタデータと揃え、フェーズ別のロールアウト判定を 15 分単位で可視化する。【F:docs/IMPLEMENTATION-PLAN.md†L323-L335】

## 4. RED テストケース（`tests/monitoring/extensions-telemetry.spec.ts`）
以下の RED ケースを起点に TDD を行い、Collector モックが 15 分サイクルの整合性を確認できるようにする。【F:docs/IMPLEMENTATION-PLAN.md†L403-L408】

1. **イベント欠損**: `snapshot.result` が 15 分窓で 0 件の場合、Analyzer が `autosave_p95` を `null` として扱い、Reporter が "データ未収集" 通知を生成する。
2. **閾値超過通知**: `merge.result` 成功率が 0.78 に低下したフィクスチャを投入し、Analyzer が `rollback_required=true` で Phase B-0 ロールバックを指示する経路を検証する。
3. **リトライ連鎖**: `error` イベントで `retryable=true` が 3 連続発生した後に `retryable=false` が続くシナリオを構築し、Collector が再試行尽きで `degraded` → Reporter PagerDuty 通知まで到達することを確認する。
4. **UI 状態異常**: `status.autosave` の `state="saved"` 達成率が 0.94 に落ちたケースで、Analyzer が Phase A-1 の警告とロールバック推奨を返すことを確認する。

## 5. Collector / Analyzer / Reporter 契約
拡張イベントを取り込む際の I/O 契約を下表に整理する。【F:docs/TELEMETRY-COLLECTOR-AUTOSAVE.md†L53-L126】

| レイヤ | 入力 | 出力 | 主な処理 | 注意点 |
| --- | --- | --- | --- | --- |
| Collector (`scripts/monitor/collect-metrics.ts`) | 拡張イベント JSONL (`feature`=`autosave` or `merge`) | `reports/monitoring/<timestamp>.jsonl` (15 分窓) | P95/成功率計算、`groupBy` でバケット化 | `.meta/state.json` で冪等性管理、`retryable` 判定を保持。 |
| Analyzer (`monitor:analyze` / `monitor:score`) | Collector 出力 | `monitor:score` JSON（`metric`, `value`, `breach`, `rollbackTo`） | フェーズ別 SLO 判定、`rollback_required` 決定 | 分母 0 は `null`、閾値超過時は `incident_ref` 添付。 |
| Reporter (`monitor:report` / `monitor:notify`) | Analyzer 判定結果 | Slack/PagerDuty 通知、`reports/alerts/<timestamp>.md` | テンプレート整形、`pnpm run flags:rollback` 実行ログ添付 | Incident-001 連携と RCA 生成を 1 サイクル以内に完了。 |

### JSONL スキーマ v1
Collector 出力は以下の JSON Schema をベースに拡張する。【F:docs/TELEMETRY-COLLECTOR-AUTOSAVE.md†L20-L45】

```json
{
  "version": 1,
  "ts": "<ISO8601>",
  "component": "autosave" | "merge" | "flags",
  "kind": "save" | "restore" | "merge" | "ui" | "error",
  "workspace_id": "<uuid>",
  "phase": "A-0" | "A-1" | "A-2" | "B-0" | "B-1",
  "tenant": "enterprise" | "indie",
  "client_version": "<semver>",
  "request_id": "<uuid>",
  "status": "success" | "warning" | "failure",
  "detail": {
    "duration_ms": 0,
    "retry_count": 0,
    "error_code": "<string>",
    "retryable": true
  },
  "merge": {
    "precision": "legacy" | "beta" | "stable",
    "conflict_segments": 0,
    "stats": {
      "auto": 0,
      "conflict": 0
    }
  },
  "tags": ["feature:autosave", "phase:A-1"]
}
```

`workspace_id`/`tenant`/`client_version` は既存 Day8 Collector のフィルタ条件と揃え、Analyzer がフェーズ別スライスで集計できるようにする。【F:docs/IMPLEMENTATION-PLAN.md†L323-L335】

## 6. 運用チェックリスト
15 分サイクルの運用で確認すべき項目を整理する。【F:docs/IMPLEMENTATION-PLAN.md†L367-L420】

1. `pnpm ts-node scripts/monitor/collect-metrics.ts --window=15m` が成功し、最新バッチに `snapshot.result`/`merge.result` の両方が含まれているかを確認する。
2. Analyzer の `monitor:score` で `breach=true` が発生した場合、`rollback_required` と `rollbackTo` が設定されているかをレビューし、Reporter 通知前に Runbook に記録する。
3. Reporter が `pnpm run flags:rollback --phase <prev>` を実行したログを Slack/PagerDuty テンプレートへ添付し、Incident-001 連携を 1 サイクル以内に完了させる。
4. 連続 2 サイクルで `retryable=false` が検出された場合は `reports/rca/` にドラフトを配置し、ガバナンスへ共有する。
5. Phase 再開時は `phase` フィールドと `precision` が Rollout テンプレートと一致しているかダッシュボードで確認し、逸脱があれば即ロールバックコマンドを準備する。

