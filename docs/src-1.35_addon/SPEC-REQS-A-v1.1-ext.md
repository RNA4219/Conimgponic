# Conimgponic 要件定義（A案 / 1人×1か月）

## 0. 背景と目的
- 目的：**テキスト主導のストーリーボード（コンテ）**を高速・再現性・安全性で実現する開発プラットフォーム。
- 方針：**Conimg（UI/ロジック）は独自**、Code‑OSS は**ホスト（拡張APIに限定）**。本体はゼロパッチ（無改造または `product.json` 程度）。
- IDE×LLM連携は後段（受け口だけ定義）。

## 1. スコープ（本フェーズ完了時）
- **Conimg拡張（VSIX）**：CustomEditor + Webview（React/Vite）／※v1.0はPWA、移行前提で設計
- **UI 3ペイン**：左=手入力、右=生成ライン（今はモック）、下=統合
- **高度レイアウト 4種**：グリッド／モザイク／タイムライン／カンバン（仮想化＋D&D＋Undo/Redo）
- **AutoSave**：デバウンス、世代ローテ（N=20/50MB）、アトミック書換（tmp→rename）、復旧UI
- **精緻マージ**：3‑way、しきい値、証跡JSON（hunks/decision/similarity）
- **Export/Import**：MD/CSV/JSONL 正規化、**Package Export**（`.imgponic.json`）
- **テンプレ／アセット管理**：`templates.json` / `assets.json`（Snippets同期は受け口のみ）
- **Conimg独自プラグイン v1**：hooks・権限・隔離（UIウィジェット簡易）
- **将来接続の受け口**：`platform.ts`（FS/設定/ダイアログ/ネット）とWebviewメッセージ仕様

### 非スコープ（後段）
- 実LLM呼び出し（llm_orch/llm‑adapter）、Open VSX 公開、Snippets双方向同期の完成形、クラウド同期、モバイル最適化、画像/サムネ自動生成。

## 2. 想定ユーザー・環境
- ユーザー：映像/動画AIの**コンテ設計者**・個人制作者
- OS：Windows / macOS / Linux（Code‑OSS互換エディタ上）
- ネット：**オフライン既定**（LLMは後段で任意）
- 配布：`.vsix`（必要に応じ Open VSX）。**MS公式 Marketplace 非依存**
- プロジェクトは**ローカル**（ワークスペース配下）で完結

## 3. ユースケース（主要）
- UC‑01：新規プロジェクト→カード追加/削除/並べ替え/状態管理（カンバン）
- UC‑02：右ペインで下書き（モック変換）→下ペインで統合/採用
- UC‑03：AutoSave と履歴からの復旧
- UC‑04：外部差分を**精緻マージ**で取り込み、証跡を保存
- UC‑05：**MD/CSV/JSONL**へ出力、**Package Export**で打包
- UC‑06：テンプレ/語彙テンプレ適用（将来 Snippets 同期）
- UC‑07：**プラグイン**で onExport/commands/widget を差し込む

## 4. 機能要件（抜粋）
### 4.1 VS Code 統合点
- customEditor：`viewType="conimgponic.storyboard"`, `*.conimg.json` を開く
- commands：`conimg.new`, `conimg.export`, `conimg.merge`, `conimg.saveSnapshot`
- keybindings：`Ctrl+S`, `Ctrl+Shift+S`, `Ctrl+Enter`, `Ctrl+Alt+N`
- configuration：`conimg.*`（例：`conimg.autosave.enabled`, `conimg.plugins.enable`）

### 4.2 UI（3ペイン＋高度レイアウト）
- 左：手入力フォーム/Markdown、右：生成ライン（モック）、下：統合（採用/棄却/編集、しきい値）
- レイアウト：グリッド（均等）、モザイク（可変高）、タイムライン（尺→横長、ズーム/スクラブ/スナップ）、カンバン（`status`列）
- 共通：**仮想リスト**、D&D、Undo/Redo、↑↓/PgUp/PgDn

### 4.3 データ・I/O・保存
- ルート：`<workspace>/.conimgponic/`  
  - `project/storyboard.json`, `templates.json`, `assets.json`  
  - `runs/<ts>/shotlist.{md,csv,jsonl}`, `runs/<ts>/meta.json`, `runs/<ts>/merge.json`  
  - `history/<iso>.json`（AutoSave履歴 N=20 / 合計50MB上限）  
  - `state.json`（レイアウト状態 任意）  
- Package Export：`.imgponic.json`（`project/` + 直近 `runs/<ts>/meta.json`）
- Export/Import：MD/CSV/JSONL（改行・空白・CSVエスケープの**正規化**）
- AutoSave：デバウンス（~500ms）＋アイドル（~2s）、**tmp→rename**でアトミック化

### 4.4 精緻マージ
- 3‑way（Base/Ours/Theirs）、セクション分割＋LCS/類似度しきい値
- UI：自動採用/衝突、Manual/AI（AIは後段解放）、編集、しきい値スライダー
- 証跡：`runs/<ts>/merge.json`（hunks/decision/similarity/profile）

### 4.5 Conimg 独自プラグイン v1
- 配置：`<workspace>/.conimgponic/plugins/<name>/`（`conimg-plugin.json` + `index.js`）
- フック：`onCompile`, `onExport`, `onMerge`, `commands`, `widgets`
- 権限：`["fs","ui:widget"]` 等**明示**（ネットは既定禁止、将来 `net:ollama` 等）
- 実行：UI系は **WebWorker**、I/O系は**拡張側経由**（隔離/時間制限）
- 既定は**無効**、個別に有効化。セーフモード（全無効）あり

### 4.6 将来接続の受け口
- `platform.ts` I/F：`fs.*`, `settings.*`, `dialog.*`, `net.fetch`（将来は拡張側ゲートでLLM/API集中）
- Webview⇄拡張メッセージ：`snapshot.*`, `merge.*`, `gen.*`（今は `gen.*` をモックで充足）

## 5. 非機能要件（抜粋）
- 性能：初回描画<300ms（100カット）、主要操作<100ms、スクロール60FPS近傍（仮想化）
- 信頼性：AutoSave≤2.5s、履歴復旧OK、保存は**アトミック**
- セキュリティ：**Webview CSP厳格**、外部通信は既定**禁止**、SBOM/ライセンス監査をCIで実施
- 運用・配布：`.vsix`配布（必要ならOpen VSX）。Marketplace非依存。ログはローカル最小限
- 将来互換：`storyboard.json` に `meta.apiVersion` 付与、`core/` はQtへ移植可能

## 6. 受入基準（DoD）
- `*.conimg.json` を開き、**編集→保存**できる（AutoSave表示/履歴復旧OK）
- **Export/Import/Package** がゴールデン一致（正規化ルール適用）
- **精緻マージ**：サンプルで自動採用が安定、証跡JSON生成
- **高度レイアウト 4種**：100カットで快適、D&D/Undo/Redo/キーバインド可
- **プラグイン v1**：サンプル（onExport/commands/widget）が動作し、障害時も本体が落ちない
- **セキュリティ**：CSP・外部通信遮断（既定）・SBOM/監査CIが通る

## 7. ディレクトリ（推奨）
```
repo/
├─ extension/            # VS Code拡張（Node/TS）
│  ├─ src/extension.ts
│  ├─ src/panels/conimgEditor.ts
│  ├─ src/services/{fs,pluginHost}.ts
│  ├─ media/**          # Webview配布物（web/のビルド）
│  └─ package.json
├─ web/                  # Webview（React/Vite）
│  └─ src/**            # 3ペイン/レイアウト/マージUI
├─ packages/core/        # 変換/正規化/マージ/ゴールデン/seed
└─ docs/                 # 本ドキュメント・API契約・TEST計画 等
```

## 8. 付録：`platform.ts` I/F（固定案）
```ts
export interface Platform {
  fs: {
    read(uri: string): Promise<Uint8Array>
    write(uri: string, data: Uint8Array): Promise<void>
    list(dir: string): Promise<string[]>
    atomicWrite(uri: string, data: Uint8Array): Promise<void>
  }
  settings: {
    get<T>(key: string, def: T): T
    set<T>(key: string, val: T): Promise<void>
  }
  dialog: {
    open(opts: any): Promise<string[]>
    save(opts: any): Promise<string|null>
  }
  net: {
    fetch(input: RequestInfo, init?: RequestInit): Promise<Response>
  }
}
```
