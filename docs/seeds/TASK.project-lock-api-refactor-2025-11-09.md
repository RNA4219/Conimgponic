# Task Seed

## メタデータ

```yaml
task_id: 20251109-01
repo: local://Conimgponic
base_branch: main
work_branch: refactor/project-lock-api
priority: P1
langs: [typescript]
status: proposed
last_reviewed_at: 2025-11-09
next_review_due: 2025-11-16
```

## Objective

`src/lib/locks.ts` に集約されていた acquire/renew/release/with 処理を責務別モジュールへ分割し、ガード更新と Birdseye の依存トポロジ同期を完了させる。

## Scope

- In: `src/lib/locks/**/*.ts`, `tests/lib/locks/**/*.ts`, `Day8/docs/birdseye/**`, `docs/seeds/*project-lock*`
- Out: AutoSave UI / VS Code 拡張機能の挙動変更

## Requirements

- `Day8/workflow-cookbook/HUB.codex.md` と `Day8/docs/TASKS.md` が示す「1タスク=1PR」「RED→GREEN の順でテストを先行する」原則を明文化し、スコープ競合を回避する。
- acquire/renew/release/with それぞれに対して Web Lock / フォールバック戦略をカバーする RED テスト (`tests/lib/locks/*.test.ts`) を追加し、挙動を保護したうえで実装を分割する。
- 分割後の `src/lib/locks/index.ts` で `ProjectLockApi` を再エクスポートし、後方互換を維持したまま release ガード (`safeRelease`) を共有する。
- Birdseye (`Day8/docs/birdseye/index.json` / `caps/src.lib.locks*.json`) を新構成へ同期し、依存ノードと `generated_at` を更新する。

## Tests

- `pnpm test -- tests/lib/locks`
- `pnpm test --filter autotag:autosave`

## Notes

- Guardrails: 再試行ポリシーや readonly 降格の契約を変更する場合は追加の Task Seed を起票し、AutoSave テレメトリの差分確認を別 PR で追跡する。
