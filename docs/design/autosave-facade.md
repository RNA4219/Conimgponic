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

## 3. Collector/テレメトリ制約を踏まえた例外設計
Collector は CI ログを JSONL 形式で蓄積し Analyzer がメトリクス算出に用いるため、AutoSave の例外ログは 1 行・構造化・最小限に抑える必要がある。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L18-L19】【F:Day8/docs/day8/design/03_architecture.md†L1-L18】

- `AutoSaveError` は `code`, `retryable`, `context` を必須で構造化し、Collector 側のパーサが追加変換なく ingest できる JSONL を出力する。
- `retryable=true` のイベントは同一バックオフサイクルで再送しない。失敗回数は UI ステート (`snapshot().retryCount`) にのみ反映させ、Collector には 1 行だけ通知する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L98-L117】
- `retryable=false` の致命エラーでは UI 通知と同時に Collector へ重要度高イベントを送信し、Analyzer が根本原因分析に利用できるよう `cause` 要約を含める。JSONL 破壊を防ぐため、改行は含めず安全なサマリへ整形する。
- `history-overflow` は情報レベルで Collector 連携対象外とし、ローカルログのみ（1 行）へ出力することでノイズを抑制する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L120-L141】

### 3.1 再試行・通知ポリシー表
`src/lib/autosave.ts` の `AUTOSAVE_FAILURE_PLAN` を基準に、Collector/Analyzer 連携と再試行制御を下表へ集約する。【F:src/lib/autosave.ts†L21-L74】

| エラーコード | `retryable` | 再試行ポリシー | Collector 通知 | Analyzer 取り込み | 備考 |
| --- | --- | --- | --- | --- | --- |
| `disabled` | false | スケジューラ起動前に停止（no-op） | ログ送信なし。UI は `phase='disabled'` を維持。 | 影響なし。 | フラグ OFF 時の no-op 要件を保証。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L47-L55】 |
| `lock-unavailable` | true | 指数バックオフで最大リース時間以内に再試行。 | 1 サイクルにつき 1 行の警告を Collector へ送信。 | Analyzer はバックオフ回数と `retryCount` でフェーズ遷移を追跡。 | ロック取得が継続失敗した場合のみ UI へ警告。 |
| `write-failed` | true | IO エラーは指数バックオフ、復旧後は直近失敗回数をリセット。 | 1 行の警告ログ。`context` に書込バイト数を含める。 | Analyzer が保存遅延を計測する入力とする。 | 連続失敗で `phase='error'` 遷移。 |
| `data-corrupted` | false | 即時停止、ユーザ通知。 | Collector へ高優先度エラーを 1 行送信。 | Analyzer は復元失敗率指標に計上。 | ログには `cause` 要約を含める。 |
| `history-overflow` | false | FIFO GC 実行後に停止（保存継続はしない）。 | Collector 対象外、ローカル情報ログのみ。 | Analyzer へは影響なし。 | 容量超過時は GC 後に UI を保持。 |

### 3.2 Collector / Analyzer 連携条件チェックリスト
| 条件 | 参照元 | AutoSave 側仕様 | 想定テスト |
| --- | --- | --- | --- |
| JSONL 1 行 1 イベント | Day8 アーキテクチャ【F:Day8/docs/day8/design/03_architecture.md†L1-L18】 | `AutoSaveError` は `AUTOSAVE_FAILURE_PLAN` の `summary` に沿って Collector 送信を単一行に制限 | `AUTOSAVE_ERROR_TEST_MATRIX` の `lock-unavailable` ケースでログ件数を検証 |
| Analyzer が扱うディレクトリを汚染しない | Day8 アーキテクチャ【F:Day8/docs/day8/design/03_architecture.md†L1-L31】 | ロックフォールバックは `project/.lock` のみに書き込み、`workflow-cookbook/logs` など Day8 パスへ書き込まない | 保存フロー E2E テストで `.lock` 以外のファイル生成を禁止するアサーション |
| メトリクス算出用フィールド維持 | Day8 アーキテクチャ【F:Day8/docs/day8/design/03_architecture.md†L1-L31】 | 保存成功/失敗イベントに `feature: 'autosave'` と `duration_ms` を付帯し既存スキーマを再利用 | `AUTOSAVE_FLAG_TEST_MATRIX` のフラグ ON ケースで Collector へ送信されるフィールドを検証 |
| フェーズ遷移情報を Analyzer へ共有 | AutoSave 設計詳細【F:docs/AUTOSAVE-DESIGN-IMPL.md†L72-L93】 | `snapshot()` が `phase`, `lastSuccessAt`, `retryCount` を公開し、Analyzer は必要に応じて Pull する | `tests/autosave/scheduler.spec.ts` で状態遷移と Collector メトリクスの整合を確認 |

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
