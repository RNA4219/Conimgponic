# Day8 Release Checklist (Katamari Flow)

Day8 のリリースは Katamari propose-only 方針に従い、全変更を PR で提案・承認してから本番ブランチへ反映します。本チェックリストは Katamari Release Checklist を Day8 の CI／ドキュメント更新フローへ合わせて調整したものです。Birdseye 同期と `workflow-cookbook/CHECKLISTS.md` の Release セクションを併せて運用してください。

## 1. プランニング & スコープ確定
- [ ] `workflow-cookbook/CHECKLISTS.md` > Release の適用範囲を確認し、PR 説明欄に Priority Score と semver ラベル案を下書きする。
- [ ] 変更内容が Day8 の公開 API や CLI を破壊しないか洗い出し、必要なら `docs/addenda/M_Versioning_Release.md` の互換性ガイドを参照してスコープを再調整する。
- [ ] propose-only 運用のため、`main` 直 push を禁止する分岐保護が有効であること、ならびにレビューア割当が完了していることを確認する。

## 2. 実装ブランチ準備
- [ ] lint (`ruff`)、型検査 (`mypy --strict`)、テスト（`pytest` / `node --test`）のローカル実行結果を記録し、失敗時は fixup ではなく再実装で対応する。
- [ ] リリース対象ファイルに係るドキュメント差分を作成し、Birdseye 対象の更新が必要か判定する。
- [ ] `NOTICE` / `LICENSE` の同梱に影響する依存追加がないかチェックし、必要なら `docs/addenda/H_Deploy_Guide.md` の同梱手順を参照する。

## 3. CI & ドキュメント整合
- [ ] GitHub Actions / ローカル CI の全ジョブ（mypy, ruff, pytest, node:test, Docker ビルド）が成功したログを取得する。
- [ ] Birdseye を `python workflow-cookbook/tools/codemap/update.py --targets docs/birdseye/index.json,workflow-cookbook/docs/birdseye/index.json --emit index+caps` で再生成し、`index.json` → `caps` → `hot.json` の順で差分を確認して `generated_at` を揃える。
- [ ] Birdseye で新規に追加したノード／エッジが `docs/README.md`、`docs/ROADMAP_AND_SPECS.md` から到達可能か確認する。
- [ ] `docs/addenda/M_Versioning_Release.md` の semver 区分に沿って `semver:*` ラベルを更新し、互換性根拠を PR 本文へ反映する。

## 4. レビュー & 承認フロー
- [ ] PR テンプレートに沿って、変更概要・影響範囲・検証結果・Birdseye コマンド出力を記載する。
- [ ] Reviewer が propose-only ブランチで動作確認できるよう、`scripts/`・`tools/` の実行例を提示する。
- [ ] ガバナンス違反（`governance/policy.yaml` の `forbidden_paths` 等）がないか再確認し、必要ならガバナンス担当へエスカレーションする。
- [ ] Reviewer 承認後に `type:*` / `semver:*` ラベル・Priority Score・テスト結果が揃っていることを再確認し、merge queue へ登録する。

## 5. リリース後フォロー
- [ ] タグ付け・リリースノートの作成は `docs/addenda/M_Versioning_Release.md` の手順に従って propose-only で実施する。
- [ ] release ブランチが `main` と一致していることを検証し、Birdseye `hot.json` の重点参照対象に変更があれば更新する。
- [ ] リリース結果を `UPSTREAM_WEEKLY_LOG.md` に追記し、Katamari 側の `workflow-cookbook/CHANGELOG.md` と整合させる。
