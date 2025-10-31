# Conimgponic

## 概要
Conimgponic は「構成（Conテ）+ 画像/映像生成下書き」を加速する Progressive Web App (PWA) です。旧名 Imgponic からの改名後も、既存ユーザーデータやローカル設定を維持したまま進化し続けています。[`templates/README-Conimgponic.md`](templates/README-Conimgponic.md) / [`docs/MIGRATION-NOTES.md`](docs/MIGRATION-NOTES.md)

本レポジトリはアプリケーション本体に加えて、AutoSave・差分マージ・テレメトリ基盤の仕様書と運用ツール群を同梱しています。バージョン v1.3 の設計要点は以下のドキュメントにまとまっています。[`docs/SPEC-v1.3.md`](docs/SPEC-v1.3.md) / [`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md)

## 主な機能 (v1.3)
### AutoSave と OPFS 履歴
- 入力デバウンス 500ms / アイドル 2s で `project/autosave/current.json` へ保存し、最大 20 世代・50MB をローテーションします。
- 復旧前のデータは `recovery/` へ退避し、フェーズガードで段階的に有効化します。
- Web Locks API (`imgponic:project`) を優先し、非対応環境では advisory lock で保護します。[`docs/SPEC-v1.3.md`](docs/SPEC-v1.3.md) / [`docs/CONFIG_FLAGS.md`](docs/CONFIG_FLAGS.md) / [`docs/LOCKS-API-DESIGN.md`](docs/LOCKS-API-DESIGN.md)

### 精緻マージと Diff ワークフロー
- シーン → セクション → 行ブロックの 3 層で差分を解析し、信頼度しきい値 0.75 を基準に自動マージ / 衝突判定を行います。
- `merge.precision` フラグでタブ露出と UI 状態を制御し、`legacy` / `beta` / `stable` の段階配信を行います。
- `MergeDock` と将来の `DiffMergeView` で、マニュアル編集と AI 提案を統合したレビュー体験を提供します。[`docs/MERGE-DESIGN.md`](docs/MERGE-DESIGN.md) / [`docs/MERGE-DESIGN-IMPL.md`](docs/MERGE-DESIGN-IMPL.md) / [`docs/CONFIG_FLAGS.md`](docs/CONFIG_FLAGS.md)

### Seed / 生成パイプライン
- `Scene.seed` を API オプションへ伝播し、決定性プロファイル（temperature=0, top_p=1.0 等）で再現性を担保します。
- モデルが seed を未対応の場合でも、evidence ログに `seed_applied:false` を残して検証可能性を確保します。
- Export/Import と `runs/<ts>/` 系ディレクトリに生成ログを保存し、Golden テストと連携します。[`docs/SPEC-v1.3.md`](docs/SPEC-v1.3.md) / [`docs/EXPORT-IMPORT.md`](docs/EXPORT-IMPORT.md) / [`docs/FIXTURES-SPEC.md`](docs/FIXTURES-SPEC.md)

### Telemetry / Day8 パイプライン
- `flag_resolution`・`status.autosave`・`merge.trace` などのイベントを Collector → Analyzer → Reporter → Governance の流れで評価します。
- `workflow-cookbook/` 配下のスクリプトが JSONL を集約し、`reports/today.md` などの成果物へ反映します。
- ±5% のレイテンシ許容を監視し、SLO 逸脱時はロールバック手順とテンプレートが発火します。[`Day8/docs/day8/design/03_architecture.md`](Day8/docs/day8/design/03_architecture.md) / [`docs/TELEMETRY-SECURITY-PERFORMANCE-DESIGN.md`](docs/TELEMETRY-SECURITY-PERFORMANCE-DESIGN.md)

## データ保持と互換性
- OPFS の `project/` や `runs/` パスは Imgponic 時代から継続利用し、既存の履歴・証跡を損なわない設計です。
- LocalStorage の旧キーを読み出しつつ新キーへ複製するフェーズを設け、段階的に `conimg.*` 系へ移行します。
- PWA マニフェスト・UI 表記・ドキュメントは Conimgponic 名へ統一しながらも、ロールバック時は旧名検索で追跡できます。[`docs/MIGRATION-NOTES.md`](docs/MIGRATION-NOTES.md) / [`docs/RENAMING-PATCHES.md`](docs/RENAMING-PATCHES.md)

## ディレクトリマップ
| パス | 役割 |
| --- | --- |
| `src/` | React + Zustand で構築した PWA 本体。AutoSave ランナーや MergeDock コンポーネントを含みます。|
| `docs/` | 仕様書・設計書・テスト計画・ブランドガイドなどの一次資料。AutoSave や Diff Merge の詳細設計を参照できます。|
| `Day8/` | Collector/Analyzer/Reporter から成る運用パイプラインと ADR、シードタスク群。ワークフロー自動化を担います。|
| `tests/` | Node.js `node:test` ベースのユニット / ゴールデンテスト。AutoSave・Merge・Collector のカテゴリ別に整理されています。|
| `workflow-cookbook/` | テレメトリ解析やレポート生成を行う補助スクリプト群。Day8 パイプラインと連携します。|
| `templates/` | README・通知テンプレート・設定サンプルなど、運用ドキュメントの雛形。|

## セットアップ
1. 依存関係を取得します。
   ```bash
   pnpm install
   ```
2. 開発サーバーを起動します。
   ```bash
   pnpm dev
   ```
3. 生成系機能を利用する場合は Ollama Base URL (`http://localhost:11434`) を `.env` またはアプリ上部の設定から指定してください。[`templates/README-Conimgponic.md`](templates/README-Conimgponic.md) / [`docs/CONFIG.md`](docs/CONFIG.md)

ビルドおよびプレビューは以下を利用します。
```bash
pnpm build
pnpm preview
```

## テストと品質確認
- 静的解析: `pnpm lint`
- 型検証: `pnpm typecheck`
- テスト実行: `pnpm test`（カテゴリ別は `pnpm test:autosave` / `pnpm test:merge` など）
- ゴールデン比較: `pnpm golden`（CI 向けは `pnpm golden:ci`）

Node.js の `node:test` 実行環境やカバレッジ/JUnit 収集コマンドも `scripts/` 以下に用意されています。[`package.json`](package.json)

## 設定と機能フラグ
- `autosave.enabled`: `false`（既定）/`true`。デバウンス 500ms・アイドル 2s、履歴 20 世代・50MB を制御します。
- `merge.precision`: `legacy`（既定）/`beta`/`stable`。Diff タブの露出やマージアルゴリズムのしきい値を切り替えます。
- 解決優先度は `import.meta.env` → VS Code 設定 (`conimg.*`) → `localStorage` → 既定値の順で評価され、`FlagSnapshot` に `source` と `errors` が保持されます。
- CLI やサーバーサイド（storage 非接続）では `resolveFlags({ storage: null })` で env/既定値のみを採用します。[`docs/CONFIG_FLAGS.md`](docs/CONFIG_FLAGS.md) / [`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md)

## 追加リソース
- リスク・セキュリティ: [`docs/threat-model.md`](docs/threat-model.md), [`docs/SECURITY.md`](docs/SECURITY.md)
- UI/UX: [`docs/AUTOSAVE-INDICATOR-UI.md`](docs/AUTOSAVE-INDICATOR-UI.md), [`docs/design/diff-merge-view-component.md`](docs/design/diff-merge-view-component.md)
- 運用チェックリスト: [`docs/CHECKLIST.md`](docs/CHECKLIST.md), [`docs/TEST-PLAN.md`](docs/TEST-PLAN.md)
- ブランドガイド: [`docs/BRANDING-GUIDE.md`](docs/BRANDING-GUIDE.md)

上記資料とテレメトリ基盤を参照しながら、段階的に AutoSave・Diff Merge をロールアウトし、SLO を維持する運用を想定しています。
