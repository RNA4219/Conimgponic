# AutoSave ファサード設計サマリ

## 1. 想定機能と保存ポリシー
`src/lib/autosave.ts` は AutoSave ファサードとして OPFS 上の `project/autosave` ツリーを管理し、最新スナップショット更新と履歴復元 API を提供する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L5-L18】保存フローは Web Locks を優先し、`current.json`/`index.json` の整合性維持とロールバックに責務を持つ。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L12-L23】

### 保存ポリシー・履歴ローテーション要約
| 管理項目 | 既定値 / 上限 | 根拠 | 運用メモ |
| --- | --- | --- | --- |
| デバウンス遅延 | 500ms | 実装詳細 1) 保存ポリシー | 入力検知後 500ms 待機して保存ジョブ登録。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L20-L29】 |
| アイドル猶予 | 2s | 実装詳細 1) 保存ポリシー | デバウンス満了後 2s アイドルを待ち OPFS 書き込み。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L20-L29】 |
| 最大履歴世代数 | 20 世代 | 実装詳細 1) 保存ポリシー | `history/<ISO>.json` を FIFO でローテーション。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L20-L33】 |
| 容量上限 | 50MB | 実装詳細 1) 保存ポリシー | 超過時は古い世代から削除。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L20-L33】 |
| 履歴命名規則 | ISO8601 (単調増加) | 0) モジュール責務 | `index.json` と不整合な項目は掃除/再構築対象。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L13-L18】 |
| フィーチャーフラグ | `autosave.enabled` | 0) モジュール責務 | false 時は永続化を一切行わない。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L8-L11】 |

## 2. 公開 API シグネチャと副作用
`AutoSaveOptions` は保存ポリシー値をデフォルトに持ち、`disabled` が `true` もしくはフラグ OFF の場合、`initAutoSave` は副作用を発生させずに `dispose` のみを返す。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L35-L63】

| 関数 | 型シグネチャ | 主な副作用 | 例外 | 備考 |
| --- | --- | --- | --- | --- |
| `initAutoSave(getStoryboard, options?)` | `StoryboardProvider -> AutoSaveInitResult` | Web Lock/ファイルロック取得、`current.json`/`index.json` 書き込み、履歴ローテーション | `AutoSaveError` (`lock-unavailable`, `write-failed`, `data-corrupted`) | `dispose()` はイベント解除のみの副作用。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L37-L53】 |
| `restorePrompt()` | `Promise<null | { ts, bytes, source, location }>` | OPFS 読み出し | `data-corrupted` | 復元候補を UI に提示。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L54-L60】 |
| `restoreFromCurrent()` | `Promise<boolean>` | storyboard 適用（UI 更新） | `data-corrupted` | 書き込みなし。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L60-L63】 |
| `restoreFrom(ts)` | `Promise<boolean>` | 指定履歴をロードし UI へ適用 | `data-corrupted`, `lock-unavailable` | ロック競合時は再試行対象。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L63-L66】 |
| `listHistory()` | `Promise<{ ts, bytes, location, retained }[]>` | `index.json` 読み出し | `data-corrupted` | UI 履歴リスト更新用。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L66-L70】 |

## 3. TDD で先行準備するユニットテスト観点
- **フラグ OFF シナリオ**: `autosave.enabled=false` または `options.disabled=true` の場合に永続化呼び出しやロック要求が発生しないこと。`dispose` の副作用がイベント解除のみであることを検証する。
- **フラグ ON 正常系**: デフォルトポリシーでデバウンス→アイドル→ロック取得→`current.json`/`index.json` 書き込み→履歴 FIFO 処理が順序通り呼ばれること。容量超過時の FIFO 削除も含む。
- **復元 API**: `restorePrompt` が最新/履歴を識別し、`restoreFromCurrent`・`restoreFrom(ts)` が storyboard 適用を実行すること。ロック要求が必要なケース（履歴読み込み）では取得失敗時のリトライや `lock-unavailable` エラー露出を検証する。
- **失敗ケース**: 書き込み失敗 (`write-failed`)、データ破損 (`data-corrupted`)、ロック取得不可 (`lock-unavailable`) をモックし、`retryable` フラグに応じた再スケジュールや停止判定を確認する。指数バックオフ初期値（0.5s）と最大試行（3 回）もチェック対象。
- **ガーベジコレクション**: 世代超過および 50MB 超過時の古い履歴削除順序と `index.json` 再構築処理を検証する。

## 4. 例外ハンドリングと Collector 連携上の制約
AutoSave は Collector/Analyzer パイプラインへ不要な副作用を与えず、1 エラーにつき 1 行の警告ログに抑制する設計である。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L18-L19】Collector は CI ログを JSONL で収集し Analyzer がメトリクス計算に利用するため、ログスパムや非構造化出力は避ける必要がある。【F:Day8/docs/day8/design/03_architecture.md†L1-L18】

### テレメトリ出力方針
- ログ出力は警告レベルで 1 行に限定し、Collector の JSONL 形式へ影響しないよう構造化（`code`, `retryable`, `bytesAttempted?` など）を維持する。
- `retryable=true` の例外は指数バックオフで再スケジュールしつつ、Collector には単一イベントのみ送信する。連続失敗時でもログ行数を抑制する。
- `retryable=false` の例外では UI 通知と同時に Collector へ重要度の高いイベントを送出し、Analyzer が Why-Why 分析の入力として扱えるよう `code` と `cause` サマリを添付する。

## 5. テスト計画（レビュー前共有用）
1. `AutoSaveScheduler`（仮モジュール）に対するユニットテストを `node:test` で追加し、デバウンス・アイドル遷移をタイマー Fake で検証する。
2. ロック管理層のモック（Web Lock / ファイルロック）を作成し、`lock-unavailable` の再試行とフォールバックを検証する。
3. OPFS ラッパー（`src/lib/opfs.ts` 予定）をスタブ化し、原子的な `current.json`/`index.json` 書き換えおよび履歴 FIFO/容量超過処理をテーブル駆動で確認する。
4. 復元 API 各種の正常系・異常系を分離し、`data-corrupted` と `lock-unavailable` の挙動をカバレッジ対象にする。
5. Collector 連携について、ログエミッタのモックを介して 1 例外 1 行の制約と `retryable` 分岐のメトリクス送信抑制を検証する。

これらテストを先行で整備し、実装時は TDD 方針でケースを満たす最小実装を段階的に追加する。
