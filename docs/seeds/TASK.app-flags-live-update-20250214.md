# Task Seed: App Flag Snapshot ライブ反映

## メタデータ

```yaml
task_id: 20250214-02
repo: https://github.com/owner/repo
base_branch: main
work_branch: feat/app-flag-live-refresh
priority: P1
langs: [typescript]
```

## Objective

`App.tsx` で `FlagSnapshot` を購読し、`autosave.enabled`/`merge.precision` の更新を即座に AutoSave ランナーと MergeDock へ反映させる。

> docs/IMPLEMENTATION-PLAN.md §0.2 "`App.tsx` ... FlagSnapshot(source 情報付き)"【F:docs/IMPLEMENTATION-PLAN.md†L10-L47】
>
> docs/design/app-merge-dock-integration.md §3 "FlagSnapshot を単一ソースとして利用し、AutoSave ブートストラップと MergeDock プロップスを同期"【F:docs/design/app-merge-dock-integration.md†L33-L71】

## Scope

- In: src/App.tsx, src/hooks/useAutoSaveIntegration.ts, tests/app/**
- Out: collector/analyzer scripts, UI コンポーネント以外の設定

## Requirements

- Behavior:
  - `autosave.enabled` の変更で AutoSave ランナーが再評価され、CTA 表示可否が最新化される。
  - `merge.precision` の変更で MergeDock precision/threshold が即座に再計算される。
- I/O Contract:
  - Input: localStorage / workspace 由来の `FlagSnapshot`
  - Output: AutoSave ランナー状態, MergeDock プロップス
- Constraints:
  - 既存API破壊なし / 不要な依存追加なし
  - Lint/Type/Test はゼロエラー
- Acceptance Criteria:
  - `tests/app/app.flags-live-update.test.tsx` が RED→GREEN を記録し、フラグ切替で統合結果が更新される。
  - `pnpm test --filter app` と `pnpm lint && pnpm typecheck` がグリーン。

## Affected Paths

- src/App.tsx
- tests/app/app.flags-live-update.test.tsx
- docs/hooks/AutoSave (必要に応じて)

## Local Commands（存在するものだけ実行）

```bash
pnpm lint && pnpm typecheck
pnpm test --filter app
```

## Deliverables

- PR: Intent: INT-001 を本文に追記し、`## EVALUATION` アンカーにテストログ要約を記載
- Artifacts: 変更パッチ、テストログ（RED→GREEN）

---

## Plan

### Steps

1) 現状把握 — `resolveAutoSaveBootstrapPlan`/`resolveMergeDockIntegration` が `FlagSnapshot` を参照する導線を確認。
2) RED テスト — `tests/app/app.flags-live-update.test.tsx` にフラグ切替で統合結果が更新されない既存挙動を固定。
3) 実装 — `useFlagSnapshot` 購読フックを `App.tsx` に導入し、`storage` イベント/明示通知で Flag 再評価を行う。
4) リファクタ — AutoSave ランナー/ MergeDock 連携を Phase-b0 方針に沿って再評価し、副作用を隔離。
5) テスト — `pnpm test --filter app`、`pnpm lint && pnpm typecheck` を実行。

## Patch

***Provide a unified diff. Include full paths. New files must be complete.***

## Tests

### Outline

- Integration:
  - `autosave.enabled` トグルで AutoSave ランナー決定が更新されるケース
  - `merge.precision` トグルで MergeDock precision/threshold が更新されるケース

## Commands

### Run gates

- pnpm lint && pnpm typecheck
- pnpm test --filter app

## Notes

### Rationale

- FlagSnapshot を単一ソースに集約し、Phase-b0 のロールアウト要件を満たすため。

### Risks

- `storage` イベント未対応環境でフラグ反映が遅延するリスク。

### Follow-ups

- `resolveFlags` 側で BroadcastChannel を導入し、複数タブ同期を高速化する検討。
