# Plugin Bridge 設計ノート

## 0. モジュール構成
| レイヤ | モジュール | 想定パス | 主責務 | 依存 |
| --- | --- | --- | --- | --- |
| Extension Host | `bridge/manifest-loader.ts` | `extensions/vscode/src/bridge/manifest-loader.ts` | マニフェスト検証・権限差分計算。Day8 Collector で追跡するため `PluginPermissionError` を `retryable` 区分付きで発行。 | `docs/src-1.35_addon/PLUGIN-API.md` のマニフェスト要件、`docs/AUTOSAVE-DESIGN-IMPL.md` のエラーポリシー。 |
| Extension Host | `bridge/runtime-manager.ts` | `extensions/vscode/src/bridge/runtime-manager.ts` | Worker バンドル生成、`plugins.reload` トリガー、失敗時ロールバック。 | Manifest Loader、`scripts/build-plugin-worker.ts`（予定）。 |
| Extension Host | `bridge/logger.ts` | `extensions/vscode/src/bridge/logger.ts` | `log` メッセージを Collector JSONL (`extension:plugin-bridge`) に流す。 | Day8 Collector/Analyzer のイベント契約。 |
| Webview | `runtime/bootstrap.ts` | `extensions/vscode/webview/plugin/bootstrap.ts` | hooks 初期化、UI Widget 登録、`log`／`reload` メッセージング。 | Runtime Manager からの初期メッセージ。 |
| Webview | `runtime/hook-adapter.ts` | `extensions/vscode/webview/plugin/hook-adapter.ts` | フック実装を検証し、`retryable` メタを付与して戻す。 | `docs/AUTOSAVE-DESIGN-IMPL.md` の `AutoSaveError` スタイル。 |

## 1. 目的と位置付け
- VS Code 拡張と Webview Runtime 間の橋渡しを担い、Day8 パイプライン（Collector→Analyzer→Reporter）と整合するログ/権限モデルを提供する。
- AutoSave 実装（`docs/AUTOSAVE-DESIGN-IMPL.md`）と同じ `retryable` セマンティクスを適用し、UI へ副作用を与えないロールバック経路を確保する。

## 2. キャッシュ無効化ポリシー
| キャッシュ | 監視キー | 無効化トリガー | 手順 |
| --- | --- | --- | --- |
| Manifest | `conimg-plugin.json` の hash | マニフェスト差分検知、`plugins.reload` 要求 | 1) マニフェストを再読込 2) スキーマ検証 3) 権限差分をユーザへ提示。 |
| npm 依存 | `dependencies.npm` バージョン | バージョン変更、lockfile 更新 | 1) プラグイン専用 pnpm 仮想ストアを再生成 2) 成功時に旧バンドルを破棄 3) 失敗は `E_PLUGIN_DEP_RESOLVE`。 |
| Workspace 監視 | `dependencies.workspace` の mtime/hash | ファイル変更、削除 | 1) Watcher キャッシュ更新 2) 対応フック再登録 3) 旧フックは `paused` 状態で保持しロールバック可。 |
| Widget Registry | `capabilities.widgets` | 設定 toggle | 1) UI レジストリ再構築 2) Webview へ unmount/mount を通知 3) 状態保持はプラグイン責務。 |

## 3. リロードとロールバック
1. Extension Host が `plugins.reload` を送信し、現行 Runtime を `paused` へ遷移させる。
2. §2 のキャッシュ無効化を順に適用。途中で `E_PLUGIN_* (retryable=true)` が返った場合は指数バックオフ後に再試行。
3. `retryable=false` を受け取った場合、即座に旧キャッシュへロールバックし、UI へトースト通知 (`error`) を表示する。
4. ロールバック時は以下を順番に復元する:
   - Worker バンドル (`dist/worker.js`)
   - フック登録 (`commands`, `widgets`, `on*`)
   - 権限ゲート状態（承認済みセット）
   - 監視対象ハッシュ
5. ロールバックが成功したら、Collector へ `log(level=warn, code=E_PLUGIN_ROLLBACK_APPLIED)` を転送し、Day8 パイプラインで追跡可能にする。

## 4. 例外と通知
| 例外コード | 説明 | retryable | UI 通知 | Collector ログ |
| --- | --- | --- | --- | --- |
| `E_PLUGIN_MANIFEST_INVALID` | Manifest がスキーマに不一致 | false | 即時トースト + 問題パネル | `error` + `extension:plugin-bridge` |
| `E_PLUGIN_PERMISSION_PENDING` | 新規権限承認待ち | true | ダイアログで承認要求、拒否時は `error` | `warn` |
| `E_PLUGIN_DEP_RESOLVE` | npm 依存解決失敗 | true | 再試行 3 回失敗後にトースト | `warn` |
| `E_PLUGIN_RELOAD_FAILED` | Runtime 初期化失敗 | true | 3 回失敗で `error` 通知 | `error` |
| `E_PLUGIN_ROLLBACK_APPLIED` | 旧版へ復旧 | false | 状況に応じて `info` バナー | `info` |

## 5. オペレーション手順
- **キャッシュクリア**: `scripts/plugins/clear-cache.sh <pluginId>` で pnpm 仮想ストアと manifest cache を削除。次回 `plugins.reload` で再構築。
- **強制ロールバック**: `plugins.reload` が `retryable=false` を返した際は Extension Host が自動実行。手動対応時は `Developer: Toggle Plugin Bridge Safe Mode` を実行し、最終成功スナップショットを再適用する。
- **監査ログ**: すべての `E_PLUGIN_*` は `reports/today.md` 集計対象になるため、Collector 側でのフィルタリングは行わない。

## 6. 未決事項
- Safe Mode の UI 露出タイミング。
- `E_PLUGIN_*` と VS Code の `code` プロパティのマッピングを自動生成する仕組み。

## 7. Hook 初期化手順
1. `manifest-loader` が `conimg-plugin.json` を読み込み、`permissions`/`dependencies` を検証。
2. `runtime-manager` が Worker バンドルを生成し、`dependencies.workspace` を監視へ登録して初期キャッシュを保存。
3. `runtime-manager` → Webview へ `plugins.reload` を送信。Webview は旧フックを一時停止し `ack(reload-started)` を返す。
4. Webview `bootstrap` がプラグインモジュールを `import()` し、`hook-adapter` で `onCompile` などを検証。未定義フックは無視。
5. `hook-adapter` は各フックに `retryable` メタを付与し、`PluginExecutionError` を `PluginReloadError` 等へ変換。
6. Webview が `reload-complete` を返却。Extension Host は `manifest-loader` の差分結果と合わせてウィジェット登録を更新。
7. ロード後、`logger` が `PluginLoaded` イベントを Collector へ送信（タグ: `extension:plugin-bridge`, `plugin:<name>`）。

## 8. テレメトリのタグ付け方針
| 送信者 | イベント | 必須タグ | 任意タグ | 備考 |
| --- | --- | --- | --- | --- |
| Extension Host (`logger`) | `PluginLog` (`log` 経由) | `extension:plugin-bridge`, `plugin:<name>`, `level:<debug|info|warn|error>` | `hook:<name>`, `retryable:<bool>` | AUTOSAVE の `warn` ログ準拠で副作用なし。 |
| Extension Host (`runtime-manager`) | `PluginReload` | `extension:plugin-bridge`, `plugin:<name>`, `result:<success|rollback|denied>` | `permissions:<diff>` | Rollback 時は `retryable` 付きで Analyzer がアラート。 |
| Webview (`hook-adapter`) | `PluginHookError` | `extension:plugin-bridge`, `plugin:<name>`, `hook:<name>` | `retryable:<bool>`, `phase:<compile|export|merge>` | 未捕捉例外は `retryable=false` を強制。 |
| Extension Host (`manifest-loader`) | `PluginPermissionPrompt` | `extension:plugin-bridge`, `plugin:<name>`, `permission:<id>` | `decision:<granted|denied>` | UI ダイアログ表示判定。 |
