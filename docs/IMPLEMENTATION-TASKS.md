# IMPLEMENTATION TASKS

本体実装フェーズのタスク整理ファイル。引用元ファイルを前提に、実装タスクを粒度化します。本文で参照するファイル:
- docs/IMPLEMENTATION-PLAN.md
- docs/CONFIG_FLAGS.md
- src/config/index.ts
- docs/AUTOSAVE-DESIGN-IMPL.md

## 概要
- 本体実装タスクを、公開 API 保護と最小差分の方針に沿って計画・実行する。
- 実装は「テストを先に書く」方針で進め、lint/型チェック・テストのグリーンを最優先にします。

## 入力/出力
- 入力: IMPLEMENTATION-PLAN.md / CONFIG_FLAGS.md / index.ts の現状仕様
- 出力: 実装タスクファイル群・テスト雛形・実装差分

## 公開APIの影響範囲
- Public API の破壊は禁止。不可避の場合のみ段階移行フラグを使用する。index.ts の公開範囲に影響を及ぼす変更は、先にミニマムなスコープで検証する。
- CLI/JSON 出力の互換性を維持。

## テスト方針（先行テストを含む）
- 先にテストを作成（テスト駆動開発）。pytest / node:test の既存方針を踏襲。新規のテストは tests 配下に雛形を追加。
  - TypeScript テスト雛形: `tests/plan003_skeleton.ts`
  - Python テスト雛形: `tests/plan003_skeleton.py`
- TypeScript/ESM の型検査を tsc / bun/ts-node 等の現状方針に従い実施。

## 実施手順
1) docs/IMPLEMENTATION-PLAN.md および docs/CONFIG_FLAGS.md の該当箇所を参照して、依存関係と前提条件を整理する。
2) 本体実装に向けた入口を、src/config/index.ts の resolveFlags の公開範囲と Collector 連携イベント構造の理解としてブレークダウンする。
3) docs/AUTOSAVE-DESIGN-IMPL.md のファサード責務と例外設計を参照して、AutoSave の設計方針を実装計画に落とし込む。
4) IMPLEMENTATION-TASKS.md に具体的な実装タスクを落とし込み、進捗を todo list に同期させる。
5) 先行テストの雛形を tests/ に追加。既存 test_verification.js の方針を踏襲する。
6) 最小差分でのコード実装を進め、lint/型チェック/テストを連続で実行してグリーンを狙う。

## 進捗管理/更新ルール
- todo_write でのタスク更新を優先。完了したタスクは即時 completed にする。
- 実装中は in_progress を常に1タスクに限定。
- 新規タスクが発生した場合は即座に追加・更新する。

## リスクと回避策
- 実装仕様の不確定要素は、docs/PLAN 参照と index.ts の実装箇所を優先して決定。
- 互換性維持を優先し、破壊的変更は回避、やむを得ずの場合は段階移行を適用。

## 引用元
- docs/IMPLEMENTATION-PLAN.md
- docs/CONFIG_FLAGS.md
- src/config/index.ts
- docs/AUTOSAVE-DESIGN-IMPL.md
