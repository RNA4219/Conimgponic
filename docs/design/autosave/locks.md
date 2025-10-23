# AutoSave Locks API ブループリント

`docs/IMPLEMENTATION-PLAN.md` §1.1-§1.4 と `docs/AUTOSAVE-DESIGN-IMPL.md` §2 を前提に、ロック層の API/イベント仕様・フォールバック制約・Day8 Telemetry との責務分離を集約する。

## 1. API シグネチャ

```ts
type AcquireProjectLock = (options?: AcquireProjectLockOptions) => Promise<ProjectLockLease>;
type RenewProjectLock = (lease: ProjectLockLease, options?: RenewProjectLockOptions) => Promise<ProjectLockLease>;
type ReleaseProjectLock = (lease: ProjectLockLease, options?: ReleaseProjectLockOptions) => Promise<void>;
type WithProjectLock = <T>(executor: (lease: ProjectLockLease) => Promise<T>, options?: WithProjectLockOptions) => Promise<T>;
type SubscribeLockEvents = (listener: (event: ProjectLockEvent) => void) => () => void;
```

| API | 主責務 | Retryable 判定観点 | 参照 |
| --- | --- | --- | --- |
| `acquireProjectLock` | Web Lock 優先で取得し、失敗時は指数バックオフ付きで `.lock` フォールバックを試行する。 | `lock:error` が `fallback-conflict` 等を返した場合は `retryable=false` として read-only へ降格。 | 【F:src/lib/locks.ts†L93-L214】【F:docs/IMPLEMENTATION-PLAN.md†L207-L236】 |
| `renewProjectLock` | 心拍間隔（既定 10s）で TTL を延長し、遅延時は `lock:warning(heartbeat-delayed)` を通知する。 | TTL 超過は `retryable=false` として `lock:readonly-entered` を発火。 | 【F:src/lib/locks.ts†L215-L272】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L95-L127】 |
| `releaseProjectLock` | Web Lock / フォールバック artefact を順序解放し、強制解放時でも `.lock` を削除する。 | 解放失敗は `retryable` を保持しつつ Collector へ Incident ログを送る。 | 【F:src/lib/locks.ts†L215-L272】【F:docs/IMPLEMENTATION-PLAN.md†L237-L254】 |
| `withProjectLock` | 取得→処理→解放を一括で実行し、例外時は read-only へ降格する。 | Executor 例外が `retryable=false` のときは再試行せず UI/Telemetry へ即通知。 | 【F:src/lib/locks.ts†L273-L318】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L63-L91】 |
| `projectLockEvents.subscribe` | UI・Collector・Analyzer が `lock:*` イベントを購読する唯一の窓口。解除時は Set から削除する。 | `lock:error.retryable` をそのまま配信し、判定ロジックをリスナー側で共有。 | 【F:src/lib/locks.ts†L319-L360】【F:docs/IMPLEMENTATION-PLAN.md†L255-L287】 |

## 2. イベントペイロード

| イベント | 必須フィールド | 主な発火条件 | Retryable | 連携先 |
| --- | --- | --- | --- | --- |
| `lock:attempt` | `{ strategy, retry }` | Web Lock / Renew の開始。 | `true`（残試行あり） | UI インジケータ、Collector latency 集計。 |
| `lock:waiting` | `{ retry, delayMs }` | バックオフ待機時。 | `true`（次試行予定あり） | Collector が指数バックオフを記録。 |
| `lock:fallback-engaged` | `{ lease }` | Web Lock 不可→フォールバック移行。 | `true` | UI は黄色警告、Analyzer が `fallback_rate` を監視。 |
| `lock:warning` | `{ warning, detail?, lease }` | フォールバック遅延/心拍遅延。 | 直近エラー依存（イベント自体は情報）。 | Collector が `autosave.lock.warning` を集計。 |
| `lock:acquired` | `{ lease }` | 取得成功。 | 正常（`retryable=true` 状態継続）。 | UI 状態更新、Collector 成功率算出。 |
| `lock:renew-scheduled` | `{ lease, nextHeartbeatInMs }` | 心拍予約。 | `true` | Analyzer が TTL 余裕を評価。 |
| `lock:renewed` | `{ lease }` | 心拍成功。 | `true` | Collector 心拍成功率。 |
| `lock:release-requested` | `{ lease }` | 解放開始。 | `true` | Collector が解放までの時間を測定。 |
| `lock:released` | `{ leaseId }` | 解放完了。 | 正常 | Analyzer が Readonly 復帰を確認。 |
| `lock:error` | `{ operation, error, retryable }` | Acquire/Renew/Release の失敗。 | ケース別（`retryable` フラグ参照）。 | UI バナー / Collector エラー率 / Analyzer ロールバック判定。 |
| `lock:readonly-entered` | `{ reason, lastError }` | 再試行不可 or TTL 超過。 | `false` 固定 | Collector Incident、Analyzer/PagerDuty ロールバック。 |

## 3. フォールバック要件

- フォールバック `.lock` は `project/.lock` 固定パスで、Day8 Collector/Analyzer が扱う JSONL や `workflow-cookbook/` 配下へ影響を与えない。【F:docs/IMPLEMENTATION-PLAN.md†L199-L236】
- TTL は 30 秒（Web Lock より長め）を維持し、`expiresAt` を超過したレコードは再取得で上書きする。`retryable=false` が返った場合は AutoSave を read-only へ降格して Collector へ `autosave.lock.readonly` を送信する。【F:docs/IMPLEMENTATION-PLAN.md†L224-L236】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L71-L111】
- 心拍は 10 秒間隔で `.lock` の `mtime` を更新し、遅延時は `lock:warning(heartbeat-delayed)` を通知する。遅延が TTL を越えたときは再試行せず `lock:readonly-entered` を即時発行する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L63-L111】

## 4. Day8 アーティファクト隔離策

- Collector/Analyzer の JSONL パイプライン（15 分サイクル）とは別ツリーで管理するため、`.lock` ファイルは Collector の巡回対象に含めない。違反は lint/レビューで検出し、Analyzer 側のフェーズ判定から `.lock` 直接参照を排除する。【F:docs/IMPLEMENTATION-PLAN.md†L199-L236】【F:Day8/docs/day8/design/03_architecture.md†L5-L36】
- `lock:readonly-entered` は `autosave.lock.readonly` メトリクスとして Collector → Analyzer → Reporter の 15 分 ETL に投入し、`rollback_required` 判定へ連鎖させる。Reporter のロールバック通知テンプレート（Incident-001）と整合するよう、`.lock` 操作ログは `reports/alerts/` に限定保存する。【F:docs/IMPLEMENTATION-PLAN.md†L237-L318】【F:Day8/docs/day8/design/03_architecture.md†L17-L36】

## 5. `subscribeLockEvents` 通知チャネル / テレメトリ責務

| チャネル | 代表リスナー | 主責務 | Collector 連携 | Analyzer 連携 |
| --- | --- | --- | --- | --- |
| UI (`AutoSaveIndicator`, `App.tsx`) | イベントを UI 状態へ反映し、`fallback-engaged` を黄色、`readonly-entered` を赤色で表示する。 | `lock:error.retryable` が `true` の場合は待機表示と再試行 CTA を保持。 | 該当なし（UI のみ）。 | 該当なし（UI のみ）。 |
| Telemetry Collector (`scripts/monitor/collect-metrics.ts`) | `lock:*` イベントを JSONL へエンコードし、遅延/失敗メトリクスを 15 分窓で集計する。 | `lock:attempt`/`lock:waiting` から待機時間、`lock:error`/`lock:readonly-entered` から Incident を構築。 | Analyzer が `autosave.lock.readonly` や `fallback_rate` 閾値を評価する前段。 |
| Analyzer (`monitor:score`) | Collector からの `autosave.lock.*` 指標を取り込み、`retryable=false` 連発をロールバックトリガーに変換する。 | Collector の JSONL を評価し、閾値逸脱時に `rollback_required=true` を返す。 | Slack/PagerDuty 通知を Reporter に委譲し、`retryable=false` 発生率>5% でロールバック判定。 |

UI/Telemetry とも `projectLockEvents.subscribe` が返す解除ハンドルで購読寿命を管理し、Day8 パイプラインに不要なリスナーを残さないこと。
