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
2. Runtime Manager は下記ステージを順番に実行する共通ステートマシンを走査する。各ステージは `docs/AUTOSAVE-DESIGN-IMPL.md` と同じ `retryable` セマンティクスで例外を分類する。

   | Stage | 主処理 | 失敗コード | retryable | 備考 |
   | --- | --- | --- | --- | --- |
   | `manifest:validate` | `conimg-plugin.json` の構文検証と必須フィールド確認 | `E_PLUGIN_MANIFEST_INVALID` | false | `FlagSnapshot.source=env` 時でも失敗は即時ロールバック。
   | `compat:check` | `engines.vscode` と Bridge バージョンの major を比較 | `E_PLUGIN_VERSION_INCOMPATIBLE` | false | 将来 `conimg-api` も併用。 |
   | `permissions:gate` | 新規権限差分を承認セットと比較 | `E_PLUGIN_PERMISSION_PENDING` / `E_PLUGIN_PERMISSION_DENIED` | false | `pending` は UI から承認されるまで再試行しない。 |
   | `dependencies:cache` | npm/workspace キャッシュの整合性確認 | `E_PLUGIN_DEP_RESOLVE` | true | `retryable=true` は指数バックオフ。 |
   | `hooks:register` | Webview フック登録・差し替え | `E_PLUGIN_RELOAD_FAILED` | true | Webview ack で成功確定。 |

3. `retryable=false` を受け取った場合は承認待ちまたは互換性エラーとみなし、即座に旧キャッシュへロールバックし UI へトースト通知 (`error`) を表示する。
4. ロールバック時は以下を順番に復元する:
   - Worker バンドル (`dist/worker.js`)
   - フック登録 (`commands`, `widgets`, `on*`)
   - 権限ゲート状態（承認済みセット）
   - 監視対象ハッシュと `FlagSnapshot.source`（`env` 優先のまま AutoSave 指標を維持）
5. 成否にかかわらず `extension:plugin-bridge` タグ付きで Collector へ `PluginReload` ログを転送し、Day8 パイプラインの `result:<success|rollback|denied>` 指標を更新する。

### 3.1 メッセージフローと通知条件
- `plugins.reload`
  - 要求: `{ type: "plugins.reload", manifestHash, attempt }`。Webview は即時 `ack(reload-started)` を返し、Host は `paused` 状態を維持する。
  - 応答: `reload-complete`（成功）か `reload-error`（失敗）。`reload-error` には `E_PLUGIN_*` と `retryable` を必ず含め、`retryable=false` は UI へ即時トーストを表示して再試行を停止する。
  - 再試行: `retryable=true` のみ指数バックオフ（1s→4s→9s）。AutoSave と同様、連続 3 回失敗で UI/Collector に `error` を送出する。
- `log`
  - フック/Runtime から発火される任意ログ。`level=error` かつ `retryable=false` のメッセージは `PluginReload` 連鎖と同様にロールバックを誘発する。
  - Collector には JSONL 形式で `scope=extension:plugin-bridge`、`plugin:<id>`, `result:<success|rollback>`、`retryable:<bool>` をタグとして付与し、Day8/Analyzer が Day8/docs/day8/design/03_architecture.md の Pipeline 指標を更新できるようにする。
- UI 通知
  - `E_PLUGIN_PERMISSION_PENDING` は権限承認ダイアログを表示し、承認が入るまで追加リクエストを抑止する。
  - `E_PLUGIN_PERMISSION_DENIED` は `FlagSnapshot.source` を `env` 優先で維持したまま Safe Mode を案内し、Collector へ `result=denied` を記録する。

## 4. 例外と通知
| 例外コード | 説明 | retryable | UI 通知 | Collector ログ |
| --- | --- | --- | --- | --- |
| `E_PLUGIN_MANIFEST_INVALID` | Manifest がスキーマに不一致 | false | 即時トースト + 問題パネル | `error` + `extension:plugin-bridge` |
| `E_PLUGIN_VERSION_INCOMPATIBLE` | `engines.vscode` major が Bridge と乖離 | false | 設定/バージョン確認の CTA | `error` |
| `E_PLUGIN_PERMISSION_PENDING` | 新規権限承認待ち | false | ダイアログで承認要求、承認まで再試行停止 | `warn` |
| `E_PLUGIN_PERMISSION_DENIED` | ユーザが権限を拒否 | false | 再度有効化手順をガイド | `error` |
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
