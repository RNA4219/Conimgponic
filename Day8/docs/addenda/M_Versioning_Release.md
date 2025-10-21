# Appendix M — Versioning & Release Operations

Day8 のバージョニングは Katamari 全体の semver ポリシーを継承しつつ、propose-only 運用と CI ドキュメント同期を重視します。本付録はリリース判定の根拠を整理し、`workflow-cookbook/CHECKLISTS.md` の Release セクションと整合するための参照ガイドです。

## 1. セマンティックバージョニング方針
- **MAJOR (`vX.0.0`)**: 後方互換性を壊す変更。Day8 では CLI/JSON 出力・ガバナンスポリシー・主要ワークフローに破壊的変更が含まれる場合のみ該当。PR 冒頭で互換性対策（feature flag や deprecation window）を明記し、ガバナンス承認を必須とする。
- **MINOR (`vX.Y.0`)**: 後方互換性を維持しつつ機能を追加。CI ゲートやチェックリストの増強、Birdseye ノードの追加など、既存利用者に影響しない拡張を対象とする。
- **PATCH (`vX.Y.Z`)**: バグ修正・ドキュメント追補・内部品質改善。挙動差分がないことをテストや検証ログで証明する。Day8 では propose-only ブランチ上で緊急修正を行う場合も PATCH に分類する。

## 2. タグ運用とリリースブランチ
1. リリース対象 PR を `main` に merge 後、propose-only で `release/vX.Y.Z` ブランチを作成する。
2. `git tag vX.Y.Z` を作成し、タグ注釈には変更概要・互換性ラベル・CI 成果を記載する。
3. タグ push と同時に GitHub Release を下書きし、`docs/Release_Checklist.md` のチェック結果と一致することを確認する。
4. 既存タグの修正は禁止。誤りがある場合は新しい PATCH リリースで置き換え、`workflow-cookbook/CHANGELOG.md` と `UPSTREAM_WEEKLY_LOG.md` に経緯を残す。

## 3. 互換性チェック手順
- `docs/Release_Checklist.md` セクション 3 の CI 結果をレビューし、対象バージョンで mypy/ruff/pytest/node:test/Docker が完走しているか確認する。
- CLI/JSON 出力を変更する場合はサンプルを `docs/day8/examples/` に追加し、既存クライアントが破綻しないことを証明する。
- Birdseye の `index.json`・`caps`・`hot.json` の `generated_at` を揃え、ノード間エッジが Release チェックリストで求められる経路を満たしているか確認する。
- `semver:*` ラベルとタグ番号の整合が取れているかレビューし、`workflow-cookbook/CHECKLISTS.md` Release セクションの該当項目へチェック結果を反映する。

## 4. ノート
- propose-only フローではリリース操作も PR 経由で実行するため、タグ作成スクリプトや Release ノート生成ツールに変更がある場合は専用 PR を作成する。
- バージョン更新後は `docs/Release_Checklist.md` を参照して Birdseye とロードマップのリンクを再確認し、Day8/Workflow-cookbook 間の参照が循環しているか検証する。
