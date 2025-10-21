# 付録B: UI モック

## Status
- Published: 2025-10-27
- Steward: Day8 Design WG

## 目的
Day8 の主要 CLI 操作とレポート確認フローを ASCII で可視化し、Katamari 付録Bと同様にレビュー環境や画面共有が制限された状況でも UI 骨子を素早く共有できるようにする。

## 活用タイミング
- Collector/Analyzer/Reporter の CLI 挙動をリモートレビューで説明するときに、画面を共有できない環境で参照する。
- `reports/today.md` や `reports/issue_suggestions.md` の構成変更を検討する際、想定レイアウトを事前に擦り合わせる。
- 新規コントリビューターへ Day8 レポート運用の概観をブリーフィングするときに、CLI→レポートの導線を提示する。

## ASCII モック

### Analyzer CLI ランディング
```
+------------------------------------------------------------------------------+
| Day8 Analyzer CLI                                                            |
+------------------------------------------------------------------------------+
| $ python workflow-cookbook/scripts/analyze.py --report logs/test_run.jsonl   |
|                                                                              |
|  ┌───────────────┬────────────┬────────────┬──────────────┐                 |
|  │ Phase         │ Status     │ Duration   │ Notes        │                 |
|  ├───────────────┼────────────┼────────────┼──────────────┤                 |
|  │ collector     │ OK         │ 00:01:24   │ 128 records  │                 |
|  │ analyzer      │ OK         │ 00:00:42   │ metrics→tmp  │                 |
|  │ reporter      │ WRITING    │ 00:00:08   │ today.md     │                 |
|  └───────────────┴────────────┴────────────┴──────────────┘                 |
|                                                                              |
|  Pass rate: 96.4%   Flaky: 2   Pending issues: 1                             |
|  Next actions: review reports/today.md → draft issue                         |
+------------------------------------------------------------------------------+
```

### 日次レポート（`reports/today.md`）ダッシュボード
```
+==============================================================================+
| Day8 Report: today.md                                                        |
+==============================================================================+
| Header                                                                       |
| ──────                                                                       |
| • Summary: Collector pass rate 96.4% / Analyzer 100%                         |
| • Generated at: 2025-10-27T09:00:00Z                                         |
|                                                                              |
| Why-Why Analysis                                                             |
| ───────────────                                                             |
| 1. Why did the regression suite slow down?                                   |
|    → Collector waiting on staging deploy                                     |
| 2. Why was staging delayed?                                                  |
|    → Pending approval in governance queue                                    |
|                                                                              |
| Metrics                                                                      |
| ───────                                                                      |
| • pass_rate ............ 0.964                                               |
| • duration_p95 ......... 322s                                                |
| • flaky_rate ........... 0.018                                               |
|                                                                              |
| Next Steps                                                                   |
| ─────────                                                                   |
| [ ] Ops: Confirm staging deploy slot                                         |
| [ ] Reporter: Send summary to governance channel                             |
| [ ] Proposer: Prepare draft issue (issue_suggestions.md)                     |
+==============================================================================+
```

## 連携ドキュメント
- [Day8 Architecture ASCII Map](../Architecture_ASCII.md) — コンポーネント境界を把握しつつ CLI→レポートの動きを追う際に併用する。
- [Day8 アーキテクチャ設計](../day8/design/03_architecture.md) — Collector/Analyzer/Reporter の責務や生成物と照合し、UI モックとの差分を確認する。
- [日次レポートテンプレート](../day8/examples/10_examples.md) — サンプル出力とモックの整合をレビューする。

## 改訂ガイド
- CLI オプションやレポートレイアウトを変更したら、本付録の図を更新し Birdseye `summary`/`maintenance`/`generated_at` を同期する。
- Analyzer/Reporter の生成手順が変わった場合は、`docs/Architecture_ASCII.md`・`docs/day8/design/03_architecture.md` と合わせて更新する。
