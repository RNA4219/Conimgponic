# AutoSave コアファサード設計

参照: [docs/AUTOSAVE-DESIGN-IMPL.md](./AUTOSAVE-DESIGN-IMPL.md), [Day8/docs/day8/design/03_architecture.md](../Day8/docs/day8/design/03_architecture.md)

## 1. 目的と範囲
- `src/lib/autosave.ts` の `initAutoSave` および復元 API 群の内部状態・副作用・エラーハンドリングを定義する。
- 対象: ステータスフェーズ管理、履歴ローテーション、OPFS I/O、feature flag 無効時の no-op。
- 非対象: 実際の OPFS 実装、UI 連携、ロック API (`src/lib/locks.ts`) の細部。

## 2. コンテキスト
- AutoSave は Collector→Analyzer→Reporter パイプラインと疎結合である必要があり、ログ出力は 1 エラー 1 行を維持する（Day8 アーキテクチャ整合）。
- 保存ポリシー（デバウンス 500ms、アイドル 2s、履歴 20 世代、容量 50MB）は `AUTOSAVE_DEFAULTS` で公開する。
- `autosave.enabled=false` または `AutoSaveOptions.disabled=true` の場合は永続化副作用を一切発生させない。

### 2.1 保存ポリシーとランタイムシーケンスの差異
- **保存ポリシー**: `AutoSaveOptions` で露出する閾値群。`debounceMs`/`idleMs` は入力頻度制御、`maxGenerations`/`maxBytes` は履歴管理の上限、`disabled` は機能全体を抑止する静的条件。値は `docs/AUTOSAVE-DESIGN-IMPL.md` の §1 を正とし、外部 UI からの変更はこのインターフェース経由に限定する。
- **ランタイムシーケンス**: スケジューラがイベントを受けて実行するフェーズ遷移。ポリシー値を参照するが、状態は `phase` とタイマー/ロック/書込 I/O の進行度で決定される。シーケンスは同ドキュメント §2 と整合させ、Collector/Analyzer への副作用を隔離する。
- **整合要件**: ポリシー変更（例: `debounceMs` 短縮）はシーケンス内のタイマー初期化ロジックに限定して影響させ、履歴 GC や UI 通知の契約は不変。これにより Day8 アーキテクチャ図の責務境界を保持する。

## 3. API 設計
### 3.1 initAutoSave
```ts
export function initAutoSave(
  getStoryboard: StoryboardProvider,
  options?: AutoSaveOptions
): AutoSaveInitResult
```
#### シーケンス
1. `resolveOptions`: `AUTOSAVE_DEFAULTS` と `options` をマージし、`featureFlag`（設定値）を確認。
2. Flag 判定: `autosave.enabled=false` または `opts.disabled=true` → `phase='disabled'` の `snapshot()` と no-op な `flushNow`/`dispose` を返す。
3. `phase='idle'` を初期化し、`snapshot()` クロージャに共有ステートを閉じ込める。
4. `scheduleDebounce(changeEvent)`: 500ms デバウンス後に `idleTimer` を起動。
5. `idleTimer` 完了 (2s) → `requestLock()` を実行。
6. `requestLock()`:
   - Web Lock 優先。失敗時はフォールバックロックを同一 UUID で試行。
   - 連続失敗時は `retryCount` を更新し `phase='awaiting-lock'` → バックオフ 0.5→1→2→4s（最大 4s）。5 回失敗で `phase='error'`、`flushNow` は no-op。
7. ロック取得成功 → `phase='writing-current'`。`current.json.tmp` へ書き込み → rename → `phase='updating-index'`。
8. `index.json` を更新し、`history/<ISO>.json` を追記。`phase='gc'` で履歴ローテーション (`maxGenerations`) と容量ガード (`maxBytes`) を適用。
9. GC 完了後 `lastSuccessAt` と `retryCount` をリセットし `phase='idle'`。
10. エラー発生時は `AutoSaveError` を生成し `lastError` に保持。`retryable=true` ならバックオフ再試行、`false` なら `phase='error'` を維持し `flushNow` を no-op。

#### flushNow
- `phase` が `debouncing`/`idle` の場合、デバウンスとアイドルタイマーを即時完了させロック取得に進む。
- 進行中フライト (`awaiting-lock` 以降) がある場合はその完了を待機し、重複実行を防ぐ。

#### dispose
1. 変更購読解除、タイマー停止。
2. 進行中フライトを待機し、保持ロックを解放。
3. `phase='disabled'`、`snapshot()` は最後の `lastError`/`lastSuccessAt` を保持。

### 3.2 復元 API 群
- `restorePrompt`: `current.json`/`index.json` を読み込み、最新世代と容量情報を返す。データ破損時は `AutoSaveError{code:'data-corrupted', retryable:false}`。
- `restoreFromCurrent`: `current.json` をデシリアライズ。検証失敗は `data-corrupted`。成功時は UI 呼び出し元が反映。
- `restoreFrom(ts)`: `history/<ts>.json` を読み込み、`withProjectLock` で衝突を防ぐ。ロック不可は `lock-unavailable` (retryable=true) で呼び出し元再試行。データ破損は `data-corrupted`。
- `listHistory`: `index.json` を降順で返却。整合性不一致（孤児/ゴースト）は整備しつつ `history-overflow` を情報ログで記録。

### 3.3 状態管理
共通ステート:
- `phase: AutoSavePhase`
- `retryCount: number`
- `pendingBytes?: number`（直近書き込み予定サイズ）
- `queuedGeneration?: number`（`index.json` 上の次世代番号）
- `lastSuccessAt?: string`
- `lastError?: AutoSaveError`

`phase` 遷移は §4 を参照。

### 3.4 例外契約
| コード | トリガー条件 | retryable | 呼び出し側への伝達 | 後続アクション |
| --- | --- | --- | --- | --- |
| `disabled` | `autosave.enabled=false` または `options.disabled=true` | false | `initAutoSave` が no-op ハンドラを返し、例外はスローしない | `snapshot().phase='disabled'` を維持 |
| `lock-unavailable` | Web Lock/Fallback いずれも取得不可 | true | `AutoSaveError` を `lastError` に保持し UI へ通知 | バックオフ 0.5→1→2→4s、5 回連続で `phase='error'` |
| `write-failed` | `current.json` 書込/リネーム失敗または `index.json` 更新失敗 | cause が `NotAllowedError` 以外なら true | 呼び出し元へ例外、UI Snackbar | `.tmp` 巻き戻し後にリトライ、非再試行なら `phase='error'` |
| `data-corrupted` | `current.json`/`history/*.json`/`index.json` の JSON 解析失敗 | false | 復元 API が null/false を返し UI ダイアログを促す | `snapshot().phase` は変えず `lastError` 更新 |
| `history-overflow` | GC で容量/世代上限を超過し削除実施 | false | 例外送出なし。ログのみ | `lastSuccessAt` 更新し `phase='idle'` |

## 4. 状態遷移図
```mermaid
stateDiagram-v2
    [*] --> Disabled: feature flag / options.disabled
    Disabled --> Idle: initAutoSave()
    Idle --> Debouncing: storyboard change detected
    Debouncing --> Idle: flush before debounce deadline
    Debouncing --> AwaitingLock: debounce + idle satisfied
    AwaitingLock --> WritingCurrent: lock acquired
    AwaitingLock --> Debouncing: backoff retry scheduled
    AwaitingLock --> Error: retries exhausted (max 5)
    WritingCurrent --> UpdatingIndex: atomic rename success
    WritingCurrent --> Error: write failure (non-retryable)
    UpdatingIndex --> GC: index committed
    UpdatingIndex --> Error: index write fatal
    GC --> Idle: rotation/eviction complete
    Error --> Idle: retryable error recovered
    Idle --> Disabled: dispose()
```

### 4.1 フェーズ別ガードと副作用
| フェーズ | 遷移条件 | 副作用 | UI スナップショット |
| --- | --- | --- | --- |
| `disabled` | init 時に機能無効／dispose 後 | 永続化処理を実行せず、`flushNow`/`dispose` は no-op | `phase='disabled'`, `retryCount=0` |
| `idle` | 保存完了/起動直後 | タイマー待機のみ。`lastSuccessAt` 更新済 | `lastError` クリア、`pendingBytes` 未設定 |
| `debouncing` | 入力イベント受信 | デバウンスタイマー登録 | `pendingBytes` に暫定サイズを設定 |
| `awaiting-lock` | タイマー満了後 | ロック取得試行、`retryCount` 増分 | UI はローディング表示（Indicator） |
| `writing-current` | ロック取得成功 | `current.json.tmp` 書き込み、失敗時ロールバック | UI は "saving" バナー |
| `updating-index` | カレント書込完了 | `index.json.tmp` 更新、`queuedGeneration` インクリメント | UI は保存中継続 |
| `gc` | index 更新後 | 世代/容量 GC。削除内容をログ | UI は保存完了待機 |
| `error` | 再試行上限 or 非再試行エラー | `flushNow` を no-op。`lastError` を保持 | UI は ReadOnly 表示 |

## 5. エラーハンドリング
| フェーズ | 例外コード | retryable | バックオフ | ハンドラ |
| --- | --- | --- | --- | --- |
| AwaitingLock | lock-unavailable | true | 0.5 → 1 → 2 → 4s (上限 4s) | `phase='awaiting-lock'` 維持、5 回失敗で `phase='error'` |
| WritingCurrent | write-failed | cause 判定 | 成功時 0.5 → 1 → 2 → 4s | `.tmp` 削除後にリトライ、非再試行エラーで停止 |
| UpdatingIndex | write-failed | cause 判定 | 同上 | `index.json` ロールバック後リトライ |
| GC | history-overflow | false | なし | FIFO/容量削除完了後 `phase` は `idle` |
| Restore 系 | data-corrupted | false | なし | 呼び出し側に例外伝搬、ログ 1 行 |
| Disabled 判定 | disabled | false | なし | `snapshot().phase='disabled'`、副作用なし |

## 6. データフローと I/O
```mermaid
sequenceDiagram
  participant Editor
  participant Scheduler
  participant Lock
  participant Writer
  participant GC

  Editor->>Scheduler: change event
  Scheduler->>Scheduler: debounce(500ms)
  Scheduler->>Scheduler: idle(2000ms)
  Scheduler->>Lock: request project lock
  alt lock granted
    Lock-->>Scheduler: lease handle
  else retry
    Scheduler->>Scheduler: backoff up to 4s
  end
  Scheduler->>Writer: write current.json.tmp
  Writer->>Writer: commit rename -> current.json
  Scheduler->>GC: update index.json.tmp
  GC->>GC: rotate history & enforce maxBytes
  Lock-->>Scheduler: release
```

## 7. テストシナリオ
| ID | シナリオ | 期待結果 | 種別 | 依存 |
| --- | --- | --- | --- | --- |
| T1 | フラグ無効で `initAutoSave` | `phase='disabled'`、`flushNow`/`dispose` が副作用なし | ユニット | Flag モック |
| T2 | デバウンス 500ms + アイドル 2s 後に保存 | `current.json`/`index.json` が更新され `phase='idle'` | ユニット | Fake Timer, OPFS スタブ |
| T3 | `flushNow` 呼び出し | アイドル待機をスキップし書込完了まで待機 | ユニット | Fake Timer |
| T4 | ロック取得失敗リトライ | バックオフ 0.5→1→2→4s、5 回目で `phase='error'` | ユニット | Lock モック |
| T5 | 履歴 21 世代 | 最古を削除し 20 件に保つ | 統合 | OPFS スタブ |
| T6 | 容量 50MB 超過 | 古い順に削除し総容量 < 50MB | 統合 | OPFS スタブ |
| T7 | `write-failed` 後復帰 | 成功後 `lastSuccessAt` 更新、`retryCount` リセット | 統合 | Writer スタブ |
| T8 | `data-corrupted` 復元 | 例外送出、`restorePrompt` は null | ユニット | OPFS スタブ |
| T9 | `dispose()` 中の進行中フライト | フライト完了待機後ロック解放 | ユニット | Lock モック |

### 7.1 優先テストケース（実装着手順）
1. **T1**: フラグ無効パスの no-op（保存ポリシー遵守の基礎）。
2. **T2**: デバウンス + アイドル後の保存（標準シーケンス整合）。
3. **T3**: `flushNow` バイパス（UI 手動保存との契約）。
4. **T4**: ロック再試行上限（再試行/停止条件の境界）。
5. **T7**: 書込失敗からの復帰（例外契約の確認）。
6. **T5/T6**: GC 関連（容量・世代制御）。
7. **T8**: 復元失敗ハンドリング（`data-corrupted` 伝搬）。
8. **T9**: Dispose 待機（ロック解放保証）。

### 受入テスト観点
- `flushNow` パス
- 履歴上限 20 世代維持
- 容量 50MB 超過時の削除

## 8. 状態スナップショットと UI 連携
- `snapshot()` は UI の AutoSaveIndicator が 250ms 間隔でポーリングし、`phase` と `lastError` を描画に利用する。`phase='error'` の場合は Day8 アーキテクチャで定義された ReadOnly モードへ遷移し、Collector へのログを 1 行送信する。
- `phase` が `awaiting-lock` 以上のとき、UI はボタンを `aria-busy` 状態にし、`pendingBytes` が存在すればプログレスバーを表示する。`retryCount` が 1 以上のときは ToolTip にバックオフ秒数を提示する。
- `dispose()` 完了後は `phase='disabled'` となり、Indicator は非表示。UI 側は `autosave.enabled` の設定を読み込み、再度 `initAutoSave` を実行するまでイベントを購読しない。

## 9. ログ・メトリクス
- 1 エラー 1 行の JSONL ログ（Collector 互換）。`context` へ `phase`/`retryCount` を添付。
- GC による削除は情報ログのみ。Analyzer の閾値に影響させない。

## 10. 今後の実装指針
1. テストダブル整備 (`tests/autosave/test-utils.ts` に FakeTimer/OPFS/Lock)。
2. T1/T2/T3 を満たす単体テストを先に実装（TDD）。
3. スケジューラ実装後に GC/復元の統合テスト (T5/T6/T8)。
4. UI 連携は別タスクで Provider 層を実装。
