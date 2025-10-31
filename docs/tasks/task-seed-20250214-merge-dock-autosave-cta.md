# Task Seed: MergeDock AutoSave CTA ガード再評価

## 背景
- `Day8/workflow-cookbook/TASK.codex.md` が定義する TDD 原則に基づき、AutoSave バックアップ CTA の露出制御をテスト先行で整備する。
- `docs/IMPLEMENTATION-PLAN.md` Phase-b0 ガードでは Diff Merge タブのバックアップ CTA を 5 分閾値で制御し、Phase 緩和前でも誤表示させないことが必須とされている。【docs/IMPLEMENTATION-PLAN.md†L120-L177】
- `docs/design/app-merge-dock-integration.md` は AutoSave スナップショットと MergeDock UI の同期要件を規定しており、`FlagSnapshot` 配下の AutoSave 状態に追随できる監視が必要である。【docs/design/app-merge-dock-integration.md†L1-L83】

## ゴール
1. AutoSave ブリッジ経由で `lastSuccessAt` が更新された際、Diff Merge タブのバックアップ CTA が 5 分閾値を遵守して自動表示/非表示を切り替えること。
2. 監視ロジックが Phase-b0 ガードを逸脱せず、既存 UI レイアウトへ最小差分で組み込まれていること。

## スコープ
- In: `src/components/MergeDock.tsx`, `tests/merge/merge-dock-tabs.test.ts`, AutoSave ブリッジ (`attachMergeDockAutoSaveBridge`).
- Out: AutoSave runner 実装、Diff Merge タブ以外のタブレイアウト、OPFS 永続化処理。

## 要件
- Behavior:
  - AutoSave 成功直後は CTA を非表示にし、5 分経過後に自動的に再表示する。
  - Phase-b0 ガード（precision=`stable`/`beta` のみ）を厳守する。
- I/O Contract:
  - Input: AutoSave runner イベント (`write-succeeded`) 経由の `lastSuccessAt`。
  - Output: DOM 属性 `data-testid="merge-dock-backup-cta"` の有無で露出を判定可能。
- Constraints:
  - 既存 API 破壊なし / 依存追加なし。
  - `pnpm lint && pnpm typecheck && pnpm test --filter merge` をグリーンに保つ。
- Acceptance Criteria:
  - RED → GREEN のテストが `node:test` で確認される。
  - MergeDock の監視ロジックが Phase-b0 閾値（5 分）と設計文書に一致する。

## タスク
1. RED: `tests/merge/merge-dock-tabs.test.ts` へ AutoSave ブリッジ経由の CTA 自動トグルシナリオを追加する。`attachMergeDockAutoSaveBridge` を用い、5 分閾値を境に表示が再度有効化されることを検証する。
2. GREEN: `src/components/MergeDock.tsx` に AutoSave スナップショットと経過時間を監視する副作用（`useEffect` + `setInterval` 等）を追加し、`shouldRenderDiffBackupCTA` の再評価が自動化されるようにする。
3. REFACTOR: 必要であれば監視間隔やテレメトリ整合性を確認し、Phase-b0 ガードの逸脱を防ぐ軽量な追従を検討する（追加変更が必要になった場合は別 Task Seed へ分割）。

## 実行コマンド
```bash
pnpm test --filter merge
pnpm lint && pnpm typecheck
```

## リスク/懸念
- `setInterval` による描画負荷が 5% を超える場合は監視間隔の調整や `useSyncExternalStore` への切り替えを検討する（Follow-up Task Seed で追跡）。
