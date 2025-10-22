# AutoSave Lock 層 詳細設計

## 1. 目的と前提
- AutoSave / 今後のプロジェクトスコープバッチが **同一排他制御** を共有できる抽象 API を提供する。
- `navigator.locks` を優先しつつ、未実装ブラウザでも `.lock` ファイルへフォールバックする。
- Collector / Analyzer が利用する `workflow-cookbook/` 系パスとの干渉を避け、`project/` 配下にロック情報を閉じ込める。

## 2. API 型定義サマリ
| 関数 / 型 | 役割 | 備考 |
| --- | --- | --- |
| `AcquireProjectLock(options)` | ロック取得 | TTL/ハートビートを `options` で上書き可。Web Lock → ファイルロックの順で試行。 |
| `RenewProjectLock(lease, options)` | TTL 更新 | Web Lock ハンドル更新 + `.lock` 書換を同一 UUID で行う。 |
| `ReleaseProjectLock(lease, options)` | 解放 | 失敗時は `ProjectLockError(code='release-failed')` を発火。 |
| `withProjectLock(executor, options)` | 高レベルヘルパ | `executor` 実行前にロック獲得。失敗時は `ProjectLockEvent` で通知。 |
| `ProjectLockLease` | ロック実体 | `resource` に Web Lock キー or `.lock` パス、`nextHeartbeatAt` で次回更新時刻を伝達。 |
| `ProjectLockEvent` | イベント購読 | 詳細は §3。 |
| `ProjectLockError` | 例外 | `operation`/`retryable` で再試行可否を明示。 |

`src/lib/locks.ts` の公開 API はこの設計に準拠する。TTL / ハートビートの既定値は以下：
- Web Lock TTL: 25s
- `.lock` TTL: 30s
- ハートビート間隔: 10s (両 TTL より短く設定)

## 3. イベントシーケンスと通知
```mermaid
documentationDiagram
  section Acquire
    AutoSave ->> LockManager: lock:attempt(strategy="web-lock")
    LockManager -->> AutoSave: lock:waiting(delayMs=backoff)
    LockManager -->> AutoSave: lock:acquired(lease)
    LockManager -->> AutoSave: lock:renew-scheduled(nextHeartbeat)
  section Heartbeat
    Scheduler ->> LockManager: renew(lease)
    LockManager -->> Scheduler: lock:renewed(lease)
  section Fallback
    LockManager -->> AutoSave: lock:warning(warning="fallback-engaged")
    LockManager -->> AutoSave: lock:fallback-engaged(lease)
  section Failure
    LockManager -->> AutoSave: lock:error(operation, ProjectLockError)
    LockManager -->> AutoSave: lock:readonly-entered(reason, lastError)
```

- `lock:waiting`: バックオフ計画に従って遅延再試行する際に発火。UI ではリトライ中表現に利用。
- `lock:warning`: フォールバック利用やハートビート遅延が検知された際に 1 回だけ通知。
- `lock:error`: acquire / renew / release のいずれかで失敗した場合に発火。`ProjectLockError.retryable` が true なら指数バックオフで再試行。
- `lock:readonly-entered`: 再試行不能と判断した場合に AutoSave を read-only モードへ遷移させるフック。

## 4. 時系列と TTL 更新手順
| ステップ | 時刻 (ms) | 操作 | 詳細 |
| --- | --- | --- | --- |
| 1 | t0 | `AcquireProjectLock` | `navigator.locks` で `WEB_LOCK_KEY` を要求。不可なら `.lock` ファイルを `AtomicWrite`。 |
| 2 | t0 + Δ | Lease確定 | `ProjectLockLease` を生成し `nextHeartbeatAt = t0 + heartbeatInterval`。`lock:acquired` を通知。 |
| 3 | t0 + heartbeat | `RenewProjectLock` | Web Lock ハンドル更新 → `.lock` を同一 UUID で上書き。どちらか失敗で `lock:error`。 |
| 4 | t0 + TTL | (成功ケース) | 更新完了時 `expiresAt` を再計算。`lock:renewed` と `lock:renew-scheduled` を順に通知。 |
| 5 | 失敗時 | - | `retryable=true` なら `lock:waiting` → 再試行。`retryable=false` は `lock:readonly-entered`。 |
| 6 | 終了 | - | `ReleaseProjectLock` が Web Lock 解放 → `.lock` 削除の順で実行。 |

## 5. 例外階層とリトライ方針
| Code | operation | retryable | 主原因 | ハンドリング |
| --- | --- | --- | --- | --- |
| `web-lock-unsupported` | acquire | true | API 未対応 | 即座にフォールバックへ切替。 |
| `acquire-denied` | acquire | true | 他タブ保持 | バックオフ後に再試行。 |
| `acquire-timeout` | acquire | true | OS レベル応答なし | バックオフで再試行、MAX_RETRIES 超過で read-only。 |
| `fallback-conflict` | acquire | true | `.lock` が他 UUID | `lock:warning(fallback-degraded)` → 再試行。 |
| `lease-stale` | renew | false | TTL 超過 | 即 read-only へ移行。 |
| `renew-failed` | renew | true | 一時的書込失敗 | バックオフ再試行。 |
| `release-failed` | release | false | ファイル削除不可等 | ログ出力後に警告通知。 |

## 6. テスト計画 (Task Seed)
- Web Lock 正常系: acquire → renew → release のイベント順序を検証。`lock:renew-scheduled` と `lock:renewed` の間隔が `heartbeatIntervalMs` に一致すること。
- フォールバック系: `navigator.locks` モックで拒否 → `.lock` 作成パスを確認。`lock:fallback-engaged` と `lock:warning` が発火すること。
- 競合系: 2 つ目の acquire が `acquire-denied` を受け取り、`lock:waiting` がバックオフ遅延値を通知すること。
- リトライ不可エラー: `lease-stale` シナリオで `lock:readonly-entered` が一度だけ送出されること。
- Release エラー: `.lock` 削除失敗で `release-failed` と `retryable=false` を確認し、`lock:error` が最後に送出されること。

各テストは `tests/lib/locks.spec.ts` (新規) で段階的に追加する。モックタイマーと fake OPFS を活用し、副作用のない形で TTL / heartbeat を検証する。

## 7. 今後のタスクシード
1. Web Lock 実装: `navigator.locks.request` をラップし、`ProjectLockEvent` を発火するサービスを追加。
2. Fallback ファイルロック: OPFS API で `.lock` の read-modify-write を行うユーティリティを実装。
3. Heartbeat スケジューラ: `nextHeartbeatAt` を基にタイマー管理し、エラー発生時に指数バックオフを適用。
4. AutoSave 統合: `initAutoSave` 内で `ProjectLockApi` を注入し、UI へのイベント伝播を確認。

---
本ドキュメントは `feat/autosave-locks-design` ブランチの Task 3 成果物として追加。
