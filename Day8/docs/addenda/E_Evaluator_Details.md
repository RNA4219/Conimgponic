# 付録E: 評価器構成

## Status
- Published: 2025-10-28
- Steward: Day8 Quality WG

## 目的
Katamari 付録Eの評価器設計を Day8 の自動評価ラインへ適用し、BERTScore・ROUGE・ルール判定で構成される複合スコアリングの前提、入力形式、出力解釈を一元化する。品質レビューで参照すべき運用上の注意点を整理し、Birdseye / Guardrails での差分追跡に備える。

## コンポーネント概要
| コンポーネント | 役割 | 主要設定 | 入力 | 出力 |
| --- | --- | --- | --- | --- |
| BERTScore 評価器 | モデル出力と参照回答の意味的近さを計測 | `bert-base-multilingual-cased`、`rescale_with_baseline=true`、`batch_size=16` | 正解テキスト、モデル生成テキスト | Precision/Recall/F1（0〜1）、閾値 `>=0.85` で合格判定補助 |
| ROUGE 評価器 | 要約タスクの文字列一致度を測定 | `rougeL`, `rouge1`（トークン化: SentencePiece）、`stemmer=ja_jumanpp` | 正解テキスト、モデル生成テキスト | ROUGE-1/L スコア、閾値 `>=0.70` で合格判定補助 |
| ルール判定エンジン | Guardrails 由来の制約チェック | `ruleset=quality/guardrails/rules.yaml`、`mode=blocking` | モデル生成テキスト、メタ情報（タスク種別、ユーザー指示） | 違反コード（`minor`, `major`, `critical`）、自動失格判定 |

## 入力と前処理
1. **正解テキスト** — `workflow-cookbook/EVALUATION.md` に準拠した YAML ケースから取得。`prompt`, `expected`, `metadata` を含め、正解側はマスク済み個人情報であることを確認する。
2. **モデル生成テキスト** — Day8 Analyzer の推論ログから取得。HTML や Markdown を含む場合でも、`quality/pipeline/normalize.py` の正規化処理を通してから評価器に渡す。
3. **メタ情報** — タスク種別、リージョン、モデル ID を含める。ルール判定では `task_type` が `report` / `proposal` の場合に追加チェック（禁止語句、根拠リンク数）を有効化する。

## 出力整形
- **BERTScore / ROUGE**: 小数第4位で四捨五入し、`metrics.json` の `semantic`・`surface` セクションへ格納する。評価ログには `threshold_met` のブール値を追加する。
- **ルール判定**: 最も高い重大度を `violations.max_severity` として記録。`critical` の場合は即座に `overall_pass=false` とし、Birdseye Hot リストへ追加する。
- **集計**: 3 評価の結果から `overall_pass` を決定する。`critical` 違反が無く、かつ BERTScore F1 と ROUGE-L のいずれかが閾値を満たす場合に合格とする。閾値未達でもヒューリスティックで再審査対象（`needs_review=true`）。

## 運用チェックリスト
1. `quality/pipeline/normalize.py` と `workflow-cookbook/EVALUATION.md` の入力形式が一致しているか照合する。
2. ルールセット更新時は `ruleset=quality/guardrails/rules.yaml` をコミット単位でバージョン管理し、Birdseye `hot.json` の評価器ノードを同期する。
3. BERTScore / ROUGE のモデル更新やトークナイザ変更を行った場合は、Day8 Ops のスモークテスト（`scripts/quality/eval_smoke.sh`）を実行し、`metrics.json` の差分をレビュー記録へ添付する。
4. `overall_pass=false` のケースを週次でレビューし、ルール判定とスコア基準の乖離がないか確認する。乖離が継続する場合は閾値調整を提案し、Appendix E を更新する。

## 連携ドキュメント
- [Day8 品質評価プロセス](../day8/quality/06_quality.md)
- [Katamari Evaluation Baseline](../../workflow-cookbook/EVALUATION.md)
- [Appendix I: Day8 テストケース観点](I_Test_Cases.md)

## 改訂ガイド
- 閾値やモデルを更新したら、BERTScore/ROUGE の設定値とルール判定ロジックを本付録に反映し、Birdseye index/caps/hot の `generated_at` を揃える。
- ルールセットの破壊的変更は Day8 Governance WG の承認ログと共に記録し、`docs/day8/quality/06_quality.md` の手順・チェックリストへ反映する。

