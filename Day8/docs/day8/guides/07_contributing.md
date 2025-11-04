# 貢献ガイド（Contributing）

## ブランチ/PR ルール
- 1タスク=1ブランチ=1PR（±300行/≤3ファイルを目安）
- Birdseye の `generated_at` 連番は PR ごとに 1 回だけ進め、index / hot / 関連カプセルを必ず同時更新する（1PR 原則）。
- レビュー前・マージ前に rebase で追従
- 公開 API/スキーマ変更は先行PR（契約合意）
- `Day8/workflow-cookbook/GUARDRAILS.md` に従い、テストを先に書く TDD（RED→GREEN→リファクタ）の実行ログを PR の `Tests` セクションに明記する。

## タスク化（衝突回避）
- タスクは独立性が保てる粒度まで分割し、責務の重複（コンフリクト）を避ける。
- 変更は小さく・短時間で終わるブランチとして切り、早めの rebase で常に最新に追従する。
- リスクや重なりがある場合は **Task Seeds**（ガイド: [`docs/TASKS.md`](../../TASKS.md) / 保存先: `docs/seeds/TASK.<slug>-YYYY-MM-DD.md`）を作成し、Katamari テンプレートの「背景/手順/検証ログ/フォローアップ」各セクションを埋めてから作業を開始する。

## 最小差分・TDD
- `workflow-cookbook/HUB.codex.md` のタスク分割ルールに従い、1 Seed あたり 0.5 日以内で完結する作業だけを扱う。Public API へ影響する場合は事前に移行計画を記録し、Task Seed と PR 両方で共有する。
- `docs/TASKS.md` の Plan/Patch/Tests/Commands/Notes を逐次更新し、レビュー前に検証ログとローカルコマンドの成功結果を揃える。
- 実装は TDD を徹底し、RED テスト→実装→GREEN→リファクタの順で進める。テストの実行ログは Task Seed の Tests セクションおよび PR ノートへ転記する。
