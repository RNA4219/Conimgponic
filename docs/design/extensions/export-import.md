# VSCode Export Bridge 設計メモ

## 1. データフロー
1. VSCode 拡張が `export.request` を発行すると、ワークスペース直下の `.conimgponic/project/storyboard.json` を `fs.read` が読み込み、`scenes[]` と `meta` を取得する。
2. 取得したデータをエクスポート形式別に分岐させ、Markdown/CSV/JSONL は `runs/<ts>/shotlist.*` へ、Package Export は `project/export/<name>.imgponic.json` へ `fs.atomicWrite` を経由して書き出す。
3. 書き込み完了後、`export.result` がファイルパス・バイトサイズ・検証結果を VSCode 拡張へ返却し、Collector テレメトリへ JSONL イベントを送出して Day8/Collector→Analyzer→Reporter パイプライン（[Day8/docs/day8/design/03_architecture.md](../../../Day8/docs/day8/design/03_architecture.md)）へ連携する。
4. 書き込み中に AutoSave と同一ディレクトリ（`runs/<ts>/` や `history/`）へアクセスする場合は、`fs.atomicWrite` が `project/.lock`（[docs/AUTOSAVE-DESIGN-IMPL.md](../../AUTOSAVE-DESIGN-IMPL.md)）と同一 UUID でのロック取得を確認してから処理する。
5. 処理後、`export.result` が UI 用メッセージとバックアップディレクトリ（`history/<iso>.json`）との差分を記録し、AutoSave の世代管理と衝突しないよう `history/` 直下へのファイル生成は行わない。

## 2. ハンドラ責務と排他条件

| ハンドラ | 主責務 | I/O/副作用 | 排他・整合条件 |
| --- | --- | --- | --- |
| `fs.read` | `storyboard.json` および直近 `runs/<ts>/meta.json` の読込。BOM 除去と LF 正規化を担当。 | OPFS/ローカル FS からの読み込みのみ。 | 読み込み対象に `history/` が含まれる場合は読み取り専用ロックを要求し、書き込み処理と同時実行しない。|
| `fs.atomicWrite` | `runs/<ts>/shotlist.*` や `project/export/*.imgponic.json` の一時ファイル書込→rename。`AutoSave` と同じロールバック規約を適用。 | `.tmp` ファイル生成と rename、失敗時の削除。 | `project/.lock` を取得した状態でのみ実行。既存 `history/<iso>.json` ディレクトリが存在する場合は書込パスを `runs/<ts>/` 配下に限定し、`history/` には触れない。|
| `export.request` | VSCode 側からのフォーマット指定・出力ディレクトリ要求を受理し、読取→変換→書込をキュー化。 | テレメトリ（`export.request` イベント）送信。 | リクエストタイムスタンプ単位で `runs/<ts>/` を確保し、既存 `runs/<ts>/` が進行中の場合はキューで順番待ち。|
| `export.result` | 完了/失敗ステータスとパス、バイト数、警告一覧を応答。Collector へ結果イベントを送信。 | UI 通知（成功: info、失敗: warn/error）。 | `history/` に新規ファイルが追加されていないこと、および AutoSave の `lastSuccessAt` より新しい場合のみ成功扱いにする。|

排他制御は `project/.lock` を共有ロックとし、AutoSave 側の書込が走行中の場合は指数バックオフで待機する。`history/` ディレクトリを更新するハンドラは存在せず、既存履歴は読み取り専用（`fs.read`）でのみ参照する。

## 3. バリデーション手順
- **構造検証**: `storyboard.json` の JSON Schema（`DATA-SCHEMA.md` §3）で `scenes[].id/title/status/durationSec` を確認し、`null` の混入がないか検査する。
- **フィールド充足**: Markdown/CSV/JSONL の必須フィールドは [EXPORT-IMPORT.md](../../src-1.35_addon/EXPORT-IMPORT.md) §6 のテーブルに従って空文字/欠損がないかチェックする。tone 配列は CSV では `;` 区切りへ正規化する。
- **容量チェック**: JSONL 出力は 50MB（AutoSave と同値）を上限とし、超過時は `export.result` で `retryable=false` を付与して失敗扱いにする。
- **整合確認**: 書込完了後、`runs/<ts>/meta.json` の `updatedAt` と Export ブリッジのタイムスタンプが一致するか比較し、一致しない場合は警告として UI に通知する。

## 4. エラー再試行ポリシー
- `fs.read` 失敗（I/O/JSON パース）は `retryable=false`。UI には「ストーリーボードを再読み込みしてください」を提示する。
- `fs.atomicWrite` 失敗は `AutoSaveError('write-failed', retryable=true)` と同等の扱いで最大 3 回まで指数バックオフ（500ms, 1s, 2s）。3 回失敗時は `retryable=false` に降格させる。
- `export.request` キュー処理中にタイムアウト（10s）した場合は `retryable=true` で再キュー、連続 3 回失敗で `export.result` が `retryable=false` を返す。
- `export.result` の通知送信に失敗した場合は Collector 側へ WARN ログのみ出し、UI へはフォールバックとしてステータスバー通知を繰り返さない。

> AutoSave の保存ポリシー（デバウンス・履歴容量）と同一のしきい値を用いることで、履歴ディレクトリとの整合を維持しながら VSCode 拡張の再試行挙動を簡潔に保つ。
