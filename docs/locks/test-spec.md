# Project Lock Service Test Specification

## スコープ

- `src/lib/locks.ts` の API (`acquire`, `renew`, `release`, `withProjectLock`, `projectLockEvents`)
- AutoSave 監視要件に対応するイベント伝播
- Web Locks 利用可否およびフォールバック動作

## 前提条件

- テストランナー: `pnpm test --filter locks`
- Web Locks は `navigator.locks` をスタブ化して制御
- フォールバックは OPFS モック（`loadJSON`/`saveJSON`）でシナリオ注入
- Day8 アーキテクチャ層の依存はモックし、直接呼び出し禁止

## シナリオ

### 1. Web Locks 利用可能

| ID | 条件 | 期待されるイベント | 結果 |
| --- | --- | --- | --- |
| WL-ACQ-01 | `navigator.locks.request` が即時成功 | `lock:attempt` → `lock:acquired` | `lease.strategy === 'web-lock'` |
| WL-ACQ-02 | Web Lock が `DOMException` を投げ、リトライ可能 | `lock:attempt` → `lock:error(retryable)` → `lock:waiting` | バックオフ後に次試行 |
| WL-FB-01 | Web Lock 未対応 (`request` 未定義) | `lock:error(code=web-lock-unsupported)` → `lock:waiting` → `lock:fallback-engaged` | フォールバック成功 |

### 2. Web Locks 利用不可（フォールバック専用）

| ID | 条件 | 期待されるイベント | 結果 |
| --- | --- | --- | --- |
| FB-ACQ-01 | フォールバック空き | `lock:attempt(strategy=file-lock)` → `lock:acquired` | `lease.strategy === 'file-lock'` |
| FB-ACQ-02 | 既存レコードが有効 TTL 内 | `lock:warning(warning=fallback-degraded)` → `lock:error(retryable)` → `lock:waiting` | 既存 lease が維持される |
| FB-ACQ-03 | リトライ上限到達 | 上記イベント後、`lock:readonly-entered` | 閲覧専用へ降格 |

### 3. ハートビートと更新

| ID | 条件 | 期待されるイベント | 結果 |
| --- | --- | --- | --- |
| RN-HB-01 | `renewProjectLock` 成功 | `lock:renew-scheduled` → `lock:renewed` | `renewAttempt` 増加 |
| RN-HB-02 | 実行時刻が `nextHeartbeatAt` を超過 | `lock:renew-scheduled` → `lock:warning(heartbeat-delayed)` → `lock:renewed` | 遅延検知ログ |
| RN-HB-03 | フォールバックレコード不一致 | `lock:renew-scheduled` → `lock:error(retryable=false)` → `lock:readonly-entered(reason=renew-failed)` | 閲覧専用 |

### 4. 解除

| ID | 条件 | 期待されるイベント | 結果 |
| --- | --- | --- | --- |
| RL-REL-01 | 正常解除 | `lock:release-requested` → `lock:released` | Web Lock `release` 呼び出し |
| RL-REL-02 | `release` で例外 | `lock:release-requested` → `lock:error` → `lock:readonly-entered(reason=release-failed)` | 強制降格 |

## 監査・メトリクス検証

- `lock:fallback-engaged` がフォールバック利用率指標に記録されること
- `lock:warning` の `detail` が監視ログへ出力されること
- `ProjectLockReadonlyReason` に基づき UI 表示が切り替わること（モックで確認）

## 非機能

- 取得から初回ハートビートまでの遅延は 5% 以内に収まることを計測（タイマー精度を考慮して許容差 50ms）
- 再試行ウィンドウ終了後は必ず `lock:readonly-entered` が 1 度だけ発火すること

## フェンス条件

- Day8 領域への API 呼び出しは禁止（AutoSave ファサード経由のみ）
- `.env` や機密情報をテストで使用しない
