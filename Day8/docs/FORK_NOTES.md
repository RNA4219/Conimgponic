# Day8 Fork Notes（Katamari 派生向け）

Katamari 本家の `docs/FORK_NOTES.md` を前提に、Day8 フォークで追加運用するコンポーネント・依存関係・ライセンス同梱ルールをまとめます。Katamari 側の更新を取り込んだら本ページと Birdseye (`docs/birdseye/index.json` / `docs/birdseye/caps/docs.FORK_NOTES.md.json`) を同じコミットで再同期してください。

## Day8 固有コンポーネント
- **Day8 ドキュメント群** — `docs/day8/` 配下の仕様・設計・運用ディレクトリを一括で維持します。Collector / Analyzer / Reporter / Proposer / Governance の責務は [Day8 アーキテクチャ](day8/design/03_architecture.md) を最優先で参照し、Mermaid が読めない環境では [Architecture ASCII](Architecture_ASCII.md) を併用します。
- **Birdseye 拡張** — `docs/birdseye/index.json`・`docs/birdseye/caps/`・`docs/birdseye/hot.json` は Day8 固有の索引／ホットリストを含むため、本家よりも参照ハブが多層化しています。更新フローは [docs/birdseye/README.md](birdseye/README.md) の「index → caps → hot」順を維持してください。
- **workflow-cookbook サブツリー** — CI ログ・レポート・スクリプトは `workflow-cookbook/` をサブツリー取り込みして共有します。Collector 出力は `workflow-cookbook/logs/`、Reporter 出力は `workflow-cookbook/reports/` に揃え、[リポジトリ README](../README.md) に記載された参照順序を守ります。

## Day8 追加依存関係
- **Python 3.11+** — Birdseye 再生成ツール `workflow-cookbook/tools/codemap/update.py` は標準ライブラリのみで動作しますが、実行には Python 3.11 以上が必須です。
- **Lint & Test スイート** — Katamari の既定に加え、Day8 では `mypy --strict`、`ruff`、`pytest`、`node --test` を常に通すことを [CONTRIBUTING.md](../CONTRIBUTING.md) で要求しています。フォークで追加モジュールを導入する場合は、CI で同じ順序のジョブを維持してください。
- **GitHub Actions 反省フロー** — `test` → `reflection` → `pr_gate` の 3 ワークフローが Day8 導入手順の基本であり、`workflow-cookbook/scripts/analyze.py` を用いた Analyzer が必須です。[INSTALL.md](../INSTALL.md) を確認し、必要ファイルの同梱を忘れないでください。

## ライセンスと同梱ルール
- **Day8 本体** — Apache License 2.0 (`LICENSE`) を維持し、フォークでも変更しません。
- **workflow-cookbook 資産** — `workflow-cookbook/` 配下は MIT License です。フォークで取り込む際は [NOTICE](../NOTICE) に列挙された表記と `workflow-cookbook/LICENSE` の同梱を必須にしてください。
- **リリース前チェック** — 依存追加でライセンス同梱が変わる場合は [Day8 Release Checklist](Release_Checklist.md) の該当項目を更新し、Birdseye を同一コミットで再生成します。

## 参照・更新順
1. Katamari 本家 `docs/FORK_NOTES.md`
2. 本ページ（Day8 Fork Notes）
3. Birdseye (`docs/birdseye/index.json` → `docs/birdseye/caps/docs.FORK_NOTES.md.json` → `docs/birdseye/hot.json`)
4. Upstream 手順 ([docs/UPSTREAM.md](UPSTREAM.md) / [docs/UPSTREAM_WEEKLY_LOG.md](UPSTREAM_WEEKLY_LOG.md))

フォークで Day8 固有の依存や配布物が増えた場合は、上記順序で差分確認を行い、`docs/UPSTREAM_WEEKLY_LOG.md` に同期ログを追記してください。
