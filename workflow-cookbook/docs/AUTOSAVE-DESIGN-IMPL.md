---
intent_id: INT-001
owner: docs-core
status: draft
last_reviewed_at: 2025-10-28
next_review_due: 2025-11-28
---

# AutoSave 実装設計

参照: [README.md](../README.md) / [HUB.codex.md](../HUB.codex.md) /
[docs/IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) /
[docs/tasks/task-autosave-project-locks.md](tasks/task-autosave-project-locks.md) /
[docs/MERGE-DESIGN-IMPL.md](MERGE-DESIGN-IMPL.md)

## 不変条件

- プロジェクトロック取得中は同一プロジェクトに対する並列 AutoSave 書き込みを禁止し、最後に確定したスナップショットのタイムスタンプが単調増加すること。
- キャッシュ同期時はローカル差分とサーバースナップショットの CRDT マージ結果が同一であることを検証する。
- フラグ無効化時はロールバック前の最新スナップショットを読み取り専用で保持し、再有効化時に差分適用を保証する。

## 例外設計

- リトライ可能例外: ネットワークタイムアウト、軽微なロック競合。指数バックオフ付きで最大 3 回リトライする。
- リトライ不可例外: スキーマ不一致、整合性チェック失敗。即座に
  [docs/tasks/task-autosave-project-locks.md#ロールバック手順][task-autosave-rollback]
  へ移行する。
- すべての例外は `autosave.project_lock` フラグ状態と関連スナップショット ID を含む監査ログに記録する。

## I/O 契約

- 入力: `project_id`, `snapshot_delta`, `lock_token`, `timestamp`。`lock_token` は Merge コンポーネントから提供され、空値を許容しない。
- 出力: `status` (`ok` | `skipped` | `rolled_back`), `applied_snapshot_id`, `next_retry_at?`。
- サイドチャネル: テレメトリイベント `autosave.snapshot.commit` と `autosave.rollback.triggered` を発行する。

## UI/ロック協調

- エディタ UI は `autosave.project_lock` フラグを監視し、ロック獲得中は保存ボタンをグレーアウトする。UI 状態遷移は
  [docs/MERGE-DESIGN-IMPL.md#ロック協調][merge-lock-coordination] で定義されたロック解放イベントをトリガーに復帰する。
- ロック取得失敗時は UI に非破壊的なトースト通知を表示し、Merge の `precision_mode` に応じてメッセージを分岐する。
- ローカル差分が大きい場合は Merge 側の再計算が完了するまで同期ポーリングを抑制し、UI スレッドのブロッキングを避ける。

## テレメトリ要件

- `autosave.snapshot.commit` は成功時に `latency_ms`、`lock_wait_ms`、`precision_mode` を属性として記録し、
  [docs/MERGE-DESIGN-IMPL.md#テレメトリ要件][merge-telemetry] と集約ストレージを共有する。
- ロールバック発動時は `autosave.rollback.triggered` と `merge.conflict.rate` を突き合わせ、
  [docs/IMPLEMENTATION-PLAN.md#段階導入チェックリスト][plan-rollout-checklist]
  の審査項目を自動評価する。
- テレメトリ送信は失敗してもビジネスロジックをブロックしないよう非同期化し、最大 30 秒でタイムアウトさせる。

---

- 逆リンク: [docs/tasks/task-autosave-project-locks.md](tasks/task-autosave-project-locks.md) /
  [docs/MERGE-DESIGN-IMPL.md](MERGE-DESIGN-IMPL.md) /
  [docs/IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) /
  [README.md](../README.md) /
  [HUB.codex.md](../HUB.codex.md)

[task-autosave-rollback]:
  tasks/task-autosave-project-locks.md#ロールバック手順
[merge-lock-coordination]:
  MERGE-DESIGN-IMPL.md#ロック協調
[merge-telemetry]:
  MERGE-DESIGN-IMPL.md#テレメトリ要件
[plan-rollout-checklist]:
  IMPLEMENTATION-PLAN.md#段階導入チェックリスト
