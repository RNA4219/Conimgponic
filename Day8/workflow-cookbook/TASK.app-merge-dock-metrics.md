---
intent_id: INT-001
owner: merge-integrator
status: draft
last_reviewed_at: 2025-02-20
next_review_due: 2025-03-20
---

# Task Ticket – MergeDock Collector Metrics Wiring

## メタデータ

```yaml
task_id: 20250220-MD
repo: https://github.com/conimg/Conimgponic
base_branch: main
work_branch: feat/merge-dock-collector-metrics
priority: P1
langs: [typescript]
```

## Objective

Collector 由来の自動採用率 (`autoAppliedRate`) を MergeDock へ連携し、Diff タブ露出を `docs/IMPLEMENTATION-PLAN.md` のフェーズガード要件どおりに制御する。`docs/design/app-merge-dock-integration.md` のブリッジ仕様を引用して、App 側の FlagSnapshot と MergeDock プロップスを同期させる。

## Scope

- In: src/App.tsx, src/lib/merge/phasePlan.ts, tests/app/**, tests/lib/merge/**
- Out: autosave runner本体、Collector/Analyzer集約ロジック

## Requirements

- Behavior:
  - Collector 指標で `autoAppliedRate < threshold.autoTarget` を検出した場合、Diff タブを `exposure='opt-in'` / `enabled=false` に降格させる。【docs/IMPLEMENTATION-PLAN.md†L204-L212】
  - App は `docs/design/app-merge-dock-integration.md` §3 に沿って FlagSnapshot と Collector 指標を統合し、`<MergeDock autoAppliedRate={...}>` を提供する。【docs/design/app-merge-dock-integration.md†L33-L71】
- I/O Contract:
  - Input: Collector 保存先 (`localStorage` / Workspace 設定) に格納された自動採用率
  - Output: MergeDock へ渡される `autoAppliedRate`、Diff タブ露出ステータス
- Constraints:
  - 既存 API を破壊しない / 依存追加なし
  - `pnpm lint && pnpm typecheck && pnpm test --filter merge` をグリーン
- Acceptance Criteria:
  - `autoAppliedRate < threshold.autoTarget` の RED テストが Diff タブ降格を検証し、GREEN 化される。
  - App レベルのテストで Collector 指標が `<MergeDock>` へ渡されることを確認する。

## Affected Paths

- src/App.tsx
- src/lib/merge/phasePlan.ts
- tests/app/**
- tests/lib/merge/**

## Local Commands

```bash
pnpm lint && pnpm typecheck && pnpm test --filter merge
```

## Deliverables

- PR 本文に `Intent: INT-001` と `## EVALUATION` を明記
- 変更パッチ、テストログ、必要なら設計メモ
