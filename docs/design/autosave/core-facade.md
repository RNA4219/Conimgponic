---
intent_id: INT-AUTOSAVE-CORE
owner: platform-autosave
status: active
last_reviewed_at: 2025-02-15
next_review_due: 2025-03-15
---

# AutoSave Core Facade Task Seed

## メタデータ

```yaml
task_id: 20240215-auto-facade
repo: https://github.com/imgponic/Conimgponic
base_branch: main
work_branch: feat/autosave-core-facade
priority: P1
langs: [typescript]
```

## Objective

AutoSave 中核ファサード (`src/lib/autosave.ts`) の Phase A 要件を満たしつつ、履歴復元・保存制御の API を安定提供する。

## Scope

- In: `src/lib/autosave.ts`, `src/lib/locks.ts`, `docs/AUTOSAVE-DESIGN-IMPL.md`
- Out: UI レイヤ、Collector/Analyzer、外部同期バックエンド
