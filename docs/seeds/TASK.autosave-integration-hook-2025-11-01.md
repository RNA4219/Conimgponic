# Task Seed

## メタデータ

```yaml
task_id: 20251101-01
repo: local://Conimgponic
base_branch: work
work_branch: feat/autosave-integration-hook
priority: P1
langs: [typescript, react]
status: draft
last_reviewed_at: 2025-11-01
next_review_due: 2025-11-15
```

## Objective

App.tsx に密結合していた自動保存プラン評価・MergeDockブリッジ・差分監視をカスタムフック `useAutoSaveIntegration` に集約し、Day8 Guardrails の副作用分離・TDD 原則を担保する。

## Scope

- In: `src/hooks/useAutoSaveIntegration.ts`, `src/App.tsx`, `tests/hooks/useAutoSaveIntegration.test.ts`
- Out: MergeDock UI 実装や autosave runner 本体 (`src/lib/autosave.ts`) のポリシー変更、OPFS ツールバー処理

## Requirements

- Behavior:
  - `useAutoSaveIntegration` は `planAutoSave` / `installMergeDockAutoSaveBridge` / `watchAutoSaveStoryboardDiffs` を内包し、App.tsx 側で runner/bridge の副作用を管理しない。
  - 自動保存フラグが無効な場合に runner/bridge/subscription が即時 dispose されることを保証する。
  - 自動保存フラグが有効な場合に MergeDock window へ `__mergeDockAutoSaveSnapshot`/`__mergeDockFlushNow` が公開され、runner イベントで `lastSuccessAt` が更新される。
  - storyboard 更新時に `AutoSaveInitResult.markDirty({ pendingBytes })` が呼び出され、pendingBytes は最新 storyboard の JSON 文字列長と一致する。
- I/O Contract:
  - Hook の引数 `store` は `getState` / `subscribe` を提供する Zustand ストア互換である。
  - 返り値は `autoSavePlan` / `autoSaveDecision` を公開し、App.tsx から Guard telemetry 発火のみを許容する。
- Constraints:
  - Day8/workflow-cookbook/HUB.codex.md に従い、RED→GREEN の順にテストを追加してから実装する。
  - 最小差分で App.tsx の状態管理を整理し、Public API (既存の `planAutoSave` export) を後方互換に保つ。
- Acceptance Criteria:
  - `pnpm test tests/hooks/useAutoSaveIntegration.test.ts` がグリーン。
  - Hook テストが RED→GREEN のログを Task Seed Tests セクションで追跡できる。

## Affected Paths

- src/hooks/useAutoSaveIntegration.ts
- src/App.tsx
- tests/hooks/useAutoSaveIntegration.test.ts

## Local Commands

```bash
pnpm test tests/hooks/useAutoSaveIntegration.test.ts
```

## Deliverables

- PR: App.tsx 自動保存統合のフック化（Intent: INT-001, Priority: P1）
- Artifacts: RED/ GREEN テストログ、Hook 依存解消に関するノート

---

## Plan

1. `tests/hooks/useAutoSaveIntegration.test.ts` を新設し、autosave 無効時の runner dispose と MergeDock 通知、差分監視を再現する RED テストを作成する。
2. `src/hooks/useAutoSaveIntegration.ts` を実装し、`planAutoSave`/`installMergeDockAutoSaveBridge`/`watchAutoSaveStoryboardDiffs` を移植しつつ `synchronizeAutoSaveIntegration` で runner ライフサイクルを統合する。
3. `src/App.tsx` をフック利用へリファクタリングし、既存エクスポートの互換性を維持したまま副作用管理を削除する。
4. `pnpm test tests/hooks/useAutoSaveIntegration.test.ts` を実行して GREEN を確認し、Notes/Tests/Commands にログを記録する。

## Patch

- Hook 本体 (`useAutoSaveIntegration`) で runner/bridge/subscription を集中管理し、App.tsx から関連ロジックを削除して呼び出しのみに整理した。
- カスタムフック専用のテスト群を追加し、自動保存切り替えと MergeDock 通知・差分監視を RED→GREEN で検証した。

## Tests

- RED: `pnpm test -- --filter hooks -- --test-name-pattern useAutoSaveIntegration` （モジュール未実装・テスト失敗）【99312d†L1-L4】【b0dbf8†L1-L3】
- GREEN: `pnpm test tests/hooks/useAutoSaveIntegration.test.ts`（hook 実装後に成功）【a5c606†L1-L10】

## Commands

- `pnpm test -- --filter hooks -- --test-name-pattern useAutoSaveIntegration`【99312d†L1-L4】
- `pnpm test tests/hooks/useAutoSaveIntegration.test.ts`【a5c606†L1-L10】

## Notes

### Rationale

- App.tsx から副作用を分離し、Day8 Guardrails の「副作用の隔離」と TDD を満たすことで MergeDock 連携と autosave runner の保守性を向上させる。

### Risks

- Hook のランナー同期ロジックが今後拡張される際に、依存注入の扱いを誤るとテスト困難になる恐れ。`synchronizeAutoSaveIntegration` の API 安定性を継続監視する。

### Follow-ups

- `useAutoSaveIntegration` の依存注入パラメータを telemetry テストと連携させる追加タスクを検討（Collector 通知の E2E カバレッジ強化）。
