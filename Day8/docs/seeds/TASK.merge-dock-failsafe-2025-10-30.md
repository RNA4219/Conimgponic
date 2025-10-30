---
task_id: 20251030-01
repo: Conimgponic
base_branch: main
work_branch: work/merge-dock-localstorage-failsafe
priority: P2
langs:
  - TypeScript
  - Markdown
status: active
last_reviewed_at: 2025-10-30
next_review_due: 2025-11-06
---

## Objective
MergeDock の localStorage 参照失敗時に既定タブと既定しきい値へフォールバックするフェイルセーフを追加し、警告ログ方針を定義する。

## Scope
### In
- src/components/MergeDock.tsx
- tests/components/MergeDock.localStorage-read.spec.tsx
- Day8/docs/seeds/TASK.merge-dock-failsafe-2025-10-30.md
### Out
- persistMergeDockActiveTab の挙動変更（書き込み時）
- DiffMergeView とのタブ同期処理の仕様変更

## Requirements
### Behavior
- localStorage.getItem が例外を投げた場合でも MergeDock は既定タブと既定しきい値を使用してレンダリングを続行する。
- フェイルセーフ発動時は `console.warn` で storage key と例外情報を記録する。
### Constraints
- Day8/workflow-cookbook/GUARDRAILS.md の TDD・型安全・最小差分指針を遵守する。
### Acceptance
- `pnpm test --filter components -- --test-name-pattern MergeDock.localStorage-read` が成功する。

## Affected Paths
- src/components/MergeDock.tsx
- tests/components/MergeDock.localStorage-read.spec.tsx
- Day8/docs/seeds/TASK.merge-dock-failsafe-2025-10-30.md

## Local Commands
- pnpm test --filter components -- --test-name-pattern MergeDock.localStorage-read

## Deliverables
- localStorage 読み込み失敗時のフェイルセーフ実装と単体テスト
- storage 例外を `console.warn` へ記録するログ方針の文書化

## Plan
1. `tests/components/MergeDock.localStorage-read.spec.tsx` を新設し、storage.getItem 例外で MergeDock が既定タブ・既定しきい値へ戻る赤テストを追加する。
2. `src/components/MergeDock.tsx` の `resolveMergeThresholdSnapshot` と MergeDock 本体で localStorage 読み込みを `try/catch` 化し、警告ログを残して既存フォールバックを使用する。
3. Guardrails のテストコマンドを実行し、成功ログを Notes/Tests に記録する。

## Patch
- [ ] localStorage 読み込みのフェイルセーフ実装を追加

## Tests
- [ ] pnpm test --filter components -- --test-name-pattern MergeDock.localStorage-read

## Commands
- [ ] pnpm test --filter components -- --test-name-pattern MergeDock.localStorage-read

## Notes
- console.warn のメッセージは `MergeDock: failed to read ...` 形式で統一し、storage key と例外インスタンスを添える。
