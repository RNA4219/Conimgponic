# 付録D: トリム設計（Trim Design）

## Status
- Published: 2025-10-31
- Steward: Day8 Observability WG

## 目的
Day8 の観測ログをガバナンス基準内で維持しつつ、Analyzer/Reflector の負荷とコストを抑えるためのトリム設計をまとめる。Katamari 版 Appendix D の章立て（対象→戦略→制御→運用）を踏襲し、Collector から Governance へのハンドオフで共有すべき圧縮シナリオと制御パラメータを Day8 向けに再定義した。

## D.1 対象スコープ
- **Observability Streams** — `workflow-cookbook/logs/*.jsonl`, GitHub Actions の `workflow_run` 連携ログ、Analyzer の中間レポート。
- **付随メタデータ** — Birdseye の `generated_at`, `edges`, Capsule summary。圧縮後もトレーサビリティを担保するため、メタデータは削除せず最終版へ転写する。
- **非対象** — Secrets、Incident Evidence（Appendix G/L の保護対象）。これらは Appendix G の保持ポリシーに従い、トリム対象から除外する。

## D.2 圧縮戦略
### D.2.1 Sliding Window
- **概要** — 固定長ウィンドウで最新イベントのみ保持。CI や高速ループで効果が高い。
- **適用条件** — `window_size` が 2 周期を超えた時点で Analyzer の入力を再構築。テストログの短期回転を優先する PR 審査で利用。
- **制御ポイント** — `workflow-cookbook/scripts/analyze.py --trim window`、`reflection.yaml` の `metrics.pass_rate.window`。

### D.2.2 Semantic Compression
- **概要** — OpenAI Embedding（`text-embedding-3-large`）でイベントをクラスタリングし、代表ログのみ保持。
- **適用条件** — ガバナンスレビューや提案生成で冗長な観測が 30 件を超える場合に有効化。Semantic しきい値は Appendix F のプロバイダー設定と整合させる。
- **制御ポイント** — `workflow-cookbook/scripts/analyze.py --trim semantic --semantic-threshold 0.82`、`reflection.yaml` の `analysis.semantic_compress: true`。

### D.2.3 Memory Hybrid
- **概要** — Sliding Window で即時ノイズを除去しつつ、Semantic で要約を生成。Collector の `memory.log` に主要イベントを累積。
- **適用条件** — Day8 Ops が週次レビューを行う際、Retention 指標が SLO を下回った場合に昇格。
- **制御ポイント** — `workflow-cookbook/scripts/analyze.py --trim hybrid --window 200 --semantic-threshold 0.78`、`governance/` 配下の審査ログに適用。

## D.3 保持率指標
| 指標 | 定義 | SLO | フォールバック |
| --- | --- | --- | --- |
| `retention_ratio` | トリム後のイベント数 ÷ トリム前イベント数 | ≧ 0.35（Analyzer の再現性を確保） | 下回った場合、Window サイズを +25% して再実行 |
| `semantic_freshness` | 代表ログが最新イベントを含む割合 | ≧ 0.80 | しきい値未達時に Sliding Window 専用モードへロールバック |
| `governance_review_retained` | ガバナンスレビュー対象タグ（`review:required`）の残存率 | ≧ 0.95 | 95% 未満なら Semantic 距離の緩和またはタグ固定リストを適用 |

## D.4 制御パラメータ
| パラメータ | 既定値 | 配置場所 | 調整メモ |
| --- | --- | --- | --- |
| `window_size` | 150 イベント | `workflow-cookbook/scripts/analyze.py` CLI | CI で 200 イベント超過時は Appendix L の環境変数 `DAY8_TRIM_WINDOW` を参照 |
| `semantic_threshold` | 0.80 | `workflow-cookbook/scripts/analyze.py` CLI, `reflection.yaml` | Appendix F の Embedding 精度更新で見直す |
| `memory_retention_days` | 14 日 | `governance/records/*.md` 運用手順 | Governance 週次レビューで SLO 達成状況を記録 |
| `retention_slo_path` | `docs/day8/quality/06_quality.md` | Analyzer Ops ノート | 品質ドキュメントの SLO 改訂に合わせて更新 |

## D.5 運用判断への反映
1. **Collector** — PR ごとのログ採取では Sliding Window を優先し、`DAY8_TRIM_STRATEGY` が `hybrid` の場合のみ Memory Hybrid を起動。
2. **Analyzer** — Semantic 圧縮後の代表ログで `suggest_issues` を算出し、保持率が SLO 未満なら `python workflow-cookbook/scripts/analyze.py --trim window --window 1.25x` を実行。
3. **Governance** — 週次レビューで Birdseye カプセルの `generated_at` を揃え、`governance_review_retained` が 95% 未満のラインを Incident として記録。

## D.6 更新手順
- 新しい圧縮戦略を導入した場合、本付録の `D.2`〜`D.4` を更新し、Birdseye Capsule の `summary`/`risks`/`generated_at` を再生成する。
- トリム制御パラメータが変更されたときは、`docs/day8/spec/02_spec.md` の DSL 節と `docs/README.md` の付録一覧を同時更新する。
- Analyzer のスクリプト更新に合わせて `python workflow-cookbook/scripts/analyze.py --root . --emit report --focus docs` を実行し、Retention 指標の回帰をチェックする。
