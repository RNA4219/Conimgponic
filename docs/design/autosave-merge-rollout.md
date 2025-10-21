# AutoSave & Diff Merge ロールアウト設計書

## 1. フラグ監視指標
`docs/IMPLEMENTATION-PLAN.md` に定義された Phase A/B の切替条件とロールバック条件を Collector/Analyzer で監視する。閾値は Reporter 経由で共有し、逸脱時に即時ロールバック可否を判断できるようにする。

### 1.1 監視項目と閾値
| フェーズ | 対象フラグ | 監視項目 | 閾値 / 切替条件 | ロールバック条件 |
| --- | --- | --- | --- | --- |
| Phase A-0 | `autosave.enabled=false` | 保存遅延 P95 | ≤2.5s | 1 日 3 回以上で保存遅延 >2.5s【F:docs/IMPLEMENTATION-PLAN.md†L52-L60】 |
| Phase A-1 | `autosave.enabled=true` (QA) | 保存遅延 P95 / 復旧失敗率 | 保存 P95 ≤2.5s **かつ** 復旧失敗率 ≤0.5% | 保存 P95>2.5s または 復旧成功率<99.5%【F:docs/IMPLEMENTATION-PLAN.md†L52-L69】 |
| Phase A-2 | `autosave.enabled=true` (Beta) | 復元成功率 / クラッシュ率増分 | 復元成功率 ≥99.5%、クラッシュ増分 ≤5% | 復元失敗率 ≥0.5% または クラッシュ増分 >5%【F:docs/IMPLEMENTATION-PLAN.md†L57-L69】 |
| Phase B-0 | `merge.precision=beta` | 自動マージ率 / 重大バグ報告数 | 自動マージ率 ≥80%、重大バグ報告 ≤3 件/日 | 自動マージ率 <80% または 重大バグ報告 >3 件/日【F:docs/IMPLEMENTATION-PLAN.md†L58-L67】 |
| Phase B-1 | `merge.precision=stable` | 自動マージ率 (2 日移動平均) | ≥80% を 2 日連続で維持 | 2 日連続で <80% または 任意 SLO 未達が 24h 継続【F:docs/IMPLEMENTATION-PLAN.md†L58-L75】 |

### 1.2 ロールバック判断
- 共通ロールバック: 24 時間以内に SLO を復旧できない場合は直前フェーズのフラグ値へ戻し、Canary から再開する。【F:docs/IMPLEMENTATION-PLAN.md†L72-L75】
- 監視は `scripts/monitor/collect-metrics.ts` で 15 分粒度のメトリクスを収集し、Analyzer が基準を判定する。【F:docs/IMPLEMENTATION-PLAN.md†L76-L89】
- ロールバック時は Slack テンプレート `templates/alerts/rollback.md` を利用し、Reporter に決定記録を残す。【F:docs/IMPLEMENTATION-PLAN.md†L86-L95】

## 2. テレメトリ TDD テスト (先行定義)
`Day8/docs/day8/design/03_architecture.md` の Collector→Analyzer→Reporter パイプラインを前提に、AutoSave/Diff Merge のテレメトリ整合性テストを TDD で実装する。テスト詳細は `tests/telemetry/TEST_PLAN.md` に整理し、以下の観点を必須とする。【F:Day8/docs/day8/design/03_architecture.md†L1-L31】

1. AutoSave 保存イベントが `Collector` JSONL に `feature="autosave"` 付きで記録され、Analyzer が保存時間 P95 を算出できること。【F:docs/IMPLEMENTATION-PLAN.md†L96-L104】
2. AutoSave 復旧イベントが保存履歴との突合で 99.5%以上の成功率を算出できること。【F:docs/IMPLEMENTATION-PLAN.md†L52-L69】
3. Diff Merge 実行イベントが自動確定率を算出できる payload を送出し、Analyzer 集計と Reporter 出力が一致すること。【F:docs/IMPLEMENTATION-PLAN.md†L57-L69】
4. Lock 例外イベントが `retryable` 属性で Collector 側再試行判定に使われ、Analyzer が再試行率を集計できること。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L120-L146】
5. SLO 違反アラートイベントが `governance/policy.yaml` の閾値と一致し、Reporter のサマリに通知経路が記録されること。【F:docs/IMPLEMENTATION-PLAN.md†L69-L75】

## 3. イベントスキーマと Collector/Analyzer 連携
### 3.1 AutoSave Event Schema
```json
{
  "ts": "2024-06-30T12:34:56.789Z",
  "component": "autosave",
  "event": "autosave.save.completed",
  "duration_ms": 1875,
  "bytes": 24576,
  "feature": "autosave",
  "lease_id": "uuid",
  "retry_count": 0,
  "retryable": true,
  "phase": "A-1"
}
```
- `Collector`: 既存 JSONL パイプに保存。`feature` タグで AutoSave 指標を分離。【F:docs/IMPLEMENTATION-PLAN.md†L96-L100】【F:Day8/docs/day8/design/03_architecture.md†L1-L31】
- `Analyzer`: duration の P95 集計と `retryable`/`retry_count` で再試行率算出。
- `Reporter`: Phase ごとの保存遅延を日次レポートに掲載。

### 3.2 AutoSave Restore Event
```json
{
  "ts": "2024-06-30T12:40:01.234Z",
  "component": "autosave",
  "event": "autosave.restore.result",
  "source": "history",
  "success": true,
  "duration_ms": 4200,
  "feature": "autosave",
  "phase": "A-2"
}
```
- Analyzer は成功件数と母数から復旧成功率を算出。

### 3.3 Diff Merge Event
```json
{
  "ts": "2024-07-05T04:12:00.000Z",
  "component": "merge",
  "event": "merge.diff.apply",
  "precision": "beta",
  "auto_accepted": true,
  "hunk_count": 12,
  "auto_accept_ratio": 0.83,
  "feature": "merge",
  "phase": "B-0"
}
```
- Analyzer が `auto_accepted` と `auto_accept_ratio` から自動マージ率を計算し、Reporter が SLO を確認。

### 3.4 Lock Exception Event
```json
{
  "ts": "2024-06-30T12:45:00.000Z",
  "component": "autosave",
  "event": "autosave.lock.error",
  "code": "lock-unavailable",
  "retryable": true,
  "attempt": 2,
  "max_attempts": 3,
  "lease_id": "uuid",
  "feature": "autosave",
  "phase": "A-1"
}
```
- Collector 側で `retryable` を見て指数バックオフを継続。Analyzer は再試行回数を集計し、Reporter が再試行負荷を監視。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L100-L144】

## 4. SLO 違反時の通知・再試行手順
`docs/AUTOSAVE-DESIGN-IMPL.md` の例外設計と整合させた運用手順を以下に更新する。

1. `Collector` が SLO 閾値逸脱イベント (`event="autosave.slo.violation"` など) を検知したら、即時に Slack Webhook と GitHub Issue Draft を送信する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L96-L111】【F:docs/IMPLEMENTATION-PLAN.md†L69-L75】
2. Analyzer は 5 分以内に対象フェーズのメトリクスを再計算し、`retryable` が true のイベントについては指数バックオフ (0.5s→1s→2s) を 3 回実施する。再試行完了イベントを Collector にフィードバックする。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L120-L141】
3. 再試行後も SLO 未達の場合は直前フェーズのフラグへロールバックし、`autosave.lock.readonly` を UI へ通知。Reporter はロールバック実施時間と次回 Canary スケジュールを手順書に記載する。【F:docs/IMPLEMENTATION-PLAN.md†L72-L75】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L120-L146】
4. ロールバック完了後 1 営業日以内に原因分析レポートを共有し、次フェーズ再開時は QA Canary から再導入する。【F:docs/IMPLEMENTATION-PLAN.md†L72-L75】

## 5. ロールアウト・フォローアップフロー
- Phase A: AutoSave を段階的に有効化し、保存遅延と復旧成功率を連続監視。
- Phase B: Diff Merge 精度を beta→stable へ引き上げ、自動マージ率を監視。
- 各フェーズは Collector→Analyzer→Reporter の既存フローでテレメトリを巡回させ、SLO 違反時は上記手順でロールバックと通知を行う。【F:Day8/docs/day8/design/03_architecture.md†L1-L31】【F:docs/IMPLEMENTATION-PLAN.md†L52-L75】

## 6. レビュー用チェックリスト
- [ ] 各フェーズの監視指標と閾値が `Collector` ダッシュボードに設定されている。
- [ ] AutoSave/Diff Merge イベントが JSONL スキーマ (セクション 3) を満たす。
- [ ] テレメトリ整合性テスト (セクション 2) が CI に追加済み。
- [ ] SLO 違反時の通知・再試行手順 (セクション 4) が運用 Runbook に連結されている。
- [ ] ロールバック手順後の Canary 再開計画が Reporter に記録されている。
