# Day8（Eight-Day Starter）
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](http://www.apache.org/licenses/LICENSE-2.0)

Day8 は「観測 → 反省 → 提案」のループを CI に組み込み、安全に改善サイクルを回すためのスターターセットです。自動修正を行わず、レポートと Issue 提案で止めることで OSS プロジェクトでも安全に導入できます。

このリポジトリを把握する際は、以下の LLM-BOOTSTRAP を起点に参照範囲を絞り込んでください。

<!-- LLM-BOOTSTRAP v2 -->
読む順番:
1. [docs/ROADMAP_AND_SPECS.md](docs/ROADMAP_AND_SPECS.md) …… Day8 全体像と Birdseye 更新フローの索引
2. [docs/birdseye/index.json](docs/birdseye/index.json) …… Day8 ルートの鳥瞰マップ
3. [`docs/birdseye/caps/`](docs/birdseye/caps) 配下の `<path>.json` …… 必要ノードだけ point read（個別カプセル）
4. [docs/birdseye/hot.json](docs/birdseye/hot.json) …… 優先参照ノードの即時確認

フォーカス手順:
- 直近変更ファイル±2hopのノードIDを index.json から取得
- 対応する caps/*.json のみ読み込み

更新フロー:
- Day8 ルート文書を更新したら `python workflow-cookbook/tools/codemap/update.py --targets docs/birdseye/index.json --emit index+caps` を実行し、index/caps を同期コミットする
- Birdseye の編集順序と `generated_at` 同期ルールは [docs/birdseye/README.md](docs/birdseye/README.md) を参照
<!-- /LLM-BOOTSTRAP -->

詳細な構成を確認する際は、上記の導線に沿って必要なドキュメントを順番に参照してください。

## リポジトリ構成
- `docs/` Day8 の仕様・運用・ガバナンスドキュメント集（詳細は索引ページ [`docs/README.md`](docs/README.md) を参照）。
- `docs/ROADMAP_AND_SPECS.md` Day8 のロードマップと仕様に関するライトな索引メモ。
- `governance/` ポリシー定義や CODEOWNERS などの統制設定。
- `workflow-cookbook/logs/` CI で収集した観測ログ。
- `workflow-cookbook/reports/` 反省結果や Issue 提案レポートの出力先。
- `workflow-cookbook/scripts/` ログ解析やレポート生成のユーティリティ。
- `workflow-cookbook/` Day8 を他リポジトリへ導入する際のワークフロー例。

## ガバナンスと参加
- コントリビューション手順は [`CONTRIBUTING.md`](CONTRIBUTING.md) を参照してください。
- 行動メモは [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) を参照してください。
- 収録ライセンスと第三者ライセンス表記は [`LICENSE`](LICENSE)、[`NOTICE`](NOTICE)、[`workflow-cookbook/LICENSE`](workflow-cookbook/LICENSE) を参照してください。

## セットアップ
Day8 を新しいリポジトリへ導入する際は、[`INSTALL.md`](INSTALL.md) の手順に従ってワークフローや初期ファイルをルートに配置してください。GitHub Actions では `test` → `reflection` → `pr_gate` の順で実行され、安全デチューンされた反省レポートを生成します。

## 使い方のヒント
- 初期状態では `workflow-cookbook/reflection.yaml` の `analysis.max_tokens` が 0 のため LLM 呼び出しは抑制されています。必要に応じて `engine` 設定と合わせて有効化してください。
- 生成されたレポート（`workflow-cookbook/reports/` 配下）と提案を確認し、人間が修正 PR を作成する運用を前提としています。

## License
Apache-2.0. Unless noted otherwise, files copied from this repo into other projects remain Apache-2.0 and require retaining NOTICE text in redistributions.

---
**キーワード**: Day8, safe autonomy, propose-only CI, reflective devops
