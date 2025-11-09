---
intent_id: DOC-LEGACY
owner: docs-core
status: active
last_reviewed_at: 2025-10-28
next_review_due: 2025-11-28
---

# CI 段階的導入 要件定義

## 1. 目的

- プロダクトの成熟度や開発段階に応じて CI テストを段階的に有効化し、初期負荷を抑えつつ品質ゲートを段階的に強化する。
- フェーズ移行時に必要なドキュメント更新・運用タスクを明確化し、チェックリストやガバナンス設定と整合を取る。

## 2. スコープ

- 対象: Workflow Cookbook をベースとした派生リポジトリ、および本リポジトリ自身。
- 対象 CI: lint・静的解析・単体/統合テスト・セキュリティスキャンなど `ci-config.md` に定義されたジョブ群。
- 非対象: インフラ構築用 CI、デプロイ自動化。

## 3. 利害関係者

| ロール | 主な責務 |
| --- | --- |
| プロダクトオーナー | フェーズ移行の承認、必要リソースの確保 |
| テックリード / QA | テスト観点の定義、CI カバレッジ評価、フェーズ移行レビュー |
| 開発チーム | 必須テストの実装・修正、CI 実行結果の是正 |
| オペレーション担当 | フェーズごとのチェックリスト更新、運用負荷評価 |

## 4. 用語定義

- **フェーズ**: CI 運用の成熟度を示す段階。Phase 0 (最小) から Phase 3 (フルカバレッジ) までを定義。
- **ゲーティング CI**: フェーズで必須とされ、失敗時にマージを拒否するジョブ。
- **オプショナル CI**: 実行するが失敗してもフェーズ移行までは任意対応とするジョブ。

## 5. フェーズ別要件

### Phase 0（プロトタイピング）

- ゲーティング CI: YAML/Lint プリチェック (`styles/qa` ベース)、主要ブランチのマージ保護設定。
- オプショナル CI: pytest smoke（任意）。
- 昇格条件: README に CI 方針を記載し、`governance/policy.yaml` に対象外理由を明記。

### Phase 1（MVP / 仕様固め）

- ゲーティング CI: Ruff、mypy、pytest smoke、secrets scan。
- オプショナル CI: Full pytest、npm test（対象サービスがある場合）。
- 昇格条件: `docs/TASKS.md` に CI 既知課題ログを追記し、`CHECKLISTS.md#Daily` に結果確認項目を追加。

### Phase 2（Beta / 安定化）

- ゲーティング CI: Full pytest、npm test（存在時）、pip-audit、safety。
- オプショナル CI: Bandit、security headers test、container scan。
- 昇格条件: `RUNBOOK.md` に CI 手順を反映し、`CHANGELOG.md` に CI 拡張を通番で記録。

### Phase 3（GA / 本番運用）

- ゲーティング CI: Bandit、security headers、container scan を含む全 CI ジョブ、メトリクス収集ジョブ。
- オプショナル CI: 負荷テスト（需要に応じて）。
- 昇格条件: `EVALUATION.md` の KPI 達成率が 2 スプリント連続で 95% 以上、フォーク先でも Phase 2 以上の運用が確認済み。

## 6. フェーズ移行プロセス

1. `docs/TASKS.md` に Phase 移行検討の Task Seed を登録し、KPI・負荷・既知課題を整理する。
2. `HUB.codex.md` から関連ドキュメントの更新対象を抽出し、必要差分を `CHANGELOG.md#[Unreleased]` に仮記載する。
3. PR 作成前に `CHECKLISTS.md#Development` を用いて CI カバレッジの差分確認を実施する。
4. 移行 PR で `governance/policy.yaml` の `ci.required_jobs` を更新し、GitHub ブランチ保護設定との差異をレビューする。
5. マージ後に `RUNBOOK.md` と `docs/ci-config.md` を同期し、リリースノートで Phase 更新を通知する。

## 7. 運用・監視要件

- CI 実行時間はフェーズ昇格時に測定し、直近フェーズ比で +20% を超える場合は軽量化タスクを併記する。
- フェーズ 2 以上では `governance/metrics.yaml` の CI スループット指標を週次で Birdseye ログと突合する。
- フェーズ 3 では `docs/addenda/G_Security_Privacy.md` に定義されたセキュリティゲートをすべてゲーティング扱いにする。

## 8. リスクと緩和策

| リスク | 緩和策 |
| --- | --- |
| CI 時間の急増 | テストの列実行設定、キャッシュ利用、負荷測定タスクの追加 |
| フェーズ移行準備不足 | Task Seed での事前検証、`RUNBOOK.md` との突合、ウォークスルー実施 |
| 派生リポとの差異拡大 | `docs/FORK_NOTES.md` で CI フェーズの差を記録し、リリース前に同期 |

## 9. 成果物とトレーサビリティ

- 本ドキュメントを `docs/ROADMAP_AND_SPECS.md` のロードマップ節へリンクする。
- フェーズ移行毎に `CHANGELOG.md` と `CHECKLISTS.md` を更新し、Birdseye へ影響範囲を記録する。
- 追加 CI ジョブは `.github/workflows/` の該当ファイルにコメントで Phase を明記する。

## 10. 今後の課題

- フェーズ評価を自動化する CLI (`tools/ci/phase_evaluator.py`) の要否検討。
- Phase 3 超の拡張（負荷テストやケイオス試験）の実装可否を次期ロードマップで審議。
