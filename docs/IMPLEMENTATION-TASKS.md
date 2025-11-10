# 本体実装タスク一覧

参照・引用ファイル
- IMPLEMENTATION PLAN: docs/IMPLEMENTATION-PLAN.md
- 設定・配布方針: docs/CONFIG_FLAGS.md
- MERGE 関連設計: docs/MERGE-DESIGN-IMPL.md
- 現行実装: src/components/MergeDock.tsx

概要
本体実装フェーズのタスクを、上記参照ファイルを引用して整理します。変更は最小差分・公開API破壊禁止を原則とし、テスト駆動開発を前提とします。

タスク一覧
1) 設計方針の整理と差分方針の確定
   - 引用元: docs/IMPLEMENTATION-PLAN.md, docs/CONFIG_FLAGS.md
   - 目的: AutoSave と精緻マージの段階導入フローの整備、有効なフラグ運用の定義
   - 要約:
     - `docs/IMPLEMENTATION-PLAN.md` から、リポジトリの既存ルール厳守、最小差分での変更、テスト駆動開発の優先、AutoSave と精緻マージの段階導入、フラグ運用、UI 展開の体系化を設計方針とする。
     - `docs/CONFIG_FLAGS.md` から、機能フラグの優先順位（ビルド時環境変数 > VSCode 設定 > localStorage > 既定値）、`autosave.enabled` と `merge.precision` のアクティベーションマトリクス、MergeDock Diff タブの段階露出設計、フェーズ別既定値とチーム配布、Telemetry / Collector 連携設計を設計方針とする。
     - `docs/MERGE-DESIGN-IMPL.md` から、`merge3` API の仕様、`MergeHunk` の構造、`MergeProfile` の制御、AutoSave との協調、`queueMergeCommand` のフロー、Telemetry 検証ログを設計方針とする。
     - `src/components/MergeDock.tsx` の現状実装を把握し、AutoSave ハートビート、precision 切替処理、Diff Merge 機能の拡張やフラグ適用を行う際の具体的な実装箇所を特定する。


2) テスト戦略の設計と雛形作成
   - 引用元: MERGE-DESIGN-IMPL.md の UI/ロック協調・AutoSave連携要件を踏まえる
   - 目的: MergeDock の AutoSave ハートビート、precision 切替、フラグ連携を検証するテスト案の作成

3) 実装設計
   - 引用元: src/components/MergeDock.tsx
   - 目的: 差分実装方針を策定（AutoSave heartbeat、precision切替、フラグ適用の実装方針）
   - 差分方針:
     - **AutoSave heartbeat**: 既存の `useEffect` フックで `startMergeDockAutoSaveHeartbeat` が呼び出され、`autoSave` ステートが更新されることを確認。`autoSaveEnabled` プロパティが `phasePlan` の計算に正しく反映されていることを確認する（現状維持）。
     - **precision 切替**: `useMergeThreshold` および `resolveMergeDockPhasePlan` を通じた `precision` の変更が `phasePlan` に反映され、タブとプリファレンスの遷移が `useEffect` フックで処理されていることを確認（現状維持）。「統合ルール」の `diff-merge` オプションの `disabled` ロジックも現状維持。
     - **フラグ適用**: `flags` プロパティと `autoSaveEnabled` プロパティが `phasePlan` の計算に正しく渡され、`DiffMergeView` の表示とインタラクションの有効/無効を制御していることを確認（現状維持）。
     - **UI変更**: `plan.tabs.map` の中で、`entry.id === 'diff'` かつ `precision === 'beta'` の場合にタブのラベルに `(Beta)` を追加するロジックを実装する。


4) テスト実装
   - 引用元: 上記設計
   - 目的: ユニット/統合テストの雛形を実装、テストコードを追加

5) 品質保証
   - 引用元: リポジトリの静的検査基準（ruff/mypy 等）と既存のテスト流儀
   - 目的: static checks とテスト実行手順を整備、CIと整合

6) ドキュメント反映
   - 引用元: docs/CONFIG_FLAGS.md, docs/MERGE-DESIGN-IMPL.md の更新案
   - 目的: 実装変更を反映したガイドライン更新

7) 変更差分のコミット計画
   - 目的: 小さな差分での複数コミットを想定し、適切なコミットメッセージを準備

進行ロジック
- 最初に絶対パスを頂いた後、上記ドラフトを実ファイルとして作成・保存します。
- 実装は PLAN に基づき、最小差分・非破壊を徹底します。
