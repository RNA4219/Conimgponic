# PLUGIN-API — Conimg独自プラグイン v1

## 1. 配置
- `<workspace>/.conimgponic/plugins/<name>/conimg-plugin.json` + `index.js`。

## 2. マニフェスト要件と検証フロー

### 2.1 フィールド一覧

| フィールド | 型 / 必須 | 制約 | 備考 |
| --- | --- | --- | --- |
| `name` | string / 必須 | npm パッケージと同じ命名規約、32 文字以内 | UI・ログに表示。 |
| `version` | string / 必須 | semver (`major.minor.patch`) | `plugins.reload` の互換判定で使用。 |
| `engines.vscode` | string / 必須 | semver (`major.minor.patch`) | Bridge との major が一致する必要がある。 |
| `conimg-api` | string / 必須 | 例: `"1"` または `"1.x"` | 現行は `1` 系のみサポート。 |
| `entry` | string / 任意 | 既定 `index.js` | webview ローダーに渡されるパス。 |
| `permissions` | string[] / 任意 | 既定 `[]`。`fs`、`workspace:settings`、`ui:*`、`network:*` 等。 | 未宣言は拒否。 |
| `hooks` | string[] / 任意 | 既定 `[]` | §3 のフック名を列挙。 |
| `dependencies` | object / 任意 | `{ "npm": { ... }, "workspace": [ ... ] }` | `npm` は `package.json` プロキシ。`workspace` は watch 対象。 |
| `capabilities` | object / 任意 | `{"widgets": true, "commands": true}` 等 | UI への露出許可。 |
| `telemetry` | object / 任意 | `{ "tags": ["sample"] }` | Collector 連携時の既定タグ。 |

### 2.2 検証ステージ
`plugins.reload` は以下 5 ステージの直列ステートマシンで実行し、各ステージの `retryable` 属性を Collector 連携と UI 通知に用いる。設計は AutoSave 実装ガイド（`docs/AUTOSAVE-DESIGN-IMPL.md`）と Day8 アーキテクチャ（`Day8/docs/day8/design/03_architecture.md`）のフェーズ管理方針を踏襲する。

1. **Manifest validation** — JSON スキーマ+フィールド必須チェック。欠落/型不整合は `E_PLUGIN_MANIFEST_INVALID (retryable=false)`。
2. **Compatibility check** — `conimg-api` と Extension Host 対応範囲の比較。未対応は `E_PLUGIN_INCOMPATIBLE (retryable=false)`。
3. **Permission gate** — §2.3 の承認結果と manifest 権限差分を比較。未承認が残る場合は `E_PLUGIN_PERMISSION_MISMATCH (retryable=false)` として旧版へロールバック。
4. **Dependency cache** — §2.4 の依存キャッシュ（npm/workspace）との整合性を確認。差分は `E_PLUGIN_DEPENDENCY_MISMATCH (retryable=true)` とし、Collector 側の再試行キューへ渡す。
5. **Hook registration** — 宣言フックが §3 の要件を満たすか検査。フック未宣言や無効構成は `E_PLUGIN_HOOK_REGISTER_FAILED (retryable=true)`。

すべてのステージで `stage-start`/`stage-complete`/`stage-failed` ログを `tag=extension:plugin-bridge` として Collector に送信する。`retryable=false` のステージ失敗は UI 通知と同期する。

### 2.3 権限モデル
- **宣言必須**: `fs`, `network:*`, `workspace:*`, `ui:*`。暗黙付与は行わない。
- 評価順序: manifest → 既存許可 → UI 承認。差分が残る場合は `E_PLUGIN_PERMISSION_MISMATCH`（非再試行）を返し、旧版の権限セットへ即時ロールバック。
- UI 通知: `retryable=false` かつ未承認差分が 60 秒以上解消しない場合にトースト表示。Collector には `notifyUser=true` のログを転送し、Day8 Pipeline から監査できるようにする。
- 承認済み権限の変更履歴は `extension:plugin-bridge` タグ付きログで記録し、再試行は発生させない。許可済みセットとの差分のみを比較し、変更がなければ権限ステージはスキップ扱いで成功とする。

### 2.4 キャッシュと依存評価
- `dependencies.npm`: pnpm ローカルキャッシュをプラグインごとに分離。バージョン差分がある場合のみ再解決し、整合しない場合は `E_PLUGIN_DEPENDENCY_MISMATCH (retryable=true)`。
- `dependencies.workspace`: 監視対象ファイルのメタデータ（mtime・hash）を保持。差分検出時は `E_PLUGIN_DEPENDENCY_MISMATCH (retryable=true)` を返し、ホットリロードを再試行。
- `capabilities.widgets`: UI レジストリへの登録/解除を行い、リロード時にウィジェットキャッシュを再構築。

## 3. フック仕様

| フック | シグネチャ | 実行タイミング | 最低権限 | リロード時の扱い |
| --- | --- | --- | --- | --- |
| `onCompile` | `(scene: SceneGraph) => SceneGraph` | エクスポート前のビルド | 読み込み (`fs:read`)。`workspace:settings` 利用時は追加宣言。 | 依存差分ごとに再登録。失敗は `E_PLUGIN_HOOK_COMPILE (retryable=true)`。 |
| `onExport` | `(ctx: ExportContext) => { format: string; data: ArrayBuffer }` | `export` コマンド実行時 | `fs:write`、外部送信は `network:*`。 | `plugins.reload` 後は新しい `ctx.runtimeId` で再生成。 |
| `onMerge` | `({ base, ours, theirs }: MergeTriplet) => MergeResult` | マージ競合処理 | `fs`, `workspace:changeset`。 | 旧ハンドラを破棄し Pending 操作は `E_PLUGIN_RELOAD_PENDING (retryable=true)` でロールバック。 |
| `commands` | `{ [id: string]: (ctx: CommandContext) => unknown }` | コマンドパレット | `workspace:settings` (`read`/`write` 明示) | コマンド ID 重複は検証段階で `E_PLUGIN_COMMAND_CONFLICT (retryable=false)`。 |
| `widgets` | `{ id: string; mount(ctx, el) }[]` | Webview ウィジェット登録 | `ui:widget` | Webview は `unmount` → `mount`。状態保持はプラグイン実装責務。 |

- すべてのフックは Promise 返却を許容。拒否は `PluginExecutionError` にマップされ、`retryable` 属性で UI 挙動を制御する。
- Day8/AUTOSAVE 設計の `warn` ログ方針を踏襲し、`retryable=true` の場合は Collector の再試行枠へ送出する。

## 4. リロード、キャッシュ、ロールバック
1. Phase ガード（`conimg.plugins.enable` と Day8 フェーズ判定）を満たす場合のみ Plugin Bridge を初期化し、Extension Host が `plugins.reload` を発行すると現行インスタンスを `paused` へ遷移。
2. §2 のステージを順に実行し、成功したステージのみをコミット候補として保持。失敗時は成功済みステージのロールバックハンドラを逆順に呼び出し、Collector へ `rollback-executed` を記録する。
3. 全ステージ成功後に差分をコミットし、以下を再構築:
   - **権限ゲート**: 承認済み権限でハンドラを再生成。差分なしの場合はキャッシュを再利用。
   - **依存キャッシュ**: npm/workspace のハッシュを更新し、`retryable=true` エラー時のみ再解決をスケジュール。
   - **Hook Registry**: フック登録を原子更新し、失敗時は旧レジストリへ戻す。
4. リロード完了時に `reload-complete` を返却し、Webview/UI は `notifyUser=false` のログを受信する。`retryable=true` の失敗は指数バックオフ（3 回）で自動再試行し、閾値超過時にのみユーザ通知。
5. Phase ガードや機能フラグで遮断された場合は `E_PLUGIN_PHASE_BLOCKED` を即時返却し、Collector へ `stage-failed` を送出する。ブリッジは初期化されないため副作用は発生しない。

## 5. メッセージシーケンスとユーザ通知

```mermaid
sequenceDiagram
  participant Host as ExtensionHost
  participant Guard as PhaseGuard
  participant Bridge as PluginBridge
  participant Cache as DependencyCache
  participant UI as UI Shell
  participant Col as Collector

  Host->>Guard: ensureReloadAllowed("plugins:reload")
  alt disabled
    Guard-->>Host: false
    Host->>Col: log(stage-failed, code=E_PLUGIN_PHASE_BLOCKED, notifyUser=true)
    Host-->>UI: notify(permission-diff?)
  else enabled
    Guard-->>Host: true
    Host->>Bridge: plugins.reload {manifest, grantedPermissions, dependencySnapshot}
    loop stage
      Bridge->>Col: log(stage-start, tag=extension:plugin-bridge)
      Bridge->>Bridge: executeStage()
      alt stage success
        Bridge->>Col: log(stage-complete)
      else stage failure
        Bridge->>Col: log(stage-failed, notifyUser=retryable?false:true)
        Bridge->>Bridge: rollback(successfulStages)
        Bridge->>Col: log(rollback-executed*)
        Bridge-->>Host: reload-error {code, retryable}
        Host->>UI: notify(if !retryable || retries>=3)
        break
      end
    end
    Bridge-->>Host: reload-complete
    Host->>Col: log(reload-complete, notifyUser=false)
    Host->>UI: notify(permission diff resolved)
  end

  note over Host,Col: retryable=true は Collector 側で指数バックオフし 3 回まで自動再試行
```

- `plugins.reload`
  - 応答は `reload-complete` または `reload-error { code: E_PLUGIN_*, retryable, notifyUser }`。`retryable=true` は最大 3 回まで Collector が自動再試行し、閾値超過時のみ UI Toast を送出。
  - 失敗コード: `E_PLUGIN_MANIFEST_INVALID`, `E_PLUGIN_INCOMPATIBLE`, `E_PLUGIN_PERMISSION_MISMATCH`, `E_PLUGIN_DEPENDENCY_MISMATCH`, `E_PLUGIN_HOOK_REGISTER_FAILED`, `E_PLUGIN_PHASE_BLOCKED`。
- `log`
  - Webview⇄Extension 双方向。`payload.notifyUser=true` の場合は UI 通知を必須とし、Collector へ `tag=extension:plugin-bridge` 付きで転送する。
  - `retryable=true` のログは Collector 側で指数バックオフを管理し、UI には通知しない。
- ユーザ通知条件
  - `notifyUser=true` が付与されたログ、または `retryable=false` の `reload-error`。
  - 権限差分が解決せず 60 秒経過、もしくは同一 `E_PLUGIN_*` が 5 分以内に 3 回発生。
  - `warn` が連続 5 回発生した場合は通知するが、操作は継続可能。

## 8. テストケース (plugins.reload)
- **正常系**: 5 ステージ成功、`reload-complete` と `stage-complete` ログが Collector へ送出される。
- **権限差分**: `E_PLUGIN_PERMISSION_MISMATCH` を返却し、旧版へロールバック。`notifyUser=true` のログを確認。
- **依存不整合**: `E_PLUGIN_DEPENDENCY_MISMATCH` によりロールバック。`rollback-executed(stage=dependency-cache)` ログを検証。
- **ロールバック順序**: 成功済みステージが逆順で実行されることを確認。権限→依存→フックの順で戻る。
- **Phase ガード**: `conimg.plugins.enable=false` ではブリッジ初期化を行わず、`E_PLUGIN_PHASE_BLOCKED` を返却する。

## 6. セキュリティ
- デフォルト無効。明示的に有効化する。
- 権限は全て manifest で宣言し、暗黙付与なし。ネットワークは既定禁止。
- 実行は WebWorker（UI）／将来は拡張側ゲート（I/O）。
- タイムアウト/メモリ上限/例外は隔離し、Collector へ `log(level=warn)` で計測。

## 7. 受入基準
- サンプルプラグインが再起動なしでロードし、権限増加時は確認ダイアログが表示される。
- リロード失敗時は旧版へロールバックし、UI/Collector 双方に `E_PLUGIN_*` が記録される。
- `log` メッセージが Collector（Day8 Pipeline）へ `extension:plugin-bridge` タグ付きで伝搬する。
