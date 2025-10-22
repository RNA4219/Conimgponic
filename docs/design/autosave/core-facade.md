---
intent_id: INT-001
owner: autosave-working-group
status: active
last_reviewed_at: 2025-02-18
next_review_due: 2025-03-18
---

# Task Seed Template

## メタデータ

```yaml
task_id: 20240218-autosave-core
repo: https://github.com/Conimgponic/Conimgponic
base_branch: main
work_branch: feat/autosave-core-facade
priority: P1
langs: [typescript]
```

## Objective

`initAutoSave` を中核ファサードとして、Phase A の固定ポリシー下でスナップショット保存・復元・履歴参照を一貫して提供する。

## Scope

- In: `src/lib/autosave.ts`, `docs/AUTOSAVE-DESIGN-IMPL.md`, `tests/autosave/*.spec.ts`
- Out: UI レイヤ、Collector/Analyzer、ロック実装 (`src/lib/locks.ts`)

## Requirements

- Behavior:
  - Phase A 固定値（デバウンス 500ms、アイドル 2s、履歴 20、容量 50MB）を厳守しつつ、自動保存の init/flush/restore/list API を提供。
  - `AutoSaveOptions.disabled` および feature flag `autosave.enabled` の二重ガードで安全に無効化できる。
- I/O Contract:
  - Input: `StoryboardProvider`, `AutoSaveOptions`, feature flag `autosave.enabled`
  - Output: `AutoSaveInitResult`, 復元 API 戻り値、履歴メタデータ
- Constraints:
  - 既存API破壊なし / 不要な依存追加なし
  - Lint/Type/Test はゼロエラー
- Acceptance Criteria:
  - 保存・履歴・復元のシーケンス図が Phase A 要件を満たす
  - TDD 方針とガードのリスク/ロールバック条件が docs に反映されている

## Affected Paths

- docs/design/autosave/**
- docs/AUTOSAVE-DESIGN-IMPL.md
- tests/autosave/*.spec.ts

## Local Commands（存在するものだけ実行）

```bash
pnpm lint && pnpm typecheck && pnpm test
```

## Deliverables

- PR: タイトル/要約/影響/ロールバックに加え、本文へ `Intent: INT-001` と `## EVALUATION` アンカーを明記
- Artifacts: 変更パッチ、テスト、必要ならREADME/CHANGELOG差分

---

## Plan

### Steps

1) 現状把握（対象ファイル列挙、既存テストとI/O確認）
2) 小さな差分で仕様を満たす実装
3) sample::fail の再現手順/前提/境界値を洗い出し、必要な工程を増補
4) テスト追加/更新（先に/同時）
5) コマンド群でゲート通過
6) ドキュメント最小更新（必要なら）

## Patch

***Provide a unified diff. Include full paths. New files must be complete.***

## Tests

### Outline

- Unit:
  - init/flush の遷移が固定ポリシー通りに完了する
  - エラー復帰（lock/GC/restore）が規定通りに失敗・停止・通知する
- Integration:
  - フラグ無効時に No-op で終了する

## Commands

### Run gates

- pnpm lint && pnpm typecheck && pnpm test

## Notes

### Rationale

- Phase A の固定ポリシーと将来拡張の足場を両立するため、ファサード主導で制御する。

### Risks

- 固定値からの逸脱を検出できないと将来の動的設定導入時に不整合が発生する。

### Follow-ups

- Phase B: `AutoSaveOptions` の動的パラメータ化と Collector/Analyzer への通知拡張。
