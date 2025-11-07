---
intent_id: DOC-LEGACY
owner: docs-core
status: active
last_reviewed_at: 2025-10-28
next_review_due: 2025-11-28
---

# リリースチェックリスト

詳細なバージョニングとリリース手順は [`docs/addenda/M_Versioning_Release.md`](addenda/M_Versioning_Release.md) を参照する。

Workflow Cookbook の標準手順を土台に、リポジトリ固有の要件へ合わせて整備したチェックリストです。リリースの都度、以下を確認してください。

## 1. バージョンとタグ

- パッケージ / CLI / Docker イメージなど公開物のバージョンを更新し、`git tag` が最新コミットへ付与されていることを確認する。
- タグをリモートへ `git push --tags` 済みであることを確認し、保守対象ブランチへのマージコミットと整合するかを突合する。

## 2. 証跡と記録

- QA / セキュリティ / 品質ゲートの証跡を PR またはリリースチケットへ添付し、確認者が追跡できるようにする。
- 運用メトリクスの基準値は [`governance/metrics.yaml`](../governance/metrics.yaml) を参照し、
  [`RUNBOOK.md`](../RUNBOOK.md)・[`EVALUATION.md`](../EVALUATION.md) の閾値と齟齬がないことを確認する。
- リリースノート（`CHANGELOG.md` など公開ドキュメント）へ今回の変更点と既知の制約を追記し、配布物のバージョンと紐付ける。

## 3. 依存ドキュメントの同期

- `CHECKLISTS.md#release` の要件と整合するように `RUNBOOK.md`・`BLUEPRINT.md` など関連ドキュメントの参照先が最新バージョンへ更新されているかを確認する。
- [docs/UPSTREAM.md](UPSTREAM.md) を派生元の最新版と突合し、差分評価と反映状況が更新済みであることを保証する。
- [docs/UPSTREAM_WEEKLY_LOG.md](UPSTREAM_WEEKLY_LOG.md) を最新のフォローアップログと照合し、未反映の検証結果が残っていないかを確認する。
- サンプルコマンドや設定ファイルがバージョン更新に追随しているかを確認し、差異がある場合は同一リリース内で修正する。

## 4. 配布物の整合性

- リリース成果物（アーカイブ / コンテナ / バイナリ）へ `LICENSE` と `NOTICE` を同梱したことを確認する。
- 配布物のハッシュ値や署名を更新し、公開先で参照される値と一致するかを確認する。

## 5. リリース後のフォローアップ

- デプロイ後の監視ポイントとロールバック手順が RUNBOOK で最新化されているかを確認する。
- 既知のフォローアップタスクがあれば `TASK.codex.md` 等へ記録し、所有者を割り当てる。
