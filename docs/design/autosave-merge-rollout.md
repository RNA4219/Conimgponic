# AutoSave & Diff Merge ロールアウト設計書

## 0. フラグポリシーと段階導入条件
`docs/IMPLEMENTATION-PLAN.md` で規定されたフラグ解決順序とフェーズ条件をロールアウトの前提として明文化する。

### 0.1 フラグ解決ポリシー
| フラグ | 準備フェーズ既定値 | 解決順序 | 目的 | 備考 |
| --- | --- | --- | --- | --- |
| `autosave.enabled` | `false` | `import.meta.env` → `localStorage` → `docs/CONFIG_FLAGS.md` | `App.tsx` で AutoSave ランナー起動可否を制御 | `FlagSnapshot.source` を残しつつ後方互換のローカル参照を縮退。【F:docs/IMPLEMENTATION-PLAN.md†L9-L52】 |
| `merge.precision` | `legacy` | `import.meta.env` → `localStorage` → `docs/CONFIG_FLAGS.md` | `MergeDock.tsx` の Diff Merge タブ精度切替 | `legacy` でタブを隠蔽し、`beta/stable` を段階解放。【F:docs/IMPLEMENTATION-PLAN.md†L15-L52】 |

### 0.2 フェーズ条件の抽出
| フェーズ | 対象ユーザー | 既定値 (`autosave.enabled` / `merge.precision`) | エントリー条件 | ロールバック条件 | 補足 |
| --- | --- | --- | --- | --- | --- |
| Phase A-0 (準備) | 全ユーザー | `false` / `legacy` | 初期状態。保存遅延 P95>2.5s が 1 日 3 回発生するとロールバック審査。【F:docs/IMPLEMENTATION-PLAN.md†L52-L60】 | 即ロールバックで Phase A-0 を維持。【F:docs/IMPLEMENTATION-PLAN.md†L52-L69】 | フラグ OFF 時の回帰試験を継続。【F:docs/IMPLEMENTATION-PLAN.md†L138-L155】 |
| Phase A-1 (QA Canary) | 開発/QA | `true` / `legacy` | 保存 P95 ≤2.5s **かつ** QA 10 ケース完了。【F:docs/IMPLEMENTATION-PLAN.md†L56-L63】 | 保存 P95>2.5s または 復旧成功率<99.5%。【F:docs/IMPLEMENTATION-PLAN.md†L56-L69】 | `flags:rollback --phase A-0` を Runbook で即時実行。【F:docs/IMPLEMENTATION-PLAN.md†L89-L95】 |
| Phase A-2 (β) | ベータ招待 | `true` / `legacy` | 復元 QA 12/12 合格、SLO 違反ゼロ。【F:docs/IMPLEMENTATION-PLAN.md†L57-L64】 | 復元失敗率≥0.5% または クラッシュ率 baseline+5%。【F:docs/IMPLEMENTATION-PLAN.md†L57-L69】 | 失敗時は QA Canary から再開。【F:docs/IMPLEMENTATION-PLAN.md†L70-L75】 |
| Phase B-0 (Merge β) | ベータ招待 | `true` / `beta` | Diff Merge QA 20 ケース完了、自動マージ率≥80%。【F:docs/IMPLEMENTATION-PLAN.md†L58-L66】 | 自動マージ率<80% または 重大バグ>3 件/日。【F:docs/IMPLEMENTATION-PLAN.md†L58-L69】 | Merge 指標は Analyzer が 15m 粒度で算出。【F:docs/IMPLEMENTATION-PLAN.md†L76-L89】 |
| Phase B-1 (GA) | 全ユーザー | `true` / `stable` | AutoSave/マージ SLO を 5 日連続達成しリリースノート承認。【F:docs/IMPLEMENTATION-PLAN.md†L60-L67】 | 任意 SLO 未達が 24h 継続 または 重大事故報告。【F:docs/IMPLEMENTATION-PLAN.md†L60-L75】 | ロールバック後 1 営業日以内に RCA を共有。【F:docs/IMPLEMENTATION-PLAN.md†L118-L133】 |

## 1. ロールバック判断と監視指標
Collector/Analyzer が継続的に監視するメトリクスと判断フローを以下に統合する。

### 1.1 監視項目と閾値
| フェーズ | 対象フラグ | 監視項目 | 閾値 / 切替条件 | ロールバック条件 | 監視担当 |
| --- | --- | --- | --- | --- | --- |
| Phase A-0 | `autosave.enabled=false` | 保存遅延 P95 | ≤2.5s | 1 日 3 回以上で保存遅延 >2.5s。【F:docs/IMPLEMENTATION-PLAN.md†L52-L60】 | Collector: 保存イベント収集 / Analyzer: P95 算出 |
| Phase A-1 | `autosave.enabled=true` (QA) | 保存遅延 P95, 復旧失敗率 | 保存 P95 ≤2.5s **かつ** 復旧失敗率 ≤0.5%。【F:docs/IMPLEMENTATION-PLAN.md†L56-L69】 | 保存 P95>2.5s または 復旧成功率<99.5%。【F:docs/IMPLEMENTATION-PLAN.md†L56-L69】 | Collector: 保存/復旧イベント JSONL / Analyzer: QA レポート照合 |
| Phase A-2 | `autosave.enabled=true` (Beta) | 復元成功率, クラッシュ率増分 | 復元成功率 ≥99.5%、クラッシュ増分 ≤5%。【F:docs/IMPLEMENTATION-PLAN.md†L57-L69】 | 復元失敗率 ≥0.5% または クラッシュ増分 >5%。【F:docs/IMPLEMENTATION-PLAN.md†L57-L69】 | Collector: 復元/クラッシュログ / Analyzer: 移動平均 |
| Phase B-0 | `merge.precision=beta` | 自動マージ率, 重大バグ報告数 | 自動マージ率 ≥80%、重大バグ報告 ≤3 件/日。【F:docs/IMPLEMENTATION-PLAN.md†L58-L69】 | 自動マージ率 <80% または 重大バグ報告 >3 件/日。【F:docs/IMPLEMENTATION-PLAN.md†L58-L69】 | Collector: Merge JSONL / Analyzer: 日次集計 |
| Phase B-1 | `merge.precision=stable` | 自動マージ率 (2 日移動平均), SLO 遵守 | ≥80% を 2 日連続で維持。【F:docs/IMPLEMENTATION-PLAN.md†L58-L75】 | 2 日連続で <80% または 任意 SLO 未達が 24h 継続。【F:docs/IMPLEMENTATION-PLAN.md†L58-L75】 | Collector: 15m 粒度集計 / Analyzer: ダッシュボード発報 |

### 1.2 ロールバックフロー
- `scripts/monitor/collect-metrics.ts` を 15 分間隔で実行し、Analyzer が判定・Reporter が決裁記録を残す。【F:docs/IMPLEMENTATION-PLAN.md†L76-L95】
- SLO 未復旧が 24 時間継続した場合は `pnpm run flags:rollback --phase <prev>` で直前フェーズに戻し、Canary から再開する。【F:docs/IMPLEMENTATION-PLAN.md†L69-L95】
- 通知は Slack テンプレート `templates/alerts/rollback.md` を利用し、Reporter がロールバック時刻と原因を記録する。【F:docs/IMPLEMENTATION-PLAN.md†L86-L95】

## 2. テレメトリ TDD テスト（SLO 先行）
Collector→Analyzer→Reporter パイプラインを前提に、SLO 監視を最優先で検証するテスト観点を整理する。【F:Day8/docs/day8/design/03_architecture.md†L1-L31】

| カテゴリ | テスト観点 | 目的 | 参照 |
| --- | --- | --- | --- |
| SLO 違反検知 | 保存遅延 P95 が閾値超過した際に `autosave.slo.violation` を出力し、Analyzer が 5 分以内に再計算するかを検証。 | Phase A のロールバック判断を自動化。 | 【F:docs/IMPLEMENTATION-PLAN.md†L52-L95】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L96-L206】 |
| 復旧成功率 | `restore` イベントから 99.5% 成功率を算出できることをテスト。 | Phase A-1/A-2 の継続監視。 | 【F:docs/IMPLEMENTATION-PLAN.md†L56-L69】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L96-L206】 |
| 自動マージ率 | `merge.diff.apply` イベントで自動マージ率 ≥80% を計算し、Reporter が一致するか検証。 | Phase B 移行条件とロールバック監視。 | 【F:docs/IMPLEMENTATION-PLAN.md†L58-L69】 |
| ロック再試行 | `autosave.lock.error` の `retryable` 属性で Collector が指数バックオフを継続し、Analyzer が再試行回数を記録できるか。 | Lock 障害時の通知と再試行手順を TDD 化。 | 【F:docs/AUTOSAVE-DESIGN-IMPL.md†L184-L260】 |
| 通知連携 | Slack/GitHub 通知イベントが Reporter ログと整合するかを検証。 | ロールバック決裁のトレーサビリティ確保。 | 【F:docs/IMPLEMENTATION-PLAN.md†L69-L95】 |

テスト仕様は `tests/telemetry/TEST_PLAN.md` に集約し、CI で継続検証する。【F:docs/IMPLEMENTATION-PLAN.md†L96-L155】

## 3. イベントスキーマと Collector/Analyzer 連携
### 3.1 AutoSave Save Event
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
- Collector: 既存 JSONL パイプへ保存し、`feature` タグで AutoSave 指標を分離。【F:docs/IMPLEMENTATION-PLAN.md†L96-L104】【F:Day8/docs/day8/design/03_architecture.md†L1-L31】
- Analyzer: duration P95 / retry率を算出し Reporter へ出力。

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
- Analyzer: 成功率と復旧時間を算出し、Phase A の継続基準に反映。【F:docs/IMPLEMENTATION-PLAN.md†L56-L69】

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
- Analyzer: `auto_accept_ratio` から自動マージ率を算出し、Reporter が SLO を確認。【F:docs/IMPLEMENTATION-PLAN.md†L58-L69】

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
- Collector: `retryable` に基づき指数バックオフ継続可否を判断。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L184-L260】
- Analyzer: 再試行回数を集計して Reporter が再試行負荷を報告。

### 3.5 通知要件マトリクス
| イベント | 通知チャネル | 必須ペイロード | 運用目的 | 参照 |
| --- | --- | --- | --- | --- |
| `autosave.slo.violation` | Slack `#launch-autosave`, GitHub Issue Draft | `phase`, `metric`, `threshold`, `actual`, `retryable` | SLO 超過の即時共有と RCA 起票。 | 【F:docs/IMPLEMENTATION-PLAN.md†L69-L95】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L96-L215】 |
| `autosave.lock.readonly` | UI トースト + Reporter 日次サマリ | `reason`, `last_error`, `lease_id` | 閲覧専用モード移行のユーザ通知。 | 【F:docs/AUTOSAVE-DESIGN-IMPL.md†L184-L260】 |
| `merge.diff.apply` | Reporter 日次サマリ | `auto_accept_ratio`, `precision`, `phase` | Phase B のマージ品質監視。 | 【F:docs/IMPLEMENTATION-PLAN.md†L58-L69】 |
| `rollback.executed` | Slack テンプレート `templates/alerts/rollback.md`, Reporter | `phase_from`, `phase_to`, `timestamp`, `trigger_metric` | ロールバック履歴と再開条件のトレーサビリティ。 | 【F:docs/IMPLEMENTATION-PLAN.md†L86-L95】 |

## 4. SLO 違反時の通知・再試行手順
1. Collector が SLO 閾値逸脱イベントを検知したら Slack Webhook と GitHub Issue Draft を即時送信し、Reporter が決裁ログへ追記する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L96-L215】【F:docs/IMPLEMENTATION-PLAN.md†L69-L95】
2. Analyzer は 5 分以内に対象フェーズのメトリクスを再計算し、`retryable=true` の場合は指数バックオフ (0.5s→1s→2s→4s) を最大 5 回まで実施する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L170-L215】
3. 再試行後も SLO 未達なら `flags:rollback --phase <prev>` を実行し、UI へ `autosave.lock.readonly` を通知。Reporter はロールバック理由と次回 Canary スケジュールを Runbook に記録する。【F:docs/IMPLEMENTATION-PLAN.md†L69-L95】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L184-L260】
4. ロールバック完了後 1 営業日以内に RCA を `reports/rca/` へ格納し、次フェーズ再導入時は QA Canary から再開する。【F:docs/IMPLEMENTATION-PLAN.md†L118-L133】

## 5. Collector/Analyzer 連携検証
- Collector は JSONL ログを `workflow-cookbook/logs` へ集約し、Analyzer が `analyze.py` でメトリクスを算出する Day8 パイプラインを前提とする。【F:Day8/docs/day8/design/03_architecture.md†L1-L27】
- AutoSave/Diff Merge イベントは既存データモデル（duration P95、成功率、自動マージ率）に適合し、Reporter が日次レポートへ反映することを CI テストで保証する。【F:Day8/docs/day8/design/03_architecture.md†L3-L27】【F:docs/IMPLEMENTATION-PLAN.md†L96-L151】
- ロック関連ログは `project/autosave/` に限定し、Day8 アーティファクト (`workflow-cookbook/`) を汚染しないことをチェックリストで確認する。【F:docs/IMPLEMENTATION-PLAN.md†L61-L75】【F:docs/IMPLEMENTATION-PLAN.md†L143-L151】

## 6. ロールアウト・フォローアップフロー
- Phase A: AutoSave を段階的に有効化し、保存遅延・復旧成功率を連続監視。SLO 違反発生時はセクション 4 の手順でロールバックする。【F:docs/IMPLEMENTATION-PLAN.md†L52-L95】
- Phase B: Diff Merge 精度を `beta`→`stable` へ引き上げ、自動マージ率と重大バグ報告数を監視する。【F:docs/IMPLEMENTATION-PLAN.md†L58-L75】
- いずれも Collector→Analyzer→Reporter の既存フローでテレメトリを巡回させ、Canary/GA の進捗とロールバック履歴を共有する。【F:Day8/docs/day8/design/03_architecture.md†L1-L31】

## 7. レビュー用チェックリスト
- [ ] フラグ解決ポリシー（セクション 0.1）が `src/config/flags.ts` 実装と一致する。
- [ ] 各フェーズの監視指標と閾値が Collector ダッシュボードに設定済みである。
- [ ] テレメトリ整合性テスト（セクション 2）が CI に追加されている。
- [ ] イベントスキーマ（セクション 3）と通知マトリクス（セクション 3.5）が実装と整合する。
- [ ] SLO 違反手順（セクション 4）と Collector/Analyzer 連携検証（セクション 5）が運用 Runbook とリンクされている。
