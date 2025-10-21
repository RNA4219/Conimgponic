# AutoSave ファサード設計サマリ

## 1. 公開 API と保存ポリシーの整理
`src/lib/autosave.ts` は OPFS の `project/autosave` ツリーを管理し、最新スナップショット更新と履歴復元 API を提供する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L5-L18】保存フローは Web Locks を優先し `current.json`/`index.json` を常に整合させる責務を持つ。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L12-L23】

### 1.1 保存ポリシー・履歴ローテーション表
| パラメータ | 既定値 / 制約 | 主な参照元 | 運用・実装ノート |
| --- | --- | --- | --- |
| デバウンス遅延 | 500ms | 実装詳細 1) 保存ポリシー | 入力検知後 500ms 待機して保存ジョブをキューイング。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L20-L29】 |
| アイドル猶予 | 2000ms | 実装詳細 1) 保存ポリシー | デバウンス終了後 2s アイドルを待ち、ロック取得→書き込みへ遷移。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L20-L29】 |
| 最大履歴世代数 | 20 世代 | 実装詳細 1) 保存ポリシー | `history/<ISO>.json` を FIFO で保持し、溢れた分は即削除。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L20-L33】 |
| 容量上限 | 50MB | 実装詳細 1) 保存ポリシー | 超過時は古い履歴から削除し、合計サイズが閾値内になるまで継続。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L20-L33】 |
| 履歴命名規則 | ISO8601（単調増加） | 0) モジュール責務 | `index.json` に存在しないファイルは掃除対象、逆はロールバックで再構築。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L13-L18】 |
| フィーチャーフラグ | `autosave.enabled` / `options.disabled` | 0) モジュール責務 | false/true 時は永続化副作用を発生させない。`phase='disabled'` を維持。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L8-L11】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L47-L53】 |

### 1.2 公開 API シグネチャと副作用
`AutoSaveOptions` は上記ポリシー値をデフォルトとして露出し、例外は `AutoSaveError` に正規化する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L35-L70】

| 関数 | 型シグネチャ | 主な副作用 | 想定エラーコード | 備考 |
| --- | --- | --- | --- | --- |
| `initAutoSave(getStoryboard, options?)` | `(StoryboardProvider, AutoSaveOptions?) -> AutoSaveInitResult` | Web Lock/ファイルロック取得、`current.json`/`index.json` 書き込み、履歴 FIFO/容量制御 | `disabled`, `lock-unavailable`, `write-failed`, `history-overflow`, `data-corrupted` | `disabled` 判定時は no-op スケジューラとし `dispose` のみ副作用。`flushNow` は進行中フライト待機。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L37-L53】 |
| `restorePrompt()` | `() -> Promise<null | { ts, bytes, source, location }>` | `current.json`/`index.json` 読み出し | `data-corrupted` | UI への復元候補提示用。履歴メタキャッシュを返却。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L54-L60】 |
| `restoreFromCurrent()` | `() -> Promise<boolean>` | storyboard 反映（UI 状態書き換えのみ） | `data-corrupted` | 書き込み副作用は持たない。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L60-L63】 |
| `restoreFrom(ts)` | `(string) -> Promise<boolean>` | 履歴ファイル読込→UI 適用、必要に応じてロック取得 | `data-corrupted`, `lock-unavailable` | ロック取得失敗時は指数バックオフで再試行。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L63-L66】 |
| `listHistory()` | `() -> Promise<{ ts, bytes, location: 'history'; retained: boolean }[]>` | `index.json` 読み出し | `data-corrupted` | GC 後の整合性確認にも再利用。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L66-L70】 |

## 2. 先行テスト観点と `tests/` 配置計画
`node:test` を前提に、Fake タイマー・OPFS スタブ・ロックモックを活用した TDD を進める。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L87-L123】

| テーマ | 想定テストケース | 対象ファイル（案） |
| --- | --- | --- |
| フラグ OFF | `autosave.enabled=false` / `options.disabled=true` 時に `flushNow`/`dispose` が副作用なし、スナップショット `phase='disabled'` を維持 | `tests/autosave/init.spec.ts` |
| 正常保存フロー | デフォルトポリシーでデバウンス→アイドル→ロック取得→`current.json`/`index.json` 更新、`flushNow` でアイドル待機スキップ | `tests/autosave/scheduler.spec.ts` |
| 履歴ローテーション | 世代 21 到達・容量 50MB 超過時に FIFO/容量制御が実行され `history-overflow` ログが 1 行で済む | `tests/autosave/history.spec.ts` |
| 復元 API | `restorePrompt` の候補提示、`restoreFromCurrent`/`restoreFrom(ts)` の UI 反映とエラー露出 (`data-corrupted`, `lock-unavailable`) | `tests/autosave/restore.spec.ts` |
| 失敗再試行 | `lock-unavailable` 連続 4 回で指数バックオフ後 5 回目失敗時に `phase='error'` 遷移、`write-failed` の retryable/非 retryable 分岐 | `tests/autosave/scheduler.spec.ts` |

## 3. Collector/Analyzer 連携とテレメトリ出力仕様
Collector は JSONL イベントを収集し Analyzer がメトリクス化する Day8 パイプラインを構成しているため、AutoSave 側は 1 イベント 1 行と最小限の I/O に抑えつつ既存スキーマを再利用する必要がある。【F:Day8/docs/day8/design/03_architecture.md†L1-L31】

### 3.1 エラー・イベント出力ポリシー
- `AutoSaveError` は `code`, `retryable`, `context`, `feature: 'autosave'`, `duration_ms` を JSONL 1 行で出力し、Collector の既存パーサを流用する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L118-L141】
- `retryable=true` のイベントはバックオフ 1 サイクルにつき 1 行に制限し、UI ステート (`snapshot().retryCount`) で回数を追跡する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L86-L114】
- `retryable=false` の致命エラーのみ Slack 通知トリガーへ転送し、Analyzer は `code` と `cause` 要約で RCA を行う。改行や巨大 JSON を含めない。
- `history-overflow` は Collector 対象外としてローカルログに限定し、ノイズを抑制する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L120-L141】

### 3.2 テレメトリ項目
| イベント | 必須フィールド | 目的 | 備考 |
| --- | --- | --- | --- |
| `autosave.success` | `{ feature: 'autosave', duration_ms, bytes_written, generations, source: 'autosave' }` | 保存成功の P95 / 復元率算出 | `generations` は `index.json` 反映後の値を送信し Analyzer が履歴健全性を把握する。 |
| `autosave.failure` | `{ feature: 'autosave', code, retryable, duration_ms?, context? }` | 失敗種別の集計と再試行判定 | `retryable=false` では Analyzer が即時アラート。 |
| `autosave.recovered` | `{ feature: 'autosave', recovery_source: 'current' | 'history', age_ms }` | 復旧シナリオの SLA 追跡 | `age_ms` は `lastSuccessAt` との差分で計算。 |

### 3.3 Collector / Analyzer 整合チェックリスト
| 条件 | 参照元 | AutoSave 側仕様 | 想定テスト |
| --- | --- | --- | --- |
| JSONL 1 行 1 イベント | Day8 アーキテクチャ【F:Day8/docs/day8/design/03_architecture.md†L1-L18】 | `AutoSaveError` と成功ログは 1 行フォーマットを堅持 | `AUTOSAVE_ERROR_TEST_MATRIX` の `lock-unavailable` ケースでログ件数を検証 |
| Day8 パス汚染禁止 | Day8 アーキテクチャ【F:Day8/docs/day8/design/03_architecture.md†L1-L31】 | フォールバックロックは `project/.lock` のみに限定し `workflow-cookbook/logs` を触らない | 保存フロー E2E テストで `.lock` 以外のファイル生成を禁止するアサーション |
| メトリクス項目を維持 | Day8 アーキテクチャ【F:Day8/docs/day8/design/03_architecture.md†L1-L31】 | 成功/失敗イベントに `feature`, `duration_ms` を含め既存 Analyzer を再利用 | `AUTOSAVE_FLAG_TEST_MATRIX` のフラグ ON ケースで Collector へ送信されるフィールドを検証 |
| フェーズ遷移共有 | AutoSave 設計詳細【F:docs/AUTOSAVE-DESIGN-IMPL.md†L72-L141】 | `snapshot()` が `phase`, `lastSuccessAt`, `retryCount` を公開し Analyzer Pull を支援 | `tests/autosave/scheduler.spec.ts` で状態遷移と Collector メトリクスの整合を確認 |

## 4. TDD 手順と受入条件
### 4.1 TDD 手順
1. `tests/autosave/init.spec.ts` にフラグ OFF/ON 初期化シナリオを追加し、`disabled` 時の no-op を先に赤で書く。
2. `tests/autosave/scheduler.spec.ts` に Fake タイマーを用いたデバウンス・アイドル・`flushNow` の期待シーケンスを記述。
3. `tests/autosave/history.spec.ts` で履歴 FIFO・容量制約をテーブル駆動でカバーし、OPFS スタブを共通ユーティリティ化。
4. `tests/autosave/restore.spec.ts` で `restorePrompt`/`restoreFrom*` の正常/異常系を記述し、`AutoSaveError` の `retryable` 判定を検証。
5. ロックモック・テレメトリモックを導入し、Collector へのイベント数・内容を検証するテストを追加後、実装を開始する。

### 4.2 受入条件
- すべての公開 API が上記テーブルのシグネチャ・副作用・例外仕様を満たし、保存ポリシー既定値を逸脱しないこと。
- フラグ OFF 時に永続化 I/O・ロック要求を一切発生させず、`snapshot().phase` が `disabled` のままであること。
- 保存成功時に `current.json`/`index.json` が常に整合し、履歴/容量制約が FIFO で強制されること。
- Collector 連携において 1 エラー 1 行の構造化ログを維持し、Analyzer パイプラインへ余計な出力を送らないこと。
- 上記テスト計画に列挙したケースがすべて `node:test` で緑化し、TDD で段階的に実装されること。
