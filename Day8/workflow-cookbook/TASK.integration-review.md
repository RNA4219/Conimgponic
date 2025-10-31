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

App と MergeDock の AutoSave 連携を整備し、`docs/IMPLEMENTATION-PLAN.md` と `docs/design/app-merge-dock-integration.md` で定義された Diff タブのバックアップ CTA 制御をタスク駆動で検証する。

## Scope

- In: `src/components/MergeDock.tsx`, `tests/components/**`, `tests/merge/**`, `docs/design/**`
- Out: AutoSave storage 実装、バックエンド API、Collector パイプライン

## Requirements

- Behavior:
  - AutoSave ランナー確立時に `window.__mergeDockFlushNow` / `window.__mergeDockAutoSaveSnapshot` を公開し、`docs/design/app-merge-dock-integration.md` §3-4 の統合フロー通りに Diff タブ CTA を制御する。
  - precision=`beta` / `stable` では `phaseStats` 未提供でも Diff タブを描画し、`docs/IMPLEMENTATION-PLAN.md` §0.4 の 5 分しきい値と AutoSave スナップショット同期でバックアップ CTA を露出する。
- I/O Contract:
  - Input: `FlagSnapshot.merge.precision`, `MergeDockPhaseStats?`, `window.__mergeDockAutoSaveSnapshot`
  - Output: `data-merge-diff-visible`, `data-merge-diff-enabled`, `data-testid="merge-dock-backup-cta"`
- Constraints:
  - 既存 API の互換性維持 / 新規依存の追加禁止
  - `pnpm lint && pnpm typecheck && pnpm test --filter merge` の通過
- Acceptance Criteria:
  - `tests/merge/merge-dock-tabs.test.ts` に Diff バックアップ CTA 再現テストが追加され、AutoSave ブリッジ経由で `flushNow` を呼び出せることを検証する。
  - `src/App.tsx` が AutoSave 初期化時に `window` ブリッジを確実に設定/解除し、CTA がロールアウト計画に沿って露出する。

## Affected Paths

- `src/components/MergeDock.tsx`
- `tests/components/merge.diff.test.tsx`
- `tests/merge/merge-dock-tabs.test.ts`
- `docs/design/app-merge-dock-integration.md`
- `docs/IMPLEMENTATION-PLAN.md`

## Local Commands（存在するものだけ実行）

```bash
pnpm lint && pnpm typecheck && pnpm test --filter merge
```

## Deliverables

- PR: タイトル、要約、影響範囲、ロールバック手順に加え `Intent: INT-042` と `## EVALUATION` アンカーを明記
- Artifacts: 変更パッチ、テストログ、Diff タブ露出に関するスクリーンショット (必要に応じて)

---

## Plan

### Steps

1) `docs/IMPLEMENTATION-PLAN.md` と `docs/design/app-merge-dock-integration.md` の CTA 条件を確認し、テスト観点を洗い出す。
2) `tests/merge/merge-dock-tabs.test.ts` へ AutoSave ブリッジ経由のバックアップ CTA 再現テストを追加し RED にする。
3) `src/App.tsx` の AutoSave 初期化で `window` ブリッジを設定/解除し、`lastSuccessAt` 同期を `runner.onEvent` で実装する。
4) 必要に応じて `MergeDock.tsx` の CTA 判定を新しいスナップショットフィールドへ合わせる。
5) `pnpm lint && pnpm typecheck && pnpm test --filter merge` を実行し、ゲート通過を確認する。

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

- pnpm lint && pnpm typecheck && pnpm test --filter merge

## Notes

### Rationale

- フェーズ B での精緻マージ開放を段階的に進めるため、Diff タブの UI 露出とバックアップ CTA の制御を分離する。

### Risks

- `phaseStats` が未提供の環境で Diff タブ操作が誤って有効化されると、想定外のマージ操作が流入するリスク。

### Follow-ups

- Diff Merge 実装 (`DiffMergeView`) の本格的なハンク適用処理を Phase C で整備する。
