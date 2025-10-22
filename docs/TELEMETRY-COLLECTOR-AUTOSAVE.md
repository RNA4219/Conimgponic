# Telemetry／Collector連携設計（AutoSave & 精緻マージ）

## 1. 背景と目的
- AutoSave 実装詳細（[docs/AUTOSAVE-DESIGN-IMPL.md](./AUTOSAVE-DESIGN-IMPL.md)）で定義された保存ポリシーと復旧 API に基づき、保存 P95・復旧成功率を継続監視する。
- 精緻マージ（MERGE-DESIGN-IMPL.md §2）の自動マージ率を Collector → Analyzer → Reporter の既存パイプラインへ編入する。
- Day8 アーキテクチャ方針（[Day8/docs/day8/design/03_architecture.md](../Day8/docs/day8/design/03_architecture.md)）で整理された Collector/Analyzer の責務分離を堅持しつつ、SLO 逸脱時にロールバック通知をトリガーできるイベント連携を定義する。

## 2. 収集サイクルとイベント定義
### 2.1 収集サイクル
| フェーズ | 入力 | Collector 動作 | 出力 | 保持ポリシー |
| --- | --- | --- | --- | --- |
| AutoSave 保存完了 | `src/lib/autosave.ts` → `AutoSaveInitResult.flushNow` 完了フック | 1 件の JSONL を `workflow-cookbook/logs/autosave/<YYYY-MM-DD>.jsonl` へ追記 | AutoSave 保存イベント | 日次ローテーション（ファイル単位） |
| AutoSave 復旧 | `restoreFrom*` 成功/失敗 | 同上 | AutoSave 復旧イベント | 30 日保持（`gzip` 圧縮） |
| 精緻マージ | Merge Engine 成功/失敗コールバック | `workflow-cookbook/logs/merge/<YYYY-MM-DD>.jsonl` へ追記 | 精緻マージイベント | 90 日保持（失敗は 180 日） |
| Collector → Analyzer バッチ | 15 分ごと（Cron or GH Actions） | `logs/**` を集約し `analyzer/input/<ISO>.ndjson` を生成 | バッチ投入ファイル | 24 時間で削除（Analyzer 側に移送済み前提） |

### 2.2 JSONL イベントスキーマ案
各イベントは 1 行 JSON（UTF-8, LF）。`version` は後方互換のための整数。`tags` は柔軟な検索用。

```json
{
  "version": 1,
  "ts": "2024-04-03T12:34:56.789Z",
  "component": "autosave",
  "kind": "save", // save | restore | merge
  "workflow": "editor-session", // source workflow 名
  "run_id": "gha_12345", // CI/ワーカー識別子
  "request_id": "3f5a...", // 保存処理 UUID
  "duration_ms": 312, // save: 書込完了まで, restore: 復旧処理, merge: マージ計算
  "status": "success", // success | warning | failure
  "detail": {
    "bytes": 20480,
    "generation": 12,
    "retry_count": 0,
    "phase": "updating-index" // autosave 最終 phase
  },
  "merge": {
    "strategy": "semantic",
    "conflict_segments": 0
  },
  "restore": {
    "source": "current", // current | history
    "prompt_shown": true
  },
  "tags": ["autosave", "slo:p95", "run:gha"]
}
```

- `component`=`autosave` or `merge` を必須。`kind` に応じて `detail/restore/merge` のサブオブジェクトを使用。未使用フィールドは省略し Collector 側で null を出力しない。
- AutoSave 保存イベントでは `detail.phase` を [AutoSaveStatusSnapshot.phase](./AUTOSAVE-DESIGN-IMPL.md#41-ステータススナップショット) に合わせる。
- Merge イベントは `merge.strategy` を MERGE-DESIGN-IMPL.md で定義された `strategies` 値と一致させる。

### 2.3 Collector 実装ノート
- `workflow-cookbook/logs/.meta/state.json` に最終書込の `ts`・`request_id` を保存し冪等性を担保。
- ローテーション・圧縮は既存 `scripts/collector_rotate.sh` に `autosave`/`merge` ルールを追加し、保存ポリシーの履歴世代 20 を超えるデータ削除と競合しないよう OPFS 内 GC と非同期化する。
- フィーチャーフラグ `autosave.enabled=false` の場合は保存イベントを生成せず、Analyzer 側で 0 件を検知しスキップする。

## 3. Analyzer 拡張仕様
### 3.1 集計対象
- 入力: `analyzer/input/<ISO>.ndjson`（Collector が 15 分ごとに生成）。
- 出力: `workflow-cookbook/logs/metrics/autosave_merge/<YYYY-MM-DD>.json`。

### 3.2 集計ロジック
1. バッチごとに AutoSave 保存イベントをフィルタし、`duration_ms` の P95 を計算（集計対象期間: 当日, 窓: 1 時間スライディング, 追加で日次 P95 も保持）。
2. AutoSave 復旧イベントで `status=success` の割合を算出し、`restore.source` 別に成功率を記録。
3. Merge イベントで `status=success` を `total` で割り自動マージ率を算出。`conflict_segments>0` の場合は `status` が `warning` とみなし自動マージ率から除外（=手動確認が必要なケース）。
4. 結果は以下の JSON 形式で保存。

```json
{
  "date": "2024-04-03",
  "p95_ms": {
    "autosave": {
      "window_1h": 480,
      "window_24h": 510
    }
  },
  "success_rate": {
    "restore": {
      "overall": 0.98,
      "current": 0.99,
      "history": 0.94
    },
    "merge": 0.92
  },
  "samples": {
    "autosave_save": 4200,
    "autosave_restore": 96,
    "merge": 310
  },
  "last_updated": "2024-04-03T23:45:00Z"
}
```

5. Analyzer は結果を `reports/today.md` のメトリクス節へ書き戻す既存フックを再利用し、閾値超過時に incident テンプレートへ incident_ref を添付。

### 3.3 P95/成功率計算手順
- P95: `numpy.percentile(dataset, 95, method="linear")`（サンプル数 20 未満は平均値で代用し、`samples.autosave_save` に `"note": "fallback_mean"` を添える）。
- 成功率: `success_count / total_count`（分母 0 の場合は null を格納し Reporter で “データ未収集” と表示）。
- 自動マージ率: `status=success` の割合。`warning` は `retryable` として Collector へフィードバック。

### 3.4 ロールバック通知トリガー
1. Analyzer で `p95_ms.autosave.window_1h > 750` または `success_rate.restore.overall < 0.95` または `success_rate.merge < 0.9` を検出。
2. Incident エントリを `reports/incident_queue.json` に追記し、`action": "notify_rollback"` を設定。
3. Reporter が日次ジョブで incident キューを読み、対象の `action` に応じて `reports/today.md` にロールバック勧告ブロックを差し込み、`issue_suggestions.md` に “Auto rollback investigation” を追記。
4. Proposer が `notify_rollback` のチケットを草案 Issue として起票（自動変更多様性を避けるため `label: autosave-rollback` を付与）。

## 4. モニタリング／ダッシュボード要件
- SLO パネルは `metrics/autosave_merge/*.json` を Grafana Loki → Prometheus Exporter で取り込み。
- ダッシュボード構成:
  - **AutoSave P95**: 1h/24h の二系列。SLO しきい値 700ms（警告）/900ms（致命）。
  - **Restore Success Rate**: overall/current/history の 3 系列。0.97 警告, 0.95 致命。
  - **Auto Merge Rate**: 成功率と警告（`warning` 率）を重ね合わせ。
  - **Event Volume**: `samples.*` をヒートマップ表示し低サンプル期を把握。
- アラート連携: Prometheus Alertmanager で上記 SLO 超過を検知し、Slack `#autosave-alerts` と PagerDuty `AutoSave Merge` サービスへ通知。致命アラートはロールバック通知トリガーの条件に一致する。

## 5. テスト観点（シミュレーション）
1. **ログ収集テスト**: モックイベントを 100 件生成し Collector スクリプトを実行、日次ローテーションと `.meta/state.json` の冪等性を検証。
2. **集計テスト**: 1h ウィンドウの P95 計算を単体テスト化（最小サンプル時のフォールバック含む）。成功率・自動マージ率の `warning` 除外を確認。
3. **通知トリガーテスト**: Analyzer 出力を強制的に閾値超過させ、Reporter が incident ブロックを生成し Proposer へ草案作成を指示するまでの E2E シミュレーション。
4. **ロールバックチェーン回帰**: Incident キューに複数エントリがある場合でも 1 つずつ処理され、ダブり通知が発生しないことを確認する。

## 6. 依存関係と開発ノート
- AutoSave/Merge エンジン仕様（タスク1・6）で定義されたメトリクス名・リトライポリシーを参照し、Collector イベント生成タイミングを一致させる。
- 既存 Analyzer の `tests/test_analyzer_metrics.py` にシナリオ追加し、mypy/ruff を通過させる（厳格型付けと例外設計を踏襲）。
- 将来のスキーマ改版は `version` をインクリメントし、Analyzer 側で後方互換パーサを実装する。
