# ロック API 設計（`src/lib/locks.ts`）

- 参照ドキュメント: [AutoSave 実装詳細](./AUTOSAVE-DESIGN-IMPL.md), [Day8 アーキテクチャ](../Day8/docs/day8/design/03_architecture.md)
- 目的: AutoSave/将来バッチが競合なく `project/` ツリーを更新できるよう、Web Locks 優先・フォールバック併用の API 契約を明確化する。
- スコープ: `src/lib/locks.ts`, `tests/locks/**`。OPFS 書き込みは他モジュールに委譲する。

## 1. 公開 API シグネチャ

```ts
export interface AcquireLockOptions {
  readonly scope?: 'autosave' | 'history';
  readonly signal?: AbortSignal;
  readonly retry?: Partial<RetryPolicyConfig>;
}

export interface RetryPolicyConfig {
  readonly initialDelayMs: number; // 既定: 500
  readonly maxDelayMs: number; // 既定: 4000
  readonly multiplier: number; // 既定: 2
  readonly maxAttempts: number; // 既定: 5 (取得 1 + 再試行 4)
}

export type LockBackend = 'web' | 'fallback';

export interface ProjectLockLease {
  readonly id: string; // UUID
  readonly backend: LockBackend;
  readonly scope: 'autosave' | 'history';
  readonly acquiredAt: number; // epoch ms
  readonly ttlExpiresAt: number; // epoch ms, fallback のみ更新対象
}

export type LockErrorCode =
  | 'web-lock-unsupported'
  | 'lock-timeout'
  | 'lock-unavailable'
  | 'lock-renewal-failed'
  | 'lock-release-failed';

export interface LockError extends Error {
  readonly code: LockErrorCode;
  readonly retryable: boolean;
  readonly cause?: unknown;
}

export interface ProjectLockEventBase {
  readonly at: number;
  readonly leaseId: string;
  readonly backend: LockBackend;
  readonly scope: 'autosave' | 'history';
}

export interface LockAcquiredEvent extends ProjectLockEventBase {
  readonly type: 'lock:acquired';
  readonly attempt: number;
}

export interface LockRenewedEvent extends ProjectLockEventBase {
  readonly type: 'lock:renewed';
  readonly ttlExpiresAt: number;
}

export interface LockReleasedEvent extends ProjectLockEventBase {
  readonly type: 'lock:released';
}

export interface LockRetryScheduledEvent extends ProjectLockEventBase {
  readonly type: 'lock:retry';
  readonly attempt: number;
  readonly delayMs: number;
  readonly reason: 'contended' | 'unavailable' | 'transient-error';
}

export interface LockWarningEvent extends ProjectLockEventBase {
  readonly type: 'lock:cleanup-warning';
  readonly message: string;
}

export interface LockErrorEvent extends ProjectLockEventBase {
  readonly type: 'lock:error';
  readonly error: LockError;
}

export type ProjectLockEvent =
  | LockAcquiredEvent
  | LockRenewedEvent
  | LockReleasedEvent
  | LockRetryScheduledEvent
  | LockWarningEvent
  | LockErrorEvent;

export type LockEventListener = (event: ProjectLockEvent) => void;

export function subscribeLockEvents(listener: LockEventListener): () => void;

export async function acquireProjectLock(
  options?: AcquireLockOptions
): Promise<ProjectLockLease>;

export async function renewProjectLock(
  lease: ProjectLockLease
): Promise<ProjectLockLease>;

export async function releaseProjectLock(lease: ProjectLockLease): Promise<void>;

export async function withProjectLock<T>(
  fn: (lease: ProjectLockLease) => Promise<T>,
  options?: AcquireLockOptions
): Promise<T>;
```

- `scope` 既定値は `'autosave'`。Web Lock 名は `imgponic:project:${scope}` とし、Day8 Collector (`collector:*`) と衝突しないよう固定する。【F:docs/IMPLEMENTATION-PLAN.md†L77-L111】【F:Day8/docs/day8/design/03_architecture.md†L1-L38】
- `ProjectLockLease.ttlExpiresAt` はフォールバック経路の再取得判断に利用し、Web Lock 経路では `Number.POSITIVE_INFINITY` を設定する。
- `LockError.retryable` が `false` の場合、AutoSave ランナーは閲覧専用モードへ移行し、UI 警告に利用される。【F:docs/IMPLEMENTATION-PLAN.md†L67-L111】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L72-L154】

## 2. 再試行戦略と TTL 管理

| フェーズ | 既定挙動 | 再試行判定 | 中断条件 |
| --- | --- | --- | --- |
| Acquire | Web Locks を `AbortSignal` 10s で要求。失敗時は `.lock` フォールバックを `project/.lock` に生成。 | Web Lock が `SecurityError`/`NotSupportedError` を返した場合はフォールバックへ即移行。競合 (`TimeoutError`/`.lock` TTL 内) は指数バックオフで再試行。 | `maxAttempts` 消費後は `LockError(code='lock-unavailable', retryable=false)` を投げ、UI を ReadOnly 化。 |
| Renew | フォールバックのみ 20s 経過時に `renewProjectLock` を呼び、`ttlExpiresAt` を `now + 30s` に更新。Web Lock では no-op。 | 書き込み失敗 (`NotAllowedError` 以外) は再試行対象として `LockRetryScheduledEvent` を発火し、次回 0.5→1→2→4s で再実行。 | 更新が 5 回連続で失敗した場合は `lock-renewal-failed` を返却し、AutoSave は再取得シーケンスへ戻る。 |
| Release | Web Lock ハンドラ `finally` で解放。フォールバックは `.lock` 削除。 | 削除失敗時は `lock:cleanup-warning` を通知し、次回取得前にガーベジコレクションを試行。 | `.lock` が削除できず 3 回失敗した場合でも処理を継続し、Collector/Analyzer 配下へは書き込まない。 |

- 既定 `RetryPolicyConfig`: `initialDelayMs=500`, `multiplier=2`, `maxDelayMs=4000`, `maxAttempts=5`。AutoSave の指数バックオフ要件（0.5s→1s→2s→4s）と一致させる。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L149-L214】
- `.lock` の TTL は常に 30s。取得時は既存ファイルの `ttlExpiresAt` が過去なら孤児扱いで上書きし、未来なら競合として再試行へ遷移する。【F:docs/IMPLEMENTATION-PLAN.md†L67-L111】
- Day8 Collector/Analyzer のパスは `workflow-cookbook/` 配下であるため、フォールバックファイルの作成・削除対象は `project/.lock` のみに限定する。【F:Day8/docs/day8/design/03_architecture.md†L1-L38】

## 3. イベント購読モデル

| イベント | 送信タイミング | 主要フィールド | AutoSave 側の利用例 |
| --- | --- | --- | --- |
| `lock:acquired` | 初回取得またはフォールバックへ切り替えた瞬間 | `attempt`, `backend` | インジケータを `awaiting-lock` → `writing` へ遷移させ、Collector メトリクスへ取得成功を記録。 |
| `lock:renewed` | フォールバックの `renewProjectLock` 成功時 | `ttlExpiresAt` | 心拍タイマーが TTL 更新の成功/失敗を監視し、`retryable` 判定を UI に反映。 |
| `lock:retry` | 競合または一時エラーで再試行をスケジュールした時 | `attempt`, `delayMs`, `reason` | AutoSave ステータスを `awaiting-lock` に戻し、指数バックオフが UI に可視化される。 |
| `lock:error` | `retryable=false` の例外が発生した時 | `error.code`, `error.retryable` | UI を ReadOnly に切り替え、テレメトリに重大イベントとして送信。 |
| `lock:cleanup-warning` | フォールバック解放で `.lock` 削除に失敗した時 | `message` | 次回取得前に遅延ガーベジコレクションを試行し、Collector/Analyzer への副作用を防止。 |
| `lock:released` | 正常に解放した時 | - | AutoSave ステートを `idle` へ戻す。 |

- `subscribeLockEvents` は複数購読者（UI・テレメトリ）が同時に登録できるよう、シンプルな pub/sub を返す。解除関数は idempotent。イベントは必ず `at` 昇順で同期発火し、Collector の JSONL に直接書き込まない。【F:docs/IMPLEMENTATION-PLAN.md†L67-L111】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L149-L214】
- `withProjectLock` は `acquireProjectLock` → `fn` → `releaseProjectLock` を直列化し、途中エラー時でも `lock:released` または `lock:cleanup-warning` を必ず送出する。

## 4. テスト観点（抜粋）

1. Web Lock 正常系: `navigator.locks` 対応環境で `acquireProjectLock` → `releaseProjectLock`。イベント順序は `lock:acquired` → `lock:released`。
2. フォールバック競合: `.lock` が TTL 内の状態で取得を試行し、指数バックオフイベントと最終 `lock:error` (`lock-unavailable`) を検証。
3. 期限更新: フォールバック取得後 20s 経過時に `renewProjectLock` を呼び、`ttlExpiresAt` 更新と `lock:renewed` イベントを確認。
4. クリーンアップ警告: `.lock` 削除に失敗するモックを用いて `lock:cleanup-warning` が送出されること、Collector/Analyzer 配下を変更しないことを確認。

- 上記シナリオは AutoSave テスト戦略の Fake Timer/OPFS Stub を流用し、既存 `retryable` 判定と整合させる。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L215-L270】

