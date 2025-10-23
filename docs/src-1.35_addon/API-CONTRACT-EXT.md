# API-CONTRACT-EXT — VS Code 拡張向け API 契約（v1.0）

## 1. 目的と範囲
- **目的**: PWA UIを Webview に移植し、**postMessage** 経由で拡張ホストと通信するための**型・時系列・誤り処理**を固定。  
- **範囲**: `customEditor` 上での **ドキュメント編集/保存/履歴**、**精緻マージ**、**Export/Import**、**プラグインI/F v1**。`gen.*` は将来のLLM接続用の受け口のみ定義。

## 2. ランタイム前提（Webview）
- `acquireVsCodeApi()` を用いて state/push/pop を利用可。
- **CSP厳格**（`default-src 'none'`、`script-src 'nonce-...'`、styleは `nonce` or `unsafe-inline` 不可が望ましい）。
- 外部ネットワークへの fetch は**禁止**。ネットワークは**拡張側ゲート**を介す（将来）。

## 3. メッセージバス（基本）
- **封筒型**（Envelope）: すべてのメッセージに共通のヘッダを付与。Phase ガードが `phase` と `correlationId` を用いて監視する。
```ts
type MsgBase = {
  type: string                // 例: "snapshot.request"
  apiVersion: 1               // メッセージ契約のバージョン
  reqId: string               // 要求→応答の相関ID（応答はreqIdをエコー）
  correlationId: string       // Telemetry JSONL と共有
  ts: string                  // ISO8601（送信側で付与）
  phase: 'A-0' | 'A-1' | 'A-2' | 'B-0' | 'B-1'  // Phase ガード用ステージ
  bridgePhase:
    | 'bootstrap'
    | 'ready'
    | 'snapshot.request'
    | 'snapshot.result'
    | 'status.autosave'
}
```
- **相関**: 要求は `reqId` と `correlationId` を必須。応答は同値を返却し、Collector は `correlationId` で JSONL に変換する。`bridgePhase`
  は UI/拡張間の状態機械を追跡するサブフェーズで、`phase='A-2'` の保存フロー内で `status.autosave` と `snapshot.result` を同期させる。
- **エラー契約**: 応答系は `{ ok: false, error: { code, message, retryable, details? } }` を返却。`retryable=false` は Phase ガードに即通知。

## 4. 型定義（抜粋）

### 4.1 Webview → Extension
```ts
type WvToExt =
  | ({ type: "ready" } & MsgBase & { payload: { uiVersion: string } })
  | ({
      type: "snapshot.request"
    } & MsgBase & {
      payload: {
        storyboard: any
        pendingBytes: number
        queuedGeneration: number
        debounceMs: 500
        idleMs: 2000
        historyLimit: 20
        sizeLimit: 50 * 1024 * 1024
        guard: {
          featureFlag: { value: boolean; source: "env" | "workspace" | "localStorage" | "default" }
          optionsDisabled: boolean
        }
        reason: "change" | "flushNow"
      }
    })
  | ({ type: "fs.read" } & MsgBase & { payload: { uri: string } })
  | ({ type: "fs.write" } & MsgBase & { payload: { uri: string, dataBase64: string } })
  | ({ type: "fs.list" } & MsgBase & { payload: { dir: string } })
  | ({ type: "fs.atomicWrite" } & MsgBase & { payload: { uri: string, dataBase64: string } })
  | ({ type: "merge.request" } & MsgBase & { payload: { base: any, ours: any, theirs: any, threshold?: number } })
  | ({ type: "export.request" } & MsgBase & { payload: { format: "md" | "csv" | "jsonl" } })
  | ({ type: "plugins.reload" } & MsgBase & {
      payload: {
        pluginId: string,
        manifest: {
          id: string,
          version: string,
          minPlatformVersion: string,
          permissions: string[],
          dependencies: Record<string, string>,
          hooks: string[],
        },
        grantedPermissions: string[],
        dependencySnapshot: Record<string, string>,
      }
    })
  | ({ type: "log" } & MsgBase & {
      payload: {
        level: "debug"|"info"|"warn"|"error",
        message: string,
        tag?: string,
        stage?: "manifest-validation"|"compatibility-check"|"permission-gate"|"dependency-cache"|"hook-registration",
        notifyUser?: boolean,
        retryable?: boolean,
        detail?: Record<string, any>,
      }
    })
  | ({ type: "gen.request" } & MsgBase & { payload: { prompt: string, opts?: Record<string, any> } }) // 将来
```

### 4.2 Extension → Webview
```ts
type ExtToWv =
  | ({ type: "bootstrap" } & MsgBase & { payload: { doc: any, settings: Record<string, any> } })
  | ({
      type: "snapshot.result"
    } & MsgBase & {
      payload:
        | { ok: true; bytes: number; lastSuccessAt: string; generation: number; retainedBytes: number }
        | { ok: false; error: { code: string; message: string; retryable: boolean; details?: any } }
    })
  | ({ type: "fs.read.result" } & MsgBase & { ok: boolean, dataBase64?: string, error?: any })
  | ({ type: "fs.list.result" } & MsgBase & { ok: boolean, entries?: string[], error?: any })
  | ({ type: "merge.result" } & MsgBase & { ok: boolean, result?: any, trace?: any, error?: any })
  | ({ type: "export.result" } & MsgBase & { ok: boolean, uri?: string, durationMs?: number, error?: { code: string, message: string, retryable: boolean, nextBackoffMs?: number } })
  | ({
      type: "status.autosave"
    } & MsgBase & {
      payload: {
        state: "disabled" | "dirty" | "saving" | "saved" | "error" | "backoff"
        phase: "disabled" | "idle" | "debouncing" | "awaiting-lock" | "error"
        retryCount: number
        lastSuccessAt?: string
        pendingBytes?: number
        guard: {
          featureFlag: { value: boolean; source: "env" | "workspace" | "localStorage" | "default" }
          optionsDisabled: boolean
        }
      }
    })
  | ({ type: "plugins.lifecycle" } & MsgBase & { payload: { pluginId: string, action: "invoked"|"completed"|"failed", durationMs: number, sandboxViolation?: boolean } })
  | ({ type: "gen.chunk" } & MsgBase & { payload: { text: string } })   // 将来
  | ({ type: "gen.done" } & MsgBase )
  | ({ type: "gen.error" } & MsgBase & { error: { code: string, message: string } })
  | ({ type: "error" } & MsgBase & { error: { code: string, message: string, details?: any } })
```
> **Base64**: バイナリは `Uint8Array` ⇄ base64 に相互変換。テキストJSONはUTF-8。

## 5. 代表シーケンス（時系列）

### 5.1 エディタ起動（resolveCustomTextEditor）
```
Extension: create WebviewPanel (CSP/nonce 設定)
Extension → Webview: "bootstrap" {doc, settings}
Webview   → Extension: "ready" {uiVersion}
Webview   ：描画、state復元、保存インジケータ=○
```

### 5.2 編集→AutoSave→保存完了
```
Webview   ：編集開始 → dirty
Webview   ：デバウンス(~500ms)、アイドル(~2s)
Webview → Extension: "snapshot.request" {storyboard, pendingBytes, guard, queuedGeneration}
Extension ：Web Lock→`.lock` 取得 / atomicWrite(tmp→rename) / history FIFO (20世代/50MB)
Extension → Webview: "status.autosave" {phase:"A-2", bridgePhase:"status.autosave", payload:{state:"saving", phase:"awaiting-lock", pendingBytes, retryCount:0}}
Extension → Webview: "snapshot.result" {phase:"A-2", bridgePhase:"snapshot.result", payload:{ok:true, generation, retainedBytes, lastSuccessAt}}
Extension → Webview: "status.autosave" {phase:"A-2", bridgePhase:"status.autosave", payload:{state:"saved", phase:"idle", lastSuccessAt}}
Extension ：フォールバックで `.lock` を使用した場合は `warn(autosave.lock.fallback)` を Collector へ送信（details に `correlationId`/`strategy` を含む）
```

### 5.3 精緻マージ（3-way）
```
Webview → Extension: "merge.request" {base,ours,theirs,threshold}
Extension: core.merge 実行 → trace出力
Extension → Webview: "merge.result" {ok:true,result,trace}
Webview   ：UIへ反映、採用/衝突分岐

- `trace.summary.threshold` は VS Code 設定 `conimg.merge.threshold`（存在する場合）をフェーズ別のクランプ後に反映し、Webview が Phase ガード UI を同期できるようにする。【F:src/platform/vscode/merge/bridge.ts†L1-L67】
- `trace.summary.autoAdoptionRate` は `result.trace.decisions` で `decision='auto'` の件数比を示し、Collector が 80% 監視を行う指標とする。【F:src/lib/merge.ts†L204-L237】【F:docs/design/extensions/telemetry.md†L24-L35】
- `trace.decisions[]` には各ハンクの `hunkId`・`decision`・`similarity`・`threshold` を格納し、`DiffMergeView` のタブ露出率計測と Phase B ロールアウト検証に再利用する。【F:src/lib/merge.ts†L204-L237】【F:src/components/DiffMergeView.tsx†L25-L52】
```

### 5.4 Export（MD/CSV/JSONL）
```
Webview → Extension: "export.request" {format}
Extension: 正規化→ファイル生成→Uri返却 (`uri` + `normalizedUri`)
Extension → Webview: "export.result" {ok:true, uri, normalizedUri}
```

## 6. エラーと再試行（方針）
- 失敗は**応答メッセージで通知**（throw禁止）。Envelope と同一 `correlationId` を保持する。
- 再試行は**指数バックオフ**（100/300/900ms）。`export.failed` / `plugins.failed` は Telemetry JSONL に `next_backoff_ms` を記録する。
- `retryable=false` の場合は Phase ガードが即座に RED 判定し、Day8 pipeline の Reporter がロールバック指示を生成する。
- `E_FS_ATOMIC` や sandbox 違反はユーザー提示＋`plugins.failed` Telemetry で rollbackTo を明示。

## 7. テレメトリ JSONL
- **スキーマ**: `schema=vscode.telemetry.v1`、Envelope は `{ event, ts, correlationId, phase, attempt, maxAttempts, backoffMs[] }`。
- **主要イベント**:
  - `status.autosave`: `{ state, debounce_ms, latency_ms, attempt }` を出力し `autosave_p95` ガードへ渡す。
  - `flag_resolution`: `{ flag, variant, source, phase, evaluation_ms }` が Analyzer のロールアウト推定に直結。
  - `merge.trace`: `{ collisions, guardrail.metric, guardrail.observed, guardrail.rollbackTo, digest }` を Analyzer が 15 分窓で評価。
  - `export.started/completed/failed`: format/runId/uri/error.retryable/next_backoff_ms を Reporter が利用。
  - `plugins.invoked/completed/failed`: pluginId/action/result/sandboxViolation を監査。sandbox 違反時は rollbackTo=`B-0` を Phase ガードへ通知。
- **再試行ポリシー**: `maxAttempts=3`、`backoffMs=[100,300,900]`。Collector は 3 回失敗で `retryable=false` として Reporter へ転送し、Day8 `03_architecture.md` の手順でロールバックする。

### 6.1 plugins.reload メッセージ契約
- Webview→Extension: `plugins.reload` 要求は manifest/権限/依存スナップショットを含む。`tag=extension:plugin-bridge` の `log` をセットで送信し、`notifyUser` の有無で UI 通知を制御する。
- Extension→Webview: `plugins.reload.result` は `ok=false` の場合でも `stages` 配列を返し、Collector ログと同期できるようにする。`retryable=true` の場合は Extension 側で指数バックオフ制御を行い、UI には通知しない。

## 7. セキュリティ境界
- Webviewは**外部fetch禁止**。ネットは拡張側ゲートのみ。
- パスは**ワークスペース配下**に制限（サンドボックス）。
- CSP/nonce必須、`eval`禁止、`postMessage`は型検証して破棄。

## 8. バージョニング
- `MsgBase.apiVersion = 1`（将来はメジャーアップで互換を切る）。
- `storyboard.json.meta.apiVersion` と**別軸**。

## 9. 相互運用の注意
- 大きな`doc`は差分送信を検討（v1.0は全量でOK）。
- ストリーミング（`gen.chunk`）は1秒あたり10回までなど**バックプレッシャ**を導入。
