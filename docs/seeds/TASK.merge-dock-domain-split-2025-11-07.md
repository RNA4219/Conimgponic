# Task Seed

## メタデータ

```yaml
task_id: 20251107-01
repo: local://Conimgponic
base_branch: work
work_branch: feat/merge-dock-domain-split
priority: P2
langs: [typescript]
status: draft
last_reviewed_at: 2025-11-07
next_review_due: 2025-11-21
```

## Objective

Day8/workflow-cookbook/GUARDRAILS.md が求める「変更は最小差分で行い、Public API を破壊しない」「実装時はテスト駆動開発を基本とし、テストを先に記述する」を守りつつ、Day8/docs/day8/guides/07_contributing.md の「1タスク=1ブランチ=1PR」「衝突を避けるための責務分離」を踏まえて `MergeDock` のモデル計算と OPFS I/O を純粋ロジック層へ抽出し、UI は描画とハンドラ委譲に集中させる。

## Scope

- In: `src/components/MergeDock.tsx`, `src/components/merge-dock/domain.ts`, `src/components/merge-dock/store.ts`, `src/components/merge-dock/io.ts`, `tests/components/merge.diff.test.tsx`, `tests/merge/merge-dock-tabs.test.ts`, `Day8/docs/birdseye/**`
- Out: `src/lib/merge/**` の挙動変更、`DiffMergeView` UI 拡張、BirdEYE の他領域

## Requirements

- Behavior:
  - UI 操作（タブ切替・diff バックアップ CTA・OPFS スナップショット保存/復元）がリファクタ後も変化しない。
  - `planMergeDockTabs` や diff バックアップ判定を `MergeDock` と domain の双方から import できる。
- I/O Contract:
  - `saveStoryboardSnapshot` は OPFS 上に `runs/<timestamp>/` ディレクトリを生成し、`shotlist.(md|csv|jsonl)` と `meta.json` を保存して最後に `runs/latest.txt` を更新する。
  - `loadLatestCompiledSnapshot` は最新タイムスタンプと compiled Markdown を返し、欠損時は `MergeDockSnapshotError` を投げる。
- Constraints:
  - Guardrails のインポート順・型注釈方針を維持し、Day8/docs/day8/guides/07_contributing.md の「差分は 3 ファイル以内」を守るため、ストア・ドメイン・I/O で責務を明示的に区切る。
- Acceptance Criteria:
  - `tests/components/merge.diff.test.tsx` と `tests/merge/merge-dock-tabs.test.ts` が domain import 経由でも GREEN。
  - BirdEYE カプセル/インデックスに domain.ts と io.ts の責務が追記され、`src/components/MergeDock.tsx` の summary が委譲構造を説明している。

## Affected Paths

- src/components/MergeDock.tsx
- src/components/merge-dock/domain.ts
- src/components/merge-dock/io.ts
- src/components/merge-dock/store.ts
- tests/components/merge.diff.test.tsx
- tests/merge/merge-dock-tabs.test.ts
- Day8/docs/birdseye/index.json
- Day8/docs/birdseye/caps/src.components.MergeDock.tsx.json
- Day8/docs/birdseye/caps/src.components.merge-dock.domain.ts.json
- Day8/docs/birdseye/caps/src.components.merge-dock.io.ts.json

## Local Commands（存在するものだけ実行）

```bash
pnpm test -- tests/components/merge.diff.test.tsx
pnpm test -- tests/merge/merge-dock-tabs.test.ts
```

## Deliverables

- PR: MergeDock ドメイン抽出の概要、Intent: INT-001、リスク評価、BirdEYE 更新メモ
- Artifacts: domain/io/store の TypeScript 実装、RED→GREEN テストログ、更新済み BirdEYE JSON

---

## Plan

### Steps

1) Day8/workflow-cookbook/HUB.codex.md のタスク分割ルールを参照し、UI/ドメイン/I/O の依存を洗い出す。
2) 先にテスト (`tests/components/merge.diff.test.tsx`, `tests/merge/merge-dock-tabs.test.ts`) を更新し、domain モジュール import 前提の RED を作る。
3) `src/components/merge-dock/domain.ts` に AutoSave ハートビートと diff 判定を集約し、`src/components/merge-dock/io.ts` へ OPFS 操作を切り出す。
4) `MergeDock.tsx` を描画専用に整理し、BirdEYE カプセルへ責務境界を記録してテストを GREEN に戻す。

## Patch

- [2025-11-07] domain/import refactor 実装中（本タスクで対応）

## Tests

### RED

- 2025-11-07 09:12:15 — `pnpm test -- tests/components/merge.diff.test.tsx`
  - ❌ `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '../../src/components/merge-dock/domain' imported from tests/components/merge.diff.test.tsx`
- 2025-11-07 09:13:02 — `pnpm test -- tests/merge/merge-dock-tabs.test.ts`
  - ❌ 同上、domain import 解決失敗

### GREEN

- 2025-11-07 09:32:44 — `pnpm test -- tests/components/merge.diff.test.tsx`
  - ✅ ドメイン再エクスポート比較・diff バックアップ CTA 判定が通過
- 2025-11-07 09:33:10 — `pnpm test -- tests/merge/merge-dock-tabs.test.ts`
  - ✅ plan/diff backup 期待タブ構成が全ケースで合致

## Commands

- `pnpm test -- tests/components/merge.diff.test.tsx`
- `pnpm test -- tests/merge/merge-dock-tabs.test.ts`

## Notes

- BirdEYE index/caps 更新後は `Day8/workflow-cookbook/GUARDRAILS.md` の「最小読込」を満たすよう `python Day8/workflow-cookbook/tools/codemap/update.py --targets Day8/docs/birdseye/index.json --emit index+caps` を再度案内すること。
