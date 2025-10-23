# PLUGIN-API — Conimg独自プラグイン v1

## 1. 配置
- `<workspace>/.conimgponic/plugins/<name>/conimg-plugin.json` + `index.js`。

## 2. マニフェスト要件

| フィールド | 型 / 必須 | 制約 | 備考 |
| --- | --- | --- | --- |
| `name` | string / 必須 | npm パッケージと同じ命名規約、32 文字以内 | UI・ログに表示。 |
| `version` | string / 必須 | semver (`major.minor.patch`) | `plugins.reload` の互換判定で使用。 |
| `conimg-api` | string / 必須 | 例: `"1"` または `"1.x"` | `1` 系のみサポート。将来は範囲指定可。 |
| `entry` | string / 任意 | 既定 `index.js` | webview ローダーに渡されるパス。 |
| `permissions` | string[] / 任意 | 既定 `[]`。`fs`、`workspace:settings`、`ui:*`、`network:*` などを宣言。 | `plugins.reload` 時に再審査。 |
| `hooks` | string[] / 任意 | 既定 `[]` | 下記 §3 のフック名を列挙。 |
| `dependencies` | object / 任意 | `{ "npm": { ... }, "workspace": [ ... ] }` | `npm` は `package.json` へのプロキシ。`workspace` は watch 対象。 |
| `capabilities` | object / 任意 | `{"widgets": true, "commands": true}` 等 | UI への露出許可。 |
| `telemetry` | object / 任意 | `{ "tags": ["sample"] }` | Collector 連携時の既定タグ。 |

### 2.1 パーミッション審査
- **宣言必須**: `fs`, `network:*`, `workspace:*`, `ui:*`。
- **暗黙付与なし**: 未宣言の操作はブロックされ、`PluginPermissionError(retryable=false)` で失敗。
- `plugins.reload` では、マニフェスト読み直し → 拡張側ゲートで再審査 → Webview 側で差分権限を通知。
- 設定同期 (`workspace:settings`) は Day8 設計（Collector→Analyzer→Reporter）の SLO を尊重し、ユーザ操作ログに含める。

### 2.2 依存キャッシュ
- `dependencies.npm`: pnpm ローカルキャッシュをプラグインごとに分離。`plugins.reload` 時はバージョン差分がある場合のみ再解決。
- `dependencies.workspace`: 監視対象ファイルのメタデータ（mtime・hash）を保持し、差分があればホットリロードをトリガー。
- `capabilities.widgets`: UI レジストリへ登録されるため、リロード時にウィジェットキャッシュを再構築。

## 3. フック仕様

| フック | シグネチャ | 実行タイミング | 必要権限 | リロード時の再評価 |
| --- | --- | --- | --- | --- |
| `onCompile` | `(scene: SceneGraph) => SceneGraph` | エクスポート前のビルド | 読み込みのみ (`fs` 任意)、`workspace:settings` が必要なら宣言 | 依存ファイル・manifest 差分に応じて再登録。 |
| `onExport` | `(ctx: ExportContext) => { format: string; data: ArrayBuffer }` | `export` コマンド実行時 | `fs` (`write`)、`network:*` は外部送信時のみ | `plugins.reload` 後は新しい `ctx.runtimeId` で再生成。 |
| `onMerge` | `({ base, ours, theirs }: MergeTriplet) => MergeResult` | マージ競合処理 | `fs` + `workspace:changeset` | リロードで旧ハンドラを破棄、Pending 操作は `PluginReloadError(retryable=true)` でロールバック。 |
| `commands` | `{ [id: string]: (ctx: CommandContext) => unknown }` | コマンドパレット | `workspace:settings` (`read`/`write` 明示) | コマンド ID 重複は reload で検出し失敗。 |
| `widgets` | `{ id: string; mount(ctx, el) }[]` | Webview ウィジェット登録 | `ui:widget` | Webview は mount 解除 → 再 mount。状態保持はプラグイン側で実装。 |

- すべてのフックは Promise 返却を許容。拒否された場合は `PluginExecutionError`。
- フックで `AutoSaveError` 互換の `retryable` 属性を尊重し、UI は Day8/Collector へ `log` メッセージで転送する。

## 4. リロードとキャッシュの扱い
1. 拡張 (Extension Host) が `plugins.reload` を発行。
2. マニフェスト再読込 → `permissions` / `capabilities` / `dependencies` を差分評価。
3. 差分があれば以下を再構築:
   - **権限ゲート**: `fs`, `workspace`, `network`, `ui` のハンドラを再生成。
   - **Worker バンドル**: `entry` と `dependencies.npm` からビルドし直し。バージョン不一致時のみ。
   - **Workspace Watchers**: `dependencies.workspace` のキャッシュを更新し、hash が変われば `onCompile` を再登録。
   - **Widget Registry**: `capabilities.widgets` true の場合に UI 側キャッシュをクリア。
4. リロード完了イベントを Webview へ送信。失敗時は extension 側で `PluginReloadError` を発行し、旧版をロールバック。

## 5. メッセージシーケンス (`plugins.reload` / `log`)

```
ExtensionHost --plugins.reload--> Webview(Runtime)
Webview --ack(reload-started)--> ExtensionHost
Webview --log--> ExtensionHost (level, pluginId, event)
ExtensionHost --log--> Collector(JSONL)
Webview --reload-complete--> ExtensionHost
ExtensionHost --notify--> UI Toast (on failure or permission diff)
```

- `plugins.reload`
  - Extension Host が送信。Webview は旧フックを一時停止し、差分検証 → 再初期化。
  - `PluginReloadError(retryable=true)` は Extension Host が再試行。`retryable=false` は即座にユーザへ通知し、旧バージョンにロールバック。
  - 権限差分が広がった場合（例: `network:*` 追加）は確認ダイアログを表示し、拒否なら reload 中止。
- `log` メッセージ
  - Webview→Extension Host 双方向。`level` が `error` で `retryable=false` の場合はトースト通知 + Collector 送信。
  - Day8 Pipeline との整合性のため、`tags` に `extension:plugin-bridge` を付与し AUTOSAVE のログ仕様 (`warn` は副作用なし) を踏襲。
- 例外伝播
  - Webview で未捕捉例外 → `PluginExecutionError(retryable=false)` にラップし Extension Host へ返却。
  - Extension Host 側例外（I/O ゲート）→ `PluginHostError(retryable=?)` として Webview へ通知。
  - UI への通知条件: `retryable=false` か、連続 3 回の `retryable=true` 発生で指数バックオフ解除時。

## 6. セキュリティ
- 既定は**無効**。個別に有効化。
- **権限明示**（`fs`/`ui:*` など）。ネットワークは既定禁止。
- 実行は **WebWorker**（UI）／将来は拡張側ゲート（I/O）。
- タイムアウト/メモリ上限/例外は隔離し、Collector へ `log(level=warn)` で計測。

## 7. 受入基準
- サンプルプラグインが **再起動なし**でロードし、権限増加時はダイアログが表示される。
- リロード失敗時は旧版へロールバックし、UI/Collector 双方に `PluginReloadError` が記録される。
- `log` メッセージが Collector（Day8 Pipeline）へ `extension:plugin-bridge` タグ付きで伝搬する。
