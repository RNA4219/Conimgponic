# AutoSave 永続化/復元パイプライン設計メモ

## 1. 保存スケジューラシーケンス
1. **入力イベント受信**: `initAutoSave` が `StoryboardProvider` からの変更通知を購読し、UI スレッドで検出したイベントをスケジューラに渡す。
2. **デバウンス待機**: 500ms (`debounceMs`) のデバウンスウィンドウ内で追加入力を集約。新規入力が来なければジョブキューイングへ進む。
3. **アイドル検証**: さらに 2s (`idleMs`) のアイドル猶予を監視し、未完了の UI タスクがなければ保存ジョブを起動。ここまでの `phase` は `debouncing` → `awaiting-lock` に遷移。
4. **排他制御**: `src/lib/locks.ts` の `acquireProjectLock` を介して Web Locks (`navigator.locks`) を優先取得。未対応ブラウザや競合時は同一 UUID/TTL を持つ `project/.lock` フォールバックを取得する。
5. **スナップショット書込**: ロックを保持したまま OPFS (`project/autosave/current.json.tmp`) に最新 `Storyboard` スナップショットを書き込み、`writeCurrentSnapshot` ヘルパーで `fsync` 後に `current.json` へ原子的リネーム。
6. **インデックス更新と履歴 GC**: `updateIndexWithRotation` が `index.json.tmp` に最新メタデータを生成し、`history/<ISO>.json` へローテーション。`maxGenerations` と `maxBytes` を超過した世代を FIFO で削除。
7. **ロック解放**: 正常完了または再試行不能なエラー時に `releaseProjectLock` を呼び、フォールバックファイルも削除。再試行が必要な場合は指数バックオフ (0.5→1→2→4s) で手順 4 から再開。
8. **状態更新**: `snapshot()` 用の内部ステートを `phase='idle'` と `lastSuccessAt` で更新し、UI (`AutoSaveIndicator`) とテレメトリへ通知。

## 2. 復元手順シーケンス
1. **復元候補提示**: `restorePrompt` が `current.json` と `index.json` を検査し、最も新しい有効世代のメタデータ (`ts`, `bytes`, `source`) を返却。整合不一致の場合は `history` と `index` を突き合わせて孤児を削除し、破損検知時は `AutoSaveError{ code: 'data-corrupted', retryable: false }` をログして `null` を返す。
2. **即時復元 (`restoreFromCurrent`)**: `current.json` の読み込みに成功した場合はアプリケーション状態へ反映し、成功時は `true` を返却。失敗時は `AutoSaveError` をスローせず `false` を返し、UI に再試行可否を通知。
3. **世代指定復元 (`restoreFrom`)**: 引数 `ts` で指定された `history/<ts>.json` を読み込み、成功時に `true`。見つからない・破損時は `data-corrupted` をログし、`false` を返す。復元完了後は `current.json` と `index.json` を再同期し、未参照の履歴ファイルを GC。
4. **整合性再構築**: 復元 API のいずれかがゴーストエントリを検知した場合、`reconcileIndex` が最新スナップショットを基準に `index.json` を再生成し、`history` から欠落ファイルを削除して整合性を回復。

## 3. `src/lib/autosave.ts` API 責務分割
| API | 主責務 | 主要副作用/協働モジュール |
| --- | --- | --- |
| `initAutoSave(getStoryboard, options?)` | 保存スケジューラ初期化。イベント購読・タイマー・ロック制御・OPFS 書込・GC を統合し、`snapshot`/`flushNow`/`dispose` を提供。`options.disabled` または `autosave.enabled=false` 時は no-op。 | `locks.ts`（ロック取得/更新）、OPFS ライター、UI インジケータ、Collector 連携 |
| `restorePrompt()` | 復元候補の探索と提示。`current.json`/`index.json` の整合性チェックと孤児掃除を担当。 | OPFS リーダー、`AutoSaveError` ログ |
| `restoreFromCurrent()` | 最新スナップショットの適用と整合性再同期。成功可否を boolean で返却。 | OPFS リーダー、アプリケーション状態リストアフック |
| `restoreFrom(ts)` | 指定世代復元。履歴ローテーションとの整合維持。 | OPFS リーダー/GC |
| `listHistory()` | `index.json` ベースで履歴メタデータ一覧を返却。`maxGenerations` を尊重しつつ UI/CLI に提供。 | OPFS リーダー |
| `snapshot()` (戻り値メソッド) | 現在の AutoSave 状態を取得し、`AutoSaveIndicator` がフェーズ表示・エラーハンドリングに利用。 | 内部ステート、UI |
| `flushNow()` (戻り値メソッド) | デバウンス/アイドル待機をスキップし即時保存。進行中ジョブ完了まで待機。 | スケジューラ、ロック、OPFS |
| `dispose()` (戻り値メソッド) | イベント購読解除、タイマー停止、ロック解放、ステート遷移 (`phase='disabled'`) を実施。 | スケジューラ、ロック |

### 3.1 OPFS 連携方針
- 永続化対象は `project/autosave/` 配下に限定し、Collector/Analyzer のワークスペース (`workflow-cookbook/`, `logs/` など) には触れない。
- 書込は常に `*.tmp` → リネームの原子操作で行い、例外時は tmp ファイルを削除。`current.json` 更新後に `index.json` を更新する順序を崩さない。
- ロック獲得前に OPFS へ書き込まず、同一タブの再入防止に UUID を共有。ロック心拍は `renewProjectLock` を利用して 30s TTL を維持。
- `maxBytes` 超過時は FIFO で世代を削除し、削除イベントは Collector の計測へ 1 行警告として送信して SLO 監視と連携する。

## 4. 関連仕様へのトレーサビリティ
- 保存パラメータとフェーズ遷移は [docs/AUTOSAVE-DESIGN-IMPL.md](./AUTOSAVE-DESIGN-IMPL.md) §1.1, §4 に準拠。
- モジュール構成とロック取得責務は [docs/IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) §1, §0.3 を踏襲。
- Collector/Analyzer 連携および非干渉要件は [Day8/docs/day8/design/03_architecture.md](../Day8/docs/day8/design/03_architecture.md) を参照。
