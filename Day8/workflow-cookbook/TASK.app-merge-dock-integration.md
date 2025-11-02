---
intent_id: INT-201
owner: day8-integrations
status: active
last_reviewed_at: 2025-02-14
next_review_due: 2025-03-14
---

# Task Seed - Merge Dock Integration Phase Stats

## メタデータ

```yaml
task_id: 20250214-merge-dock-integration
repo: https://github.com/day8/Conimgponic
base_branch: main
work_branch: feat/app-merge-dock-integration
priority: P1
langs: [typescript]
```

## Objective

`resolveMergeDockIntegration` と `<MergeDock>` の間で Phase 指標 (`reviewBandCount` / `conflictBandCount`) を確実に伝搬し、`docs/IMPLEMENTATION-PLAN.md` §1.4 の Diff ガード解除条件を app-merge-dock-integration で担保する。

## Scope

- In: src/App.tsx, src/components/MergeDock.tsx, src/lib/merge/**, tests/app/**, tests/merge/**
- Out: autosave runner 実装、telemetry collector、export/**

## Requirements

- Behavior:
  - `ResolveOptions.workspace` が `merge.phaseStats.*` を提供すると Diff ガードが解除され、`data-merge-diff-enabled="true"` が SSR で確認できる。
  - ワークスペース指標が欠落する場合は現行フェーズガード（Diff 非活性）を維持する。
- I/O Contract:
  - Input: `ResolveOptions` / `WorkspaceConfiguration`
  - Output: `MergeDockPhaseStats` を含む `MergeDockIntegrationSnapshot`
- Constraints:
  - 既存API破壊なし / 不要な依存追加なし
  - Lint/Type/Test はゼロエラー
- Acceptance Criteria:
  - RED→GREEN の TDD で Diff ガード解除が再現される。
  - `pnpm lint && pnpm typecheck && pnpm test --filter merge` が成功する。

## Affected Paths

- src/App.tsx
- src/components/MergeDock.tsx
- tests/app/app.merge-phase-stats.integration.test.tsx

## Local Commands（存在するものだけ実行）

```bash
pnpm lint && pnpm typecheck && pnpm test --filter merge
```

## Deliverables

- PR: タイトル/要約/影響/ロールバックに加え、本文へ `Intent: INT-201` と `## EVALUATION` アンカーを明記
- Artifacts: 変更パッチ、テスト、必要なら README/Runbook 更新

---

## Plan

### Steps

1) 現状把握 — `src/App.tsx` と `src/components/MergeDock.tsx` の Phase 伝搬経路を精査し、`docs/IMPLEMENTATION-PLAN.md` に準拠しているか確認。
2) RED テスト — `ResolveOptions.workspace` 由来の `phaseStats` で Diff ガード解除を検証する SSR テストを追加。
3) 実装 — `resolveMergeDockIntegration` から `<MergeDock phaseStats={...}>` へ指標を渡し、型と props を同期。
4) リグレッション確認 — 既存 Merge Dock メトリクス/閾値評価への影響をチェックし、必要なら型狭義化。
5) pnpm lint / pnpm typecheck / pnpm test --filter merge を実行し GREEN を確認。

## Patch

***Provide a unified diff. Include full paths. New files must be complete.***

## Tests

### Outline

- Unit:
  - `resolveMergeDockIntegration` が `phaseStats` を標準化するケース
  - `readWorkspaceSetting` が `merge.phaseStats.*` を引き当てるケース
- Integration:
  - `<App resolveOptions={{ workspace }}>` SSR で Diff ガード解除を確認するシナリオ

## Commands

### Run gates

- pnpm lint
- pnpm typecheck
- pnpm test --filter merge

## Notes

### Rationale

- Implementation Plan の Phase 指標に沿って UI 側ガードを段階的に解除し、Collector / Analyzer の条件と整合させる。

### Risks

- ワークスペース設定が未提供の場合に Diff が誤って有効化されるリスク — パース失敗時は null を返すことで回避。

### Follow-ups

- Telemetry 側で `phaseStats` 由来イベントを追跡する計測ガード追加を別タスクで検討。
