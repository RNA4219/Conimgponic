# Plugin Bridge 設計

## 1. モジュール構成
| レイヤ | モジュール | 想定パス | 主責務 | 依存 |
| --- | --- | --- | --- | --- |
| Extension Host | `bridge/manifest-loader.ts` | `extensions/vscode/src/bridge/manifest-loader.ts` | マニフェスト検証・権限差分計算。Day8 Collector で追跡するため `PluginPermissionError` を `retryable` 区分付きで発行。 | `docs/src-1.35_addon/PLUGIN-API.md` のマニフェスト要件、`docs/AUTOSAVE-DESIGN-IMPL.md` のエラーポリシー。 |
| Extension Host | `bridge/runtime-manager.ts` | `extensions/vscode/src/bridge/runtime-manager.ts` | Worker バンドル生成、`plugins.reload` トリガー、失敗時ロールバック。 | Manifest Loader、`scripts/build-plugin-worker.ts`（予定）。 |
| Extension Host | `bridge/logger.ts` | `extensions/vscode/src/bridge/logger.ts` | `log` メッセージを Collector JSONL (`extension:plugin-bridge`) に流す。 | Day8 Collector/Analyzer のイベント契約。 |
| Webview | `runtime/bootstrap.ts` | `extensions/vscode/webview/plugin/bootstrap.ts` | hooks 初期化、UI Widget 登録、`log`／`reload` メッセージング。 | Runtime Manager からの初期メッセージ。 |
| Webview | `runtime/hook-adapter.ts` | `extensions/vscode/webview/plugin/hook-adapter.ts` | フック実装を検証し、`retryable` メタを付与して戻す。 | `docs/AUTOSAVE-DESIGN-IMPL.md` の `AutoSaveError` スタイル。 |
| Shared | `bridge/protocol.ts` | `extensions/vscode/shared/bridge-protocol.ts` | `plugins.reload`, `log`, `permission-diff` などの型定義。 | TypeScript ESM、`docs/src-1.35_addon/PLUGIN-API.md`。 |

- Collector/Analyzer/Reporter 流れ（Day8 docs）の制約に合わせ、ログとテレメトリは JSONL 1 行で完結させる。
- `governance/policy.yaml` で規定された例外ガードに従い、再試行不可のケースを明示化する。

## 2. Hook 初期化手順
1. `manifest-loader` が `conimg-plugin.json` を読み込み、`permissions`/`dependencies` を検証。
2. `runtime-manager` が Worker バンドルを生成。`dependencies.workspace` を監視へ登録し、初期キャッシュを保存。
3. `runtime-manager` → Webview へ `plugins.reload` を送信。Webview は旧フックを一時停止し `ack(reload-started)`。
4. Webview `bootstrap` がモジュールを `import()` し、`hook-adapter` で `onCompile` などを検証。未定義フックは無視。
5. `hook-adapter` は各フックに `retryable` メタを付与し、`PluginExecutionError` を `PluginReloadError` 等へ変換。
6. Webview が `reload-complete` を返却。Extension Host は `manifest-loader` の差分結果と合わせてウィジェット登録を更新。
7. ロード後、`logger` が `PluginLoaded` イベントを Collector へ送信（タグ: `extension:plugin-bridge`, `plugin:<name>`）。

- 手順全体で `docs/AUTOSAVE-DESIGN-IMPL.md` に倣い、`retryable=true` は指数バックオフ、`false` は UI + Collector へ即時通知。
- Day8 `03_architecture.md` に沿って、イベントは Collector→Analyzer→Reporter のパイプラインで参照できるようタグを最小集合で管理。

## 3. テレメトリのタグ付け方針
| 送信者 | イベント | 必須タグ | 任意タグ | 備考 |
| --- | --- | --- | --- | --- |
| Extension Host (`logger`) | `PluginLog` (`log` 経由) | `extension:plugin-bridge`, `plugin:<name>`, `level:<debug|info|warn|error>` | `hook:<name>`, `retryable:<bool>` | AUTOSAVE の `warn` ログ準拠で副作用なし。 |
| Extension Host (`runtime-manager`) | `PluginReload` | `extension:plugin-bridge`, `plugin:<name>`, `result:<success|rollback|denied>` | `permissions:<diff>` | Rollback 時は `retryable` 付きで Analyzer がアラート。
| Webview (`hook-adapter`) | `PluginHookError` | `extension:plugin-bridge`, `plugin:<name>`, `hook:<name>` | `retryable:<bool>`, `phase:<compile|export|merge>` | 未捕捉例外は `retryable=false` を強制。 |
| Extension Host (`manifest-loader`) | `PluginPermissionPrompt` | `extension:plugin-bridge`, `plugin:<name>`, `permission:<id>` | `decision:<granted|denied>` | UI ダイアログ表示判定。 |

- すべて Collector JSONL フォーマットに準拠し、Analyzer では `extension:plugin-bridge` でフィルタ。
- `retryable=false` のイベントは Reporter が `reports/today.md` へ反映し、Day8 シーケンス図の戻りフローでガバナンス通知へ繋げる。
- テレメトリ送出前に PII が含まれないかを必ず検証し、`docs/AUTOSAVE-DESIGN-IMPL.md` の安全弁（warn で止める）を踏襲。
