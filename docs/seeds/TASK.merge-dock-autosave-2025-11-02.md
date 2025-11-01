# Task Seed

## メタデータ

```yaml
task_id: 20251102-01
repo: local://Conimgponic
base_branch: work
work_branch: fix/merge-dock-autosave-dedupe
priority: P2
langs: [typescript]
status: draft
last_reviewed_at: 2025-11-02
next_review_due: 2025-11-16
```

## Objective

Day8/workflow-cookbook/GUARDRAILS.md の「変更は最小差分で行い、Public API を破壊しない」を踏まえ、Day8/docs/day8/guides/07_contributing.md が求めるタスク分離の下で `src/components/MergeDock.tsx` の AutoSave 型／ハートビート処理を `src/components/merge-dock/domain.ts` のエクスポートに統一する。

## Scope

- In: `src/components/MergeDock.tsx`, `src/components/merge-dock/domain.ts`, `src/components/merge-dock/model.ts`, `tests/components/merge.diff.test.tsx`
- Out: DiffBackup のドメイン実装、UI レイアウト・コピーの変更

## Requirements

- Behavior:
  - MergeDock 内で再定義されていた `MergeDockAutoSaveState`・`MergeDockWindow`・`startMergeDockAutoSaveHeartbeat` を削除し、`domain.ts` から import した実装だけを使用する。
  - `DiffBackupAutoSaveState` を未 import 参照しないよう `model.ts` からの型再利用を経由する。
- Constraints:
  - Guardrails が求める型安全性を満たしつつ、既存 API の挙動と互換性を維持する。
  - Contributing ガイドの粒度規約に合わせ、関連差分は 3 ファイル以内に収める。
- Acceptance Criteria:
  - ハートビートと警告計算が単一実装で動作し、`pnpm test -- tests/components/merge.diff.test.tsx` を RED→GREEN で通過する検証ログを Tests セクションに残す。

## Plan

1. Guardrails/Contributing の要件に沿って `domain.ts` の型エクスポート状況を棚卸しする。
2. `MergeDock.tsx` から自前宣言を除去し、`domain.ts` 経由の import に統一する。
3. RED→GREEN 手順で `pnpm test -- tests/components/merge.diff.test.tsx` を実行し、ハートビートと警告計算が単一経路で呼ばれることを確認する。

## Tests

### RED

- 2025-11-02: `pnpm test -- tests/components/merge.diff.test.tsx` → 失敗ログ（AutoSave 型重複による SyntaxError）

### GREEN

- 2025-11-02: `pnpm test -- tests/components/merge.diff.test.tsx` → 成功ログ（ハートビート／警告が単一経路で稼働）

## Notes

- Guardrails/Contributing 双方の要件を満たした上で、AutoSave ハートビートの重複を排除することにより、タブ遷移時の警告表示が安定した。
