# 本体実装タスク

参照ファイル
- docs/IMPLEMENTATION-PLAN.md: AutoSave と精緻マージを段階導入する全体計画とフラグ運用、UI 展開を体系化。プラン立案時の前提と段階チェックリストがまとまっています。
- docs/CONFIG_FLAGS.md: env／VSCode 設定／localStorage の優先順位や配布手順を整理。Feature Flag 連携をタスク化する際の入力ソースとガード設計の基準になります。
- src/config/index.ts: resolveFlags の公開範囲、Collector 連携イベント構造、merge.precision しきい値通知を含むため、設定連携実装時の入口として参照が必須です。
- docs/AUTOSAVE-DESIGN-IMPL.md: AutoSave ファサード責務、ポリシー固定値、例外設計（retryable 区分）を詳細化。ランタイム制御・GC・ロック協調を着手する際の仕様書として利用してください。

タスクの目的
- リポジトリの既存ルール（型: mypy/strict, Lint: Ruff, テスト: pytest / node:test, ESM/TS 方針, 例外ポリシー）を自動検出・遵守。変更は最小差分で Public API 破壊を避ける。
- 実装はテスト駆動開発を基本とし、テストを先行して実装する。
- Import の順序とレイヤー境界を守り、副作用を最小化する。

実装方針の要点
- 型安全と最小変更: 新規/変更シグネチャは型を必須とする。
- 例外設計: errors 階層に合わせ、retryable/不可を区別する。
- 後方互換: CLI/JSON 出力の互換性を優先。
- 参照カ所の最小化: 新規ファイルは分割、過度な編集を避ける。
- ドキュメント: 公開 API/CLI の変更時のみ差分に doc を同梱。

新規タスクリスト（PLAN 001-006 とは別の実装用サブタスク）
- plan-007: docs/IMPLEMENTATION-PLAN.md/CONFIG_FLAGS.md を参照して、実装スコープを確定し、公開 API の影響を最小化する設計を確認する。引用元: index.ts のエントリポイントと AUTOSAVE-DESIGN-IMPL.md の設計を参照。
- plan-008: config_flags のユニットテスト雛形を作成する。テスト優先でテストケースを洗い出す。
- plan-009: resolveFlags の最小実装を追加。公開 API に影響を与えない範囲で段階的に導入。
- plan-010: AutoSave フェサードの入口 (index.ts) を追加し、控えめな実装を提供する。
- plan-011: AUTOSAVE-DESIGN-IMPL.md の仕様をコードに落とす雛形を作成。
- plan-012: 統合テストの準備。モック/スタブを用意して段階的な検証を可能にする。
- plan-013: Lint/型チェックとテスト実行の自動化サポートを整える。
- plan-014: 変更差分の最終チェックと後方互換性の検証、必要であれば変更の文脈をドキュメント化。

進捗管理と検証方針
- 実装は小さな差分で段階的に適用。公開 API 破壊を避け、後方互換性のリスクを低減。
- すべての変更はテストがグリーンになることを最優先に確認。
- テストは config_flags と AutoSave の結合シナリオを含む。ドキュメントの参照と合わせて進める。

テスト実行計画の概要
- 事前検証: ruff/型チェックを実施。エラーがあれば修正。
- 単体テスト: plan-008, plan-011 の雛形テストを追加。
- 統合テスト: plan-012 の準備を進め、実装と同時に検証。
- 実行コマンド例: npm run lint, tsc, pytest, node:test 等 project の標準に沿って実施。

サマリ
- docs/IMPLEMENTATION-PLAN.md と docs/CONFIG_FLAGS.md を参照して、本文に index.ts からの公開エントリポイントと AUTOSAVE-DESIGN-IMPL.md の要件を引用します。新規タスクとして plan-007 〜 plan-014 を追加し、テスト駆動開発を先行させつつ段階実装を進めます。実装後は lint/型チェック・テストを実行し、後方互換性の検証を行います。