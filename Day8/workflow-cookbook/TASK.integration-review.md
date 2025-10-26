---
intent_id: INT-042
owner: merge-integrator
status: active
last_reviewed_at: 2025-02-15
next_review_due: 2025-03-15
---

# Task Seed – Integration & Review Gate

## メタデータ

```yaml
task_id: 20250215-IR
repo: https://github.com/conimg/merge-dock
base_branch: main
work_branch: feat/merge-diff-integration
priority: P1
langs: [typescript]
```

## Objective

MergeDock の Diff タブを Integration & Review フェーズ向けに開放し、`beta` / `stable` precision での UI 露出とガード挙動を検証可能にする。

## Scope

- In: `src/components/MergeDock.tsx`, `tests/components/**`, `tests/merge/**`, `docs/design/**`
- Out: AutoSave storage 実装、バックエンド API、Collector パイプライン

## Requirements

- Behavior:
  - precision=`beta` / `stable` で `phaseStats` が無い場合でも Diff タブが DOM に描画される。
  - ガード未達成時は `data-merge-diff-enabled=false` として CTA/操作が無効化され、レビュー帯域が検出されると `true` に遷移する。
- I/O Contract:
  - Input: `FlagSnapshot.merge.precision`, `MergeDockPhaseStats?`
  - Output: `data-merge-diff-visible`, `data-merge-diff-enabled` 属性、およびバックアップ CTA の表示制御
- Constraints:
  - 既存 API の互換性維持 / 新規依存の追加禁止
  - `pnpm lint && pnpm typecheck` と対象テストの通過
- Acceptance Criteria:
  - `tests/components/merge.diff.test.tsx` と `tests/merge/merge-dock-tabs.test.ts` にガード差異のテストが追加されグリーン
  - Diff タブのバックアップ CTA が `data-merge-diff-enabled=true` の条件でのみ描画される

## Affected Paths

- `src/components/MergeDock.tsx`
- `tests/components/merge.diff.test.tsx`
- `tests/merge/merge-dock-tabs.test.ts`
- `docs/design/app-merge-dock-integration.md`
- `docs/IMPLEMENTATION-PLAN.md`

## Local Commands（存在するものだけ実行）

```bash
pnpm lint && pnpm typecheck
pnpm test tests/components/merge.diff.test.tsx
pnpm test tests/merge/merge-dock-tabs.test.ts
```

## Deliverables

- PR: タイトル、要約、影響範囲、ロールバック手順に加え `Intent: INT-042` と `## EVALUATION` アンカーを明記
- Artifacts: 変更パッチ、テストログ、Diff タブ露出に関するスクリーンショット (必要に応じて)

---

## Plan

### Steps

1) `MergeDock.tsx` のタブプラン/ガード判定を整理し、`data-merge-diff-visible` と `data-merge-diff-enabled` を分離する。
2) テスト (`merge.diff` / `merge-dock-tabs`) を先に更新し、`beta` / `stable` precision の露出とガード差異を RED にする。
3) コンポーネント実装を更新し、ガード未達時でも Diff タブが表示されるように調整する。
4) ドキュメント（設計・実装計画）に新しいタブ露出ルールとガードフローを追記する。
5) `pnpm lint && pnpm typecheck` および対象テストを実行し、Integration & Review 用ゲートを通過する。

## Patch

***Provide a unified diff. Include full paths. New files must be complete.***

## Tests

### Outline

- Unit:
  - precision=`beta`/`stable` の Diff タブ露出と `phaseStats` ガード差異
  - バックアップ CTA の `data-merge-diff-enabled` 条件
- Integration:
  - MergeDock DOM における Diff タブの表示／非表示と CTA 活性化の差分

## Commands

### Run gates

- pnpm lint && pnpm typecheck
- pnpm test tests/components/merge.diff.test.tsx
- pnpm test tests/merge/merge-dock-tabs.test.ts

## Notes

### Rationale

- フェーズ B での精緻マージ開放を段階的に進めるため、Diff タブの UI 露出とバックアップ CTA の制御を分離する。

### Risks

- `phaseStats` が未提供の環境で Diff タブ操作が誤って有効化されると、想定外のマージ操作が流入するリスク。

### Follow-ups

- Diff Merge 実装 (`DiffMergeView`) の本格的なハンク適用処理を Phase C で整備する。
