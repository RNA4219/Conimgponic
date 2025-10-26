# Task Seed

## メタデータ

```yaml
task_id: 20250120-01
repo: local://Conimgponic
base_branch: work
work_branch: feat/diff-merge-view-jsx-blocks
priority: P2
langs: [typescript]
status: draft
last_reviewed_at: 2025-01-20
next_review_due: 2025-02-03
```

## Objective

`src/components/DiffMergeView.tsx` のナビゲーション/ハンク一覧/操作パネル/編集モーダルを均一粒度の JSX ブロックへ再編し、ハンドラと状態同期ロジックを既存 `useMemo`・`useEffect`・`useReducer` のまま保つ。

## Scope

- In: `src/components/DiffMergeView.tsx`, `tests/components/DiffMergeView.test.tsx`
- Out: `MergeDock` 側のタブ構成、`diffMergeState.ts` の状態遷移実装、API コントラクト

## Requirements

- Behavior:
  - 再構成後もタブ初期選択・バッジ・ハンク操作・編集モーダル開閉の挙動が従来通りであること。
  - `queueMergeCommand` へ渡すハンク ID 群が既知ハンクに限定され、選択なしの場合は全件が対象になること。
- I/O Contract:
  - Input: `precision`, `hunks`, `queueMergeCommand`
  - Output: JSX レンダリング（`data-testid` 属性は現行値を維持）
- Constraints:
  - `useMemo`・`useEffect`・`useReducer` 呼び出し位置と依存関係を保持する。
  - 差分は最小化し、型注釈を追加する際は既存シグネチャを崩さない。
- Acceptance Criteria:
  - 新設ブロックに対するテストが追加され、`pnpm test -- --filter merge` がグリーン。
  - `pnpm lint` が通過し、JSX 変換による静的解析エラーが発生しない。

## Affected Paths

- src/components/DiffMergeView.tsx
- tests/components/DiffMergeView.test.tsx

## Local Commands（存在するものだけ実行）

```bash
pnpm test -- --filter merge
pnpm lint
```

## Deliverables

- PR: DiffMergeView JSX ブロック再構成の概要、リスク、テスト結果、Intent: INT-001
- Artifacts: `DiffMergeView` コンポーネント差分、テスト更新ログ

---

## Plan

### Steps

1) 既存テストを精査し、ナビゲーション/ハンク一覧/操作パネル/編集モーダルの DOM 構造を固定化する追加アサーションを作成する。
2) `DiffMergeView.tsx` に補助コンポーネント（Navigation/HunkList/OperationPane/EditModal）を導入し、既存の `useMemo` 等を保ちながら JSX ブロックを均一化する。
3) 差分の静的解析とマージテスト（`pnpm lint`, `pnpm test -- --filter merge`）を実施し、グリーン結果を Task Seed の Tests/Commands へ追記する。
4) 実装結果をレビュー用にまとめ、後続の UI ポリッシュや Phase 切替検討は別タスクへ引き継ぐ。

## Patch

_未着手_

## Tests

### Outline

- Component Snapshot: 各セクションの `data-testid` がアクティブタブに応じて描画/非描画となる。
- Interaction: `toggle-select`・`edit` ボタン操作で状態遷移が維持される。
- 2025-01-20: `pnpm test -- --filter merge`（`merge-engine` 既存テストの plan 生成待ちで失敗）

## Commands

### Run gates

- `pnpm test -- --filter merge`
- `pnpm lint`
- 2025-01-20: `pnpm lint`（`@eslint/js` 未解決のため失敗）

## Notes

### Rationale

- DOM ブロックの粒度を合わせることで Phase B/C での UI 拡張に備える。

### Risks

- コンポーネント化による props 伝搬漏れでハンク状態が同期しないリスクがあるため、テストで最小ケースをカバーする。

### Follow-ups

- OperationPane の実 UI 実装と telemetry フックの拡張（別タスク）。
