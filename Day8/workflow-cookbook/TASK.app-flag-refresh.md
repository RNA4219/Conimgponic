---
intent_id: INT-001
owner: app-flags
status: active
last_reviewed_at: 2025-02-14
next_review_due: 2025-03-14
---

# Task Ticket – App Flag Snapshot Live Refresh

## メタデータ

```yaml
task_id: 20250214-FL
repo: https://github.com/conimg/Conimgponic
base_branch: main
work_branch: feat/app-flag-refresh
priority: P1
langs: [typescript]
```

## Objective

`docs/IMPLEMENTATION-PLAN.md` §0.2 と `docs/design/app-merge-dock-integration.md` §3 の要件に沿って、`App.tsx` と MergeDock のフラグ購読を単一の `FlagSnapshot` ソースへ揃え、ライブ更新で AutoSave ブリッジと Diff タブ制御を再評価できるようにする。

## Scope

- In: src/App.tsx, tests/app/app.flags-live-update.test.tsx
- Out: storage/persistence 実装、MergeDock UI 文言

## Requirements

- Behavior:
  - `autosave.enabled` 切替で AutoSave ランナーの起動・停止が即時反映され、ブリッジ解除→再接続が行われる。
  - `merge.precision` 切替で MergeDock の precision/threshold が再計算される。
- I/O Contract:
  - Input: FlagSnapshot（env/localStorage/workspace 由来）
  - Output: AutoSave runner state, MergeDock integration snapshot
- Constraints:
  - 既存 API 互換 / 追加依存なし
  - `pnpm lint && pnpm typecheck && pnpm test --filter app` を無警告で通過
- Acceptance Criteria:
  - `tests/app/app.flags-live-update.test.tsx` に RED→GREEN を示す新規ケースが追加され、固定時計下でもフラグ再評価が行われる。
  - `App.tsx` で `useFlagSnapshot`（もしくは同等購読）が導入され、Implementation Plan の Phase-b0 要件を満たす。

## Affected Paths

- src/App.tsx
- tests/app/app.flags-live-update.test.tsx

## Local Commands

```bash
pnpm lint && pnpm typecheck && pnpm test --filter app
```

## Deliverables

- PR: タイトル/要約/影響/ロールバックに加え `Intent: INT-001` と `## EVALUATION` セクションを明記
- Artifacts: 変更パッチ、テストログ、必要に応じたワークログメモ
