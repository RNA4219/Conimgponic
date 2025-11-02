---
intent_id: INT-073
owner: merge-phase-owner
status: active
last_reviewed_at: 2025-02-20
next_review_due: 2025-03-20
---

# Task Seed – MergeDock Phase Stats Integration

## メタデータ

```yaml
task_id: 20250220-PS
repo: https://github.com/conimg/merge-dock
base_branch: main
work_branch: feat/merge-dock-phase-stats
priority: P1
langs: [typescript]
```

## Objective

MergeDock の Phase ガードを強化し、`docs/IMPLEMENTATION-PLAN.md` と `docs/design/app-merge-dock-integration.md` が定義するレビュー/コンフリクト件数に基づき Diff タブ活性化を制御する。

## Scope

- In: `src/App.tsx`, `src/components/MergeDock.tsx`, `src/config/**`, `tests/app/**`
- Out: AutoSave ランナー実装、Collector/Analyzer パイプライン

## Requirements

- Behavior:
  - `resolveMergeDockIntegration` が `phaseStats` を解決し、`MergeDock` へ注入する。
  - `docs/design/app-merge-dock-integration.md` §2 に従い、`beta/stable` 精度で `phaseStats` 未達の間は `data-merge-diff-enabled=false` を維持する。
- I/O Contract:
  - Input: `ResolveOptions.workspace`（`merge.phaseStats.reviewBandCount` / `merge.phaseStats.conflictBandCount`）
  - Output: `<MergeDock data-merge-diff-enabled>`、`phaseStats` に基づく Diff 操作ガード
- Constraints:
  - `docs/IMPLEMENTATION-PLAN.md` のフェーズゲートと後方互換を保持
  - 依存追加なし、Lint/Type/Test 無エラー
- Acceptance Criteria:
  - `tests/app` に Phase Stats 経由の統合テストが追加され、RED→GREEN を確認
  - Diff タブ活性化ログが `data-merge-diff-enabled` 属性に反映される

## Affected Paths

- `src/App.tsx`
- `src/components/MergeDock.tsx`
- `tests/app/**`

## Local Commands（存在するものだけ実行）

```bash
pnpm lint && pnpm typecheck && pnpm test --filter app
```

## Plan

1) `docs/IMPLEMENTATION-PLAN.md` と `docs/design/app-merge-dock-integration.md` の Phase 指標要件を確認
2) `ResolveOptions.workspace` からレビュー/コンフリクト件数を取得する導線を設計
3) `resolveMergeDockIntegration` → `<MergeDock phaseStats={...}>` のデータ伝搬を実装
4) `tests/app` に Phase Stats ガードの統合テストを追加し RED→GREEN
5) pnpm lint/typecheck/test を通過

## Tests

### Outline

- Integration:
  - `workspace` に Phase Stats が存在しない場合 Diff タブが disabled を維持
  - `workspace` にレビュー件数が設定されると Diff タブが enabled へ遷移

## Commands

### Run gates

- pnpm lint && pnpm typecheck && pnpm test --filter app

## Notes

### Rationale

- Phase B 進行の安全性を `docs/IMPLEMENTATION-PLAN.md` §0.4 の指標基準で担保するため。

### Risks

- Workspace 設定の不整合で Phase ガードが誤作動するリスク。入力検証を強化する。

### Follow-ups

- Phase Stats を Collector テレメトリへ送出する追跡タスクを別途検討。
