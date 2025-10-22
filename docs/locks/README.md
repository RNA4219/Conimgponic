# Project Lock Service Design

## 概要

`src/lib/locks.ts` で提供するプロジェクトロックサービスは Web Locks API を優先的に使用し、利用不可または競合検出時には OPFS 上のフォールバックロックファイルに自動で切り替わります。AutoSave と監査要件に合わせ、ロック状態は `ProjectLockEvent` ストリームで通知され、購読者は閲覧専用モードへの降格や警告表示を同報できます。

- 取得 API: `acquireProjectLock(options)`
- 更新 API: `renewProjectLock(lease, options)`
- 解除 API: `releaseProjectLock(lease, options)`
- 高水準 API: `withProjectLock(executor, options)`

すべての API は非同期で、`AbortSignal` によるキャンセルとリトライ戦略（初期待機 500ms, 係数 2, 最大 3 試行）を備えています。戻り値は `ProjectLockLease` で、AutoSave のハートビートスケジューリングと監査ログに必要な TTL, 取得時刻, 再試行回数を保持します。

## フロー

```mermaid
flowchart TD
  start([AutoSave 起動]) --> request{navigator.locks 利用可?}
  request -- yes --> acquireWeb[Web Lock 取得]
  acquireWeb -- success --> acquired[ロック確立]
  acquireWeb -- 失敗/拒否 --> fallback
  request -- no --> fallback[フォールバック file-lock 取得]
  fallback -- success --> acquired
  fallback -- 競合検出 --> readonly[lock:readonly-entered]
  acquired --> heartbeat[LOCK_HEARTBEAT_INTERVAL_MS 毎に renew]
  heartbeat --> renewOK{renew 成功?}
  renewOK -- yes --> acquired
  renewOK -- no --> readonly
  acquired --> release[ユーザ操作 or 終了で release]
  release --> end([AutoSave 完了])
```

## 競合ハンドリング

| シナリオ | 主要イベント | フォールバック処理 | 最終状態 |
| --- | --- | --- | --- |
| Web Lock 成功 | `lock:acquired` | - | 書き込み可 |
| Web Lock API 未対応 | `lock:error` (`code=web-lock-unsupported`) → `lock:waiting` | フォールバックへ遷移 | 再取得試行 |
| フォールバック競合 | `lock:warning` (`warning=fallback-degraded`) → `lock:error` | 既存レコード保持、バックオフ待機 | リトライまたは閲覧専用 |
| リトライ上限到達 | `lock:error` → `lock:readonly-entered` | `onReadonly` コールバック発火 | 閲覧専用 |
| ハートビート遅延 | `lock:warning` (`warning=heartbeat-delayed`) | 次回 renew で TTL 再延長 | 監視アラート |
| 強制解除 | `lock:release-requested` → `lock:released` | フォールバックファイル削除 | Idle 復帰 |

`lock:error` は必ず `retryable` フラグを添付し、AutoSave 側で再試行ポリシーを判断できます。`lock:readonly-entered` では `ProjectLockError` を添えて UI が閲覧専用モードに降格します。

## I/O コントラクト

- 入力 (`AcquireProjectLockOptions`)
  - `ttlMs`, `heartbeatIntervalMs`, `preferredStrategy`, `backoff`, `signal`, `onReadonly`
- 出力
  - `ProjectLockLease`
  - `ProjectLockEventTarget` 経由のイベントストリーム

イベント種別は AutoSave/監視要件と整合させています。`lock:warning` は監視に利用され、`lock:fallback-engaged` はフォールバック利用率の計測に使用します。

## Day8 アーキテクチャ境界

Day8 アーキテクチャ領域からは `ProjectLockApi` への直接依存を禁止し、AutoSave ファサードを介したイベント購読のみを許可します。`src/lib/locks.ts` が OPFS の直接操作を担い、他層からのフォールバックファイル操作は行わないことで責務を限定します。

## 監査・閲覧専用モード

- `ProjectLockReadonlyReason` で降格理由を分類し、UI/監査ログへ伝播。
- 降格時 `onReadonly` コールバックが発火し、AutoSave は書き込み処理を即座に停止。
- `ProjectLockWarningKind` を活用し、フォールバック過多やハートビート遅延を監査チャンネルへ送信。

## 参考

- TTL/ハートビート既定値: `WEB_LOCK_TTL_MS=25s`, `FALLBACK_LOCK_TTL_MS=30s`, `LOCK_HEARTBEAT_INTERVAL_MS=10s`
- テストケース一覧: [`docs/locks/test-spec.md`](./test-spec.md)
- 旧仕様: `docs/locks-fallback-design.md`
