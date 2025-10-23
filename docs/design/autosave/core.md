# AutoSave Core Design (Phase A)

`docs/AUTOSAVE-DESIGN-IMPL.md` §0-§2 を基礎とし、Phase A のファサード API・例外ポリシー・ロールバック条件・ガード整合性を集約する。Collector/Analyzer/Reporter パイプラインとの整合は Day8 設計書（[`Day8/docs/day8/design/03_architecture.md`](../../../Day8/docs/day8/design/03_architecture.md)）に従う。

## 1. ファサード API 一覧

| API | 署名 | 主要責務 | 参照 | 補足 |
| --- | --- | --- | --- | --- |
| `initAutoSave(getStoryboard, options?)` | `(StoryboardProvider, AutoSaveOptions?) -> AutoSaveInitResult` | スケジューラ初期化・ロック制御・OPFS 書込統合。ガード条件で無効化。 | [`docs/AUTOSAVE-DESIGN-IMPL.md` §2.1](../../AUTOSAVE-DESIGN-IMPL.md#21-initautosave-io--状態遷移--例外) | 戻り値の `snapshot/flushNow/dispose` は Phase A 固定ポリシー（500ms / 2000ms / 20世代 / 50MB）を尊重する。 |
| `snapshot()` | `() -> AutoSaveStatusSnapshot` | 内部状態の即時取得。UI (`AutoSaveIndicator`) へ pull 供給。 | 同上 | `phase`, `retryCount`, `lastSuccessAt`, `lastError` を公開し Collector のテレメトリと整合。 |
| `flushNow()` | `() -> Promise<void>` | pending 書込の即時フラッシュ。 | 同上 | lock 取得→書込→GC を同期で完遂。失敗時は `AutoSaveError` をスロー。 |
| `dispose()` | `() -> void` | タイマー・監視・ロック解放。 | 同上 | 呼び出し後は `phase='disabled'` を維持し、副作用を残さない。 |
| `restorePrompt()` | `() -> RestoreMetadata | null` | 復元候補メタデータを UI に提示。 | [`docs/AUTOSAVE-DESIGN-IMPL.md` §2.2](../../AUTOSAVE-DESIGN-IMPL.md#22-restoreprompt--restorefrom-io--例外) | `index.json` 破損は `AutoSaveError('data-corrupted')`。 |
| `restoreFromCurrent()` | `() -> Promise<boolean>` | 最新世代を適用。 | 同上 | 書込失敗は `write-failed`。 |
| `restoreFrom(ts)` | `(string) -> Promise<boolean>` | 任意世代の復元。 | 同上 | 履歴欠落時は `history-overflow`。 |
| `listHistory()` | `() -> Promise<AutoSaveHistoryEntry[]>` | 履歴一覧取得。 | [`docs/AUTOSAVE-DESIGN-IMPL.md` §2.3](../../AUTOSAVE-DESIGN-IMPL.md#23-listhistory-io--シーケンス) | FIFO/容量制約を metadata に反映。 |

## 2. 例外階層とハンドリング

例外は `AutoSaveError`（`code`, `retryable`, `cause`, `context`）へ統一し、Phase A では次表のフローを維持する。

| code | retryable | UI | Collector | 主因 | エスカレーション |
| --- | --- | --- | --- | --- | --- |
| `disabled` | false | 非表示 | `debug` | フラグ/オプション無効化 | `snapshot.phase='disabled'` を維持。 |
| `lock-unavailable` | true | toast (再試行表示) | `warn` | Web Lock/フォールバック取得失敗 | バックオフ。`retryCount` を UI/Collector で共有。 |
| `write-failed` | true | toast (リトライ可) | `warn` | OPFS 書込・rename エラー | フライトをロールバックし再試行。 |
| `data-corrupted` | false | modal (復旧不可) | `error` | `index.json`/履歴破損 | `dispose()` → `disabled` フェイルセーフ。 |
| `history-overflow` | false | toast (世代削除通知) | `info` | 履歴 FIFO 超過・容量制限違反 | GC 後 `idle` へ復帰できない場合は運用通知。 |
| その他 | false | modal | `error` | 未分類 | Collector の incident を経由して Day8 Reporter がエスカレート。 |

`AutoSaveError` を継承する個別例外の追加は Phase B 以降とし、Phase A ではコードで分岐する。

## 3. ロールバック条件

| 条件 | 発火トリガー | 処理 | 復帰条件 | 関連ガード |
| --- | --- | --- | --- | --- |
| `write-failed` | `current.json`/`index.json` 書込失敗 | 最終成功世代を再読み込みし、pending バッファを保持したまま backoff。 | `ProjectLock` 再取得後の書込成功。 | `AUTOSAVE_POLICY` 固定値（500ms/2000ms）。 |
| `lock-unavailable` | Web Lock 未取得 | バックオフテーブル (`AUTOSAVE_RETRY_POLICY`) に従い再試行。 | 最大試行内で lock 成功。 | `AutoSaveIndicator` が retry バナー表示。 |
| `history-overflow` | GC で容量/世代超過解消不能 | 直近成功世代を `snapshot` へ提示し保存停止 (`phase='error'`)。 | 手動復旧→`dispose()`→`initAutoSave()`。 | 二重ガードが誤判定した場合に備え、Collector が運用通知。 |
| `data-corrupted` | 復元時の parse 失敗 | 全保存ジョブを停止し UI modal。 | 外部修復後の再初期化。 | フラグ/オプション状態を監査。 |

## 4. ガード設定との整合

| ガード | 判定源 | 期待状態 | UI 連携 | Day8 パイプライン整合 |
| --- | --- | --- | --- | --- |
| Feature flag `autosave.enabled` | Flags サービス | QA セッションのみ true | `phase='disabled'` で Indicator 非表示。 | Collector によるテレメトリ停止でレポート非活性。 |
| `AutoSaveOptions.disabled` | ランタイム設定 | 既定 false | `initAutoSave` が no-op。 | `disabled` エラーは Collector へ `debug` 出力のみ。 |
| StoryboardProvider 健全性 | `getStoryboard()` | `Storyboard` を返却 | `undefined` なら起動拒否し disabled。 | Day8 Analyzer からのフェイルバック時に incident を作成しない。 |
| Retry Policy (`AUTOSAVE_RETRY_POLICY`) | 固定テーブル | 初回 500ms, 倍率2, 最大 4s, 5 回 | UI の retry カウンタと同期。 | `lock:error` → Reporter が Why-Why 草案に記録。 |

二重ガードと Day8 ガバナンス（Collector→Analyzer→Reporter）は `initAutoSave` の `snapshot()` で公開される `phase`/`retryCount` を通じて監査され、ロールバック条件が満たされた場合でも UX を破壊しないようにする。
