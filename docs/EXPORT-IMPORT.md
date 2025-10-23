# Export/Import 正規化仕様 (vscode bridge)

## 1. 目的と参照ドキュメント
- VS Code 拡張ホストで `export.request/result` を通じて Markdown / CSV / JSONL / Package Export を正規化しつつ URI を返却する設計を定義する。
- AutoSave 実装とロック戦略は [AUTOSAVE-DESIGN-IMPL](./AUTOSAVE-DESIGN-IMPL.md) を参照し、履歴 (`history/`) との競合回避方針を継承する。
- 拡張 API 契約の前提は [docs/src-1.35_addon/API-CONTRACT-EXT.md](./src-1.35_addon/API-CONTRACT-EXT.md) をベースに更新する。

## 2. フォーマット別正規化と出力先マッピング
| フォーマット | 正規化ルール | ファイル名 / ディレクトリ | 備考 |
| --- | --- | --- | --- |
| `markdown` | 行末は `\n` 固定。YAML frontmatter のキー順を維持し、本文末尾に改行を保証。 | `runs/<ts>/export/markdown/storyboard.md` | Storyboard の `title`, `description`, `lanes` を必須。欠落時は `export.failed`。 |
| `csv` | RFC4180（`,` 区切り、`"` ダブルクォートエスケープ、LF 行末）を強制。ヘッダーは `id,title,status,owner,tags` 固定。 | `runs/<ts>/export/csv/storyboard.csv` | Story セルの改行は `""` で囲む。 |
| `jsonl` | UTF-8 / LF 区切り。各行は Story を `{id,title,status,owner,tags,updatedAt}` のキー順で出力。 | `runs/<ts>/export/jsonl/storyboard.jsonl` | 日付は ISO8601（`Z`）。欠落フィールドは空文字。 |
| `package` | Zip (no compression) で `storyboard.json`, `meta.json`, `export-info.json` を含む。各 JSON は LF 行末、2 スペースインデント。 | `runs/<ts>/export/package/<ts>.zip` | `export-info.json` に `format`, `generatedAt`, `source` を記録。 |

- `<ts>` は `YYYYMMDDTHHmmssZ`。AutoSave の `history/<ISO>.json` と重複しないよう `runs/` 以下に隔離する。
- `meta.json` は `projectId`, `revision`, `autosaveSnapshot`（取得時の `history` 参照）を保持し、再インポート時の整合チェックに利用する。

## 3. export.request/result 契約
```
// Webview → Extension
{ type: 'export.request', apiVersion: 1, reqId, payload: { format: 'markdown'|'csv'|'jsonl'|'package' } }

// Extension → Webview 成功
{ type: 'export.result', apiVersion: 1, reqId, ok: true, uri: string, normalizedUri: string }

// Extension → Webview 失敗
{ type: 'export.result', apiVersion: 1, reqId, ok: false, error: { code: string, message: string, retryable: boolean } }
```
- `uri` は VS Code `Uri` を `toString()` したもの。`normalizedUri` は `file:` スキームで LF 正規化済みファイルへのパスを返す。
- 失敗時の `code` 例: `export.format.unsupported`, `export.fs.conflict`, `export.autosave.lock`, `export.serialize.failed`。
- `retryable=true` はロック競合や一時的な I/O エラー（AutoSave 同期中など）。`false` はフォーマット未対応や検証エラー。

## 4. AutoSave との整合
- Export 実行時は AutoSave の Web Lock (`project/autosave`) と同一優先度で `runs/` ディレクトリに対するミューテックスを取得する。取得できない場合は `retryable=true` で `export.autosave.lock`。
- 履歴書込 (`history/`) は常に先行。Export は AutoSave の `snapshot()` 後に行い、`history/` 直下には書込しない。
- フォールバック拡張でも `runs/<ts>/export` を使用し、`history` ディレクトリを作成しない。

## 5. テレメトリ / ロールバック
| イベント | 属性 | 送信タイミング | ロールバック条件 |
| --- | --- | --- | --- |
| `export.success` | `{ format, uri, durationMs, autosavePhase }` | `ok:true` 応答前 | Zip 生成失敗時は送信せず、`export.failed` のみ。 |
| `export.failed` | `{ format, code, retryable, durationMs }` | `ok:false` 応答直後 | `retryable=true` で自動再試行が成功した場合、成功イベントで上書きしない。 |
| `export.retry` | `{ format, attempt, reason }` | `retryable=true` でバックオフ開始時 | 3 回超で `export.failed` として確定。 |

- Day8 パイプライン (Collector) では `export.success` → `ExportNormalized`、`export.failed` → `ExportError` として扱う。`retryable=false` は即座に終端。
- Telemetry のイベント名・属性は [docs/TELEMETRY-COLLECTOR-AUTOSAVE.md](./TELEMETRY-COLLECTOR-AUTOSAVE.md) の命名規約に従う。

## 6. テスト戦略 (RED→GREEN)
- `tests/export/vscode.bridge.test.ts`: VS Code ブリッジ単体の RED ケース（正規化/URI/エラー/テレメトリ）。
- `tests/export/golden.webview.test.ts`: Webview とのゴールデン比較。`runs/<ts>/export/<format>/` に出力したファイルと比較する想定でケースを詳細化する。
- 追加のゴールデンファイルは `tests/fixtures/export/<format>/` に配置し、LF 行末とキー順を固定する。

## 7. 再試行ポリシーと UI 連携
- 再試行は指数バックオフ（100ms, 300ms, 900ms）。`retryable=false` は UI に即時エラー表示。
- Webview は `export.result.ok === true` 時に `uri` をコピー用トーストに反映し、UI ボタン配置は既存仕様を維持（Out of scope）。
- エラーメッセージは AutoSave の `retryable` 表現（`warn` ログ）と統一し、`details` に Collector 参照 ID を格納する。

## 8. 未解決事項 / フォローアップ
- フォールバック拡張での Zip 生成実装。`JSZip` 互換 API を評価する。
- runs ディレクトリの世代管理 (TTL 7 日) を将来導入。
