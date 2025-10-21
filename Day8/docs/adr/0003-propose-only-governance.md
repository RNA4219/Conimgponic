# ADR 0003: Propose-only 運用と Governance 境界

- **ステータス**: Accepted
- **作成日**: 2025-10-31
- **レビュアー**: @governance, @release-owner
- **関連チケット/タスク**: governance/policy.yaml, docs/Release_Checklist.md

## 背景
- Katamari では自律エージェントが Issue や Draft PR を提案するが、Git ツリーを直接変更しない「propose-only」ポリシーを採用していた。
- Day8 でも Reporter/Proposer が自動生成する成果物が誤って main ブランチへ書き込まれると、ガードレール違反となりロールバックが困難になる。
- `workflow-cookbook/GUARDRAILS.md` と `governance/policy.yaml` の間で propose-only の責務境界が明示されておらず、Docs/ADR に根拠が欠けていた。

## 決定
- Day8 の自動化（Reporter, Proposer）は Git への書き込み・push・merge を行わず、Draft PR / Issue の作成、コメント投稿、アナウンスに限定する。
- 人間の承認があるまでは `workflow-cookbook/scripts/analyze.py` や補助スクリプトも `git commit` を禁止する。必要な場合は `--dry-run` を提供する。
- `docs/Release_Checklist.md` に propose-only 確認ステップを追加し、Reviewer がチェックする。
- `governance/policy.yaml` の制約タグ（例: `propose_only`, `requires_human_merge`）と本 ADR を紐付け、Birdseye で参照できるようにする。

## 根拠
- Katamari の運用では propose-only により、自動化の誤動作が直接 main ブランチへ影響するリスクを回避できた。
- Day8 のリリース承認フローは人間のレビューとガードレールで管理されており、自動化による意図しない変更があると承認記録の整合が崩れる。

## 影響
- Reporter/Proposer に新しい機能を追加する場合は、本 ADR を遵守して CLI オプションやコメント出力のみで完結させる必要がある。
- `workflow-cookbook/GUARDRAILS.md` と `docs/day8/ops/04_ops.md` は propose-only ポリシーのチェックポイントを明記する。
- Birdseye index/caps に ADR 0003 を追加し、Reporter/Proposer の依存元として登録する。

## フォローアップ
- [ ] ガバナンスポリシーの YAML に `propose_only` タグを追加し、本 ADR をリンクする。
- [ ] 自動生成ツールの CLI に `--dry-run` / `--proposal` オプションを統一的に導入する。
