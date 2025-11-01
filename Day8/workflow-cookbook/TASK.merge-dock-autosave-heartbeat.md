---
intent_id: INT-042
owner: merge-integrator
status: active
last_reviewed_at: 2025-02-15
next_review_due: 2025-03-15
---

# Task Seed – MergeDock AutoSave Heartbeat Gate

## メタデータ

```yaml
task_id: 20250215-HB
repo: https://github.com/conimg/merge-dock
base_branch: main
work_branch: feat/merge-dock-autosave-heartbeat
priority: P1
langs: [typescript]
```

## Objective

MergeDock の AutoSave ハートビートを整備し、`docs/IMPLEMENTATION-PLAN.md` §0.4 の 5 分閾値と
`docs/design/app-merge-dock-integration.md` §3 のブリッジ仕様に沿ってバックアップ CTA を自動更新できるようにする。

## Scope

- In: `src/components/MergeDock.tsx`, `src/hooks/useAutoSaveIntegration.ts`, `tests/merge/merge-dock-tabs.test.ts`
- Out: AutoSave ランナー本体、Collector/Analyzer 系のテレメトリ処理

## Requirements

- Behavior:
  - AutoSave ブリッジ経由で `window.__mergeDockAutoSaveSnapshot.lastSuccessAt` が更新された場合、5 分経過で CTA が表示に遷移する。
  - `docs/design/app-merge-dock-integration.md` が定義する `flushNow` ハンドラ公開を保持しつつ、`docs/IMPLEMENTATION-PLAN.md` のフェーズゲートを順守する。
- I/O Contract:
  - Input: `FlagSnapshot.merge.precision`, `MergeDockPhaseStats?`, `window.__mergeDockAutoSaveSnapshot`
  - Output: `data-testid="merge-dock-backup-cta"`, `data-merge-diff-visible`, `data-merge-diff-enabled`
- Constraints:
  - 既存 API を破壊しない / 依存追加禁止
  - `pnpm lint && pnpm typecheck && pnpm test --filter merge` を完全成功させる
- Acceptance Criteria:
  - タイマー駆動の CTA トグル挙動が `tests/merge/merge-dock-tabs.test.ts` で RED→GREEN となり証跡化される。
  - AutoSave ブリッジ解除時にハートビートが確実に停止する。

## Affected Paths

- `src/components/MergeDock.tsx`
- `src/hooks/useAutoSaveIntegration.ts`
- `tests/merge/merge-dock-tabs.test.ts`

## Local Commands（存在するものだけ実行）

```bash
pnpm lint && pnpm typecheck && pnpm test --filter merge
```

## Tests

### Outline

- Unit:
  - AutoSave ブリッジから取得した `lastSuccessAt` と仮想タイマーで CTA 露出が変化するケース
  - `flushNow` によるリフレッシュ後も 5 分未満なら CTA が非表示のままであるケース
- Integration:
  - MergeDock DOM における Diff タブと CTA 表示の組み合わせをストアスナップショット経由で検証

## Commands

### Run gates

- pnpm lint && pnpm typecheck && pnpm test --filter merge

## Notes

### Rationale

- `docs/IMPLEMENTATION-PLAN.md` のフェーズ B-0 要件に従い、AutoSave の鮮度監視を UI 側で可視化してローリングアウトを安全化する。

### Risks

- ハートビートの周期が短すぎると `docs/design/app-merge-dock-integration.md` のロック制御に負荷を与える。

### Follow-ups

- `docs/design/app-merge-dock-integration.md` Appendix のテレメトリ導線を `tests/telemetry` 系へ追加検証する。
