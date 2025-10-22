# ロック API 設計（`src/lib/locks.ts`）

- 参照ドキュメント: [AutoSave 実装詳細](./AUTOSAVE-DESIGN-IMPL.md), [Day8 アーキテクチャ](../Day8/docs/day8/design/03_architecture.md)
- 目的: AutoSave/将来バッチが競合なく `project/` ツリーを更新できるよう、Web Locks 優先・フォールバック併用の API 契約を明確化する。
- スコープ: `src/lib/locks.ts`, `tests/locks/**`。OPFS 書き込みは他モジュールに委譲する。

## 1. 公開 API シグネチャ

```ts
export const WEB_LOCK_KEY = 'imgponic:project';
export const WEB_LOCK_TTL_MS = 25_000;
export const FALLBACK_LOCK_PATH = 'project/.lock';
export const FALLBACK_LOCK_TTL_MS = 30_000;
export const LOCK_HEARTBEAT_INTERVAL_MS = 10_000;
export const MAX_LOCK_RETRIES = 3;

export type LockAcquisitionStrategy = 'web-lock' | 'file-lock';

export interface ProjectLockLease {
  readonly leaseId: string;
  readonly ownerId: string;
  readonly strategy: LockAcquisitionStrategy;
  readonly acquiredAt: number;
  readonly expiresAt: number;
  readonly ttlMillis: number;
  readonly renewAttempt: number;
}

export type ProjectLockEvent =
  | { readonly type: 'lock:attempt'; readonly strategy: LockAcquisitionStrategy; readonly retry: number }
  | { readonly type: 'lock:acquired'; readonly lease: ProjectLockLease }
  | { readonly type: 'lock:renew-scheduled'; readonly lease: ProjectLockLease; readonly nextHeartbeatInMs: number }
  | { readonly type: 'lock:renewed'; readonly lease: ProjectLockLease }
  | { readonly type: 'lock:release-requested'; readonly lease: ProjectLockLease }
  | { readonly type: 'lock:released'; readonly leaseId: string }
  | { readonly type: 'lock:readonly-entered'; readonly reason: 'acquire-failed' | 'renew-failed' | 'release-failed'; readonly lastError: ProjectLockError };

export interface ProjectLockEventTarget {
  subscribe(listener: ProjectLockEventListener): () => void;
  emit(event: ProjectLockEvent): void;
}

export interface BackoffPolicy {
  readonly initialDelayMs: number;
  readonly factor: number;
  readonly maxAttempts: number;
}

export interface AcquireProjectLockOptions {
  readonly signal?: AbortSignal;
  readonly preferredStrategy?: LockAcquisitionStrategy;
  readonly backoff?: Partial<BackoffPolicy>;
  readonly onReadonly?: (reason: ProjectLockError) => void;
}

export interface RenewProjectLockOptions { readonly signal?: AbortSignal; }

export interface ReleaseProjectLockOptions { readonly signal?: AbortSignal; readonly force?: boolean; }

export interface WithProjectLockOptions extends AcquireProjectLockOptions {
  readonly renewIntervalMs?: number;
  readonly releaseOnError?: boolean;
}

export type AcquireProjectLock = (options?: AcquireProjectLockOptions) => Promise<ProjectLockLease>;
export type RenewProjectLock = (lease: ProjectLockLease, options?: RenewProjectLockOptions) => Promise<ProjectLockLease>;
export type ReleaseProjectLock = (lease: ProjectLockLease, options?: ReleaseProjectLockOptions) => Promise<void>;
export type WithProjectLock = <T>(executor: (lease: ProjectLockLease) => Promise<T>, options?: WithProjectLockOptions) => Promise<T>;

export interface ProjectLockApi {
  readonly events: ProjectLockEventTarget;
  readonly acquire: AcquireProjectLock;
  readonly renew: RenewProjectLock;
  readonly release: ReleaseProjectLock;
  readonly withProjectLock: WithProjectLock;
}

export type ProjectLockErrorCode =
  | 'web-lock-unsupported'
  | 'acquire-denied'
  | 'acquire-timeout'
  | 'fallback-conflict'
  | 'lease-stale'
  | 'renew-failed'
  | 'release-failed';

export class ProjectLockError extends Error {
  readonly code: ProjectLockErrorCode;
  readonly retryable: boolean;
  readonly cause?: unknown;
}
```

- Web Lock キーは `imgponic:project` を固定し、Day8 Collector (`workflow-cookbook/**`) に干渉しない。【F:docs/IMPLEMENTATION-PLAN.md†L111-L139】【F:Day8/docs/day8/design/03_architecture.md†L1-L38】
- `ProjectLockError.retryable=false` は AutoSave を閲覧専用へ移行させるフラグとして扱い、UI へ警告イベントを送出する。【F:docs/IMPLEMENTATION-PLAN.md†L120-L139】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L72-L154】

## 2. 再試行戦略と TTL 管理

| フェーズ | 既定挙動 | 再試行判定 | 中断条件 |
| --- | --- | --- | --- |
| Acquire | `navigator.locks.request(WEB_LOCK_KEY, { mode: 'exclusive' })` を優先。`MAX_LOCK_RETRIES` 回までは指数バックオフで試行し、非対応時はファイルロックへ切替。 | `BackoffPolicy` の `initialDelayMs` と `factor` で 0.5s→1s→2s（既定値）を形成し、`fallback-conflict` や一時的な `acquire-timeout` を再試行対象とする。 | 再試行を使い切ると `ProjectLockError(code='acquire-timeout' or 'fallback-conflict', retryable=false)` を発生させ、`onReadonly` へ通知。 |
| Renew | フォールバックロックは `LOCK_HEARTBEAT_INTERVAL_MS` ごとに `renewProjectLock` を呼び、`expiresAt` を `Date.now() + FALLBACK_LOCK_TTL_MS` へ更新。Web Lock ではハートビートのみ発火し、`navigator.locks` ハンドルが失効した場合のみ再取得へ。 | 書き込みエラー (`retryable=true`) の際は `lock:renew-scheduled` イベントで次回ハートビートまで遅延し、`renewAttempt` をインクリメント。 | `renewAttempt` が `MAX_LOCK_RETRIES` 超過または `retryable=false` の例外発生時に `lock:readonly-entered` を通知して再取得フェーズへ戻る。 |
| Release | 取得経路に応じて Web Lock ハンドル解放または `.lock` 削除を行う。`force=true` の場合はフォールバックファイルを孤児扱いで削除。 | 削除失敗 (`retryable=true`) は再試行し、`lock:release-requested` を維持。 | `retryable=false` で失敗した場合でも `.lock` を温存したまま ReadOnly モードへ移行し、Collector/Analyzer 領域へは書き込まない。 |

- `FALLBACK_LOCK_TTL_MS=30_000` はフォールバックファイルの孤児検知しきい値と一致する。`WEB_LOCK_TTL_MS=25_000` はブラウザ依存 TTL を補う心拍間隔として AutoSave から利用される。【F:docs/IMPLEMENTATION-PLAN.md†L120-L139】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L108-L183】
- `BackoffPolicy` 既定値は `initialDelayMs=500`, `factor=2`, `maxAttempts=3`。AutoSave の指数バックオフ要件（0.5s→1s→2s, 上限4s以内）と整合させる。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L149-L214】
- Day8 Collector/Analyzer が管理する `workflow-cookbook/` 配下には書き込まず、フォールバックは `project/.lock` のみを対象とする。【F:Day8/docs/day8/design/03_architecture.md†L1-L38】

## 3. イベント購読モデル

| イベント | 送信タイミング | 主要フィールド | AutoSave 側の利用例 |
| --- | --- | --- | --- |
| `lock:attempt` | 取得を開始するたび | `strategy`, `retry` | UI に「ロック取得中」を表示し、Collector へ取得試行を記録。 |
| `lock:acquired` | Web Lock/ファイルロックの取得成功時 | `lease` | `phase='awaiting-lock'` から `writing-current` への遷移トリガ。 |
| `lock:renew-scheduled` | ハートビートによる更新を待機する際 | `lease`, `nextHeartbeatInMs` | 心拍タイマーが次回再試行までの猶予を表示。 |
| `lock:renewed` | TTL の更新が成功した時 | `lease` | AutoSave ステータスを維持しつつ `lastSuccessAt` を更新。 |
| `lock:release-requested` | `releaseProjectLock` が呼ばれた直後 | `lease` | 停止中インジケータへ状態遷移し、未完了処理を待機。 |
| `lock:released` | リースが正常に解放された時 | `leaseId` | AutoSave を `idle` へ戻し、Collector へ成功イベントを送信。 |
| `lock:readonly-entered` | 再試行不能なエラー発生時 | `reason`, `lastError` | UI を ReadOnly モードに固定し、Incident 通知のトリガとする。 |

- `subscribeLockEvents` は複数購読者を許容し、解除関数は冪等。イベントは同期発火で Collector の JSONL 出力を直接触らずに UI/テレメトリへ伝搬する。【F:docs/IMPLEMENTATION-PLAN.md†L120-L139】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L149-L214】
- `withProjectLock` は `acquireProjectLock`→処理→`releaseProjectLock` を直列化し、途中で例外が発生しても `lock:readonly-entered` を通じて状態遷移を確実に通知する。

## 4. テスト観点（抜粋）

1. Web Lock 正常系: `navigator.locks` 対応環境で `lock:attempt`→`lock:acquired`→`lock:release-requested`→`lock:released` の順序を検証。
2. フォールバック競合: `.lock` が TTL 内の状態で取得を試行し、`lock:attempt` 再発火と最終 `lock:readonly-entered` (`reason='acquire-failed'`) を確認。
3. ハートビート更新: フォールバック取得後に `lock:renew-scheduled`→`lock:renewed` が発火し、`renewAttempt` が `MAX_LOCK_RETRIES` を超えないことを確認。
4. 解放失敗: `releaseProjectLock` が連続失敗した際に `lock:readonly-entered` (`reason='release-failed'`) を通知しつつ Collector/Analyzer 配下へ副作用を発生させないことを検証。

- 上記シナリオは AutoSave テスト戦略の Fake Timer/OPFS Stub を流用し、再試行可否 (`retryable`) と UI 状態遷移を同期させる。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L215-L270】

