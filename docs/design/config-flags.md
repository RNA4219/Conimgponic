# Config Flags 設計メモ

## 1. 背景と目的
- `docs/IMPLEMENTATION-PLAN.md` §0.2 の設定ソースマッピングに従い、`src/config/flags.ts` で `env → localStorage → docs/CONFIG_FLAGS.md` の優先順位を集約する。【F:docs/IMPLEMENTATION-PLAN.md†L10-L46】
- AutoSave (`App.tsx`) と Diff Merge (`MergeDock.tsx`) の公開を段階導入し、既存 UI 動線・CLI/JSON 出力を後方互換で維持する。【F:docs/IMPLEMENTATION-PLAN.md†L5-L18】【F:docs/CONFIG_FLAGS.md†L24-L90】
- Flag 変更イベントをテレメトリへ伝搬し、Day8 パイプライン（Collector→Analyzer→Reporter）の JSONL 契約を維持する。【F:Day8/docs/day8/design/03_architecture.md†L1-L31】

## 2. データフロー
```mermaid
graph TD
  App[App.tsx bootstrap] -->|useFlagSnapshot()| Resolver(resolveFlags)
  Merge[MergeDock.tsx bootstrap] -->|useFlagSnapshot()| Resolver
  Resolver -->|envKey| Env(import.meta.env)
  Resolver -->|storageKey| Storage(localStorage)
  Resolver -->|defaults| Defaults(DEFAULT_FLAGS from docs/CONFIG_FLAGS.md)
  Defaults -.->|docs/CONFIG_FLAGS.md| Spec
  Resolver --> Snapshot(FlagSnapshot with source metadata)
  Snapshot -->|autosave.enabled| AutoSaveRunner(AutoSave bootstrap)
  Snapshot -->|merge.precision| MergeUI(Diff Merge visibility)
  Snapshot -->|emit| Bus(FlagSubscriberBus)
```
- `FlagSnapshot` は各フラグ値と決定ソース (`'env' | 'localStorage' | 'default'`) を保持し、後方互換のため `localStorage` 直接参照と同値比較できるようにする。
- `Bus` は Phase B でのホットリロード検討に備え、`subscribeFlags` 経由で差分通知（`prev`/`next`）を送出する。
- `docs/IMPLEMENTATION-PLAN.md` §0.2 の優先順位（env → localStorage → 既定値）と `FlagSnapshot.source.*` を 1 対 1 に対応させ、`App.tsx`・`MergeDock.tsx` が段階的に後方互換参照を除去できるようマッピングを固定する。【F:docs/IMPLEMENTATION-PLAN.md†L19-L46】

## 3. API 仕様案 (`src/config/flags.ts`)
```ts
export type FlagSource = 'env' | 'localStorage' | 'default';

export interface FlagSnapshot {
  readonly autosave: { readonly enabled: boolean };
  readonly merge: { readonly precision: 'legacy' | 'beta' | 'stable' };
  readonly source: {
    readonly autosaveEnabled: FlagSource;
    readonly mergePrecision: FlagSource;
  };
  readonly resolvedAt: number; // Date.now()。UI 側でメトリクス相関を取る
}

export interface FlagResolveOptions {
  readonly env?: Partial<Record<'VITE_AUTOSAVE_ENABLED' | 'VITE_MERGE_PRECISION', unknown>>;
  readonly storage?: Pick<Storage, 'getItem'> | null;
  readonly defaults?: typeof DEFAULT_FLAGS;
  readonly mode?: 'browser' | 'cli';
}

export interface FlagSubscriber {
  (next: FlagSnapshot, diff: { readonly autosaveChanged: boolean; readonly mergeChanged: boolean }): void;
}

export declare const DEFAULT_FLAGS: {
  readonly autosave: { readonly enabled: false };
  readonly merge: { readonly precision: 'legacy' };
};

export function resolveFlags(options?: FlagResolveOptions): FlagSnapshot;
export function getFlagSnapshot(): FlagSnapshot; // 初回呼出し前は FlagResolutionError を送出
export function useFlagSnapshot(): FlagSnapshot; // React hook, strict mode 二重呼出し対応
export function subscribeFlags(listener: FlagSubscriber): () => void; // 解除関数を返却
export function resolveFeatureFlag(name: 'autosave.enabled' | 'merge.precision', options?: FlagResolveOptions): {
  readonly value: boolean | 'legacy' | 'beta' | 'stable';
  readonly source: FlagSource;
  readonly resolvedAt: number;
};
```
- `DEFAULT_FLAGS` は `docs/CONFIG_FLAGS.md` に定義された JSON を `as const` で埋め込み、CI の snapshot で乖離検知する（別タスク）。
  - 初期値: `autosave.enabled=false`, `merge.precision='legacy'`。
  - `localStorage` キーは `autosave.enabled` / `merge.precision` を継承し、Phase B で `flag:` プレフィックスへ移行する。
- `mode='cli'` の場合は `storage` を強制無視し、Node 実行（`pnpm run flags:*`）との互換性を確保する。
- 旧 `resolveFeatureFlag` API はラッパーとして残し、Phase B-1 までに削除通知を出す。

## 4. `FlagResolutionError` と例外設計
- 不正値（例: `VITE_MERGE_PRECISION=unknown`）や JSON 既定値の欠損時は `FlagResolutionError` を送出し、`code` と `retryable` を明示する。
  ```ts
  export type FlagResolutionErrorCode = 'invalid-value' | 'defaults-missing';
  export class FlagResolutionError extends Error {
    readonly code: FlagResolutionErrorCode;
    readonly retryable: boolean; // retryable=false なら UI でフェイルクローズ
  }
  ```
- `retryable=true` のケース（`localStorage` 読取失敗など）は UI で再試行（例: `subscribeFlags` 再呼出し）を可能にする。`retryable=false` はフェイルセーフ（AutoSave 非起動 / Diff Merge 非表示）。
- 既存 `ProjectLockError` と同様に `name` を固定し、`cause` を保持することで Day8 テレメトリへシリアライズ可能にする。【F:src/lib/locks.ts†L63-L87】

## 5. `src/config.ts`（旧 `index.ts` 相当）との互換性
- `OLLAMA_BASE` など既存同期 API の初期化順序を変更しない。`flags.ts` はデフォルト輸出せず、利用側は明示的に import する。【F:src/config.ts†L1-L8】
- `flags.ts` で `localStorage` をアクセスする際は lazy 評価（呼出し時）に限定し、`App.tsx` 既存ロジックと衝突しないよう `try/catch` で囲う。
- `setOllamaBase` など既存セッターに副作用を追加しない。Flag 値を `localStorage` に書き込む CLI/Runbook は別途 `scripts/flags/*.ts` が担う。

## 6. コンシューマ利用パターンとインターフェース整合
### 6.1 `App.tsx`
- `useFlagSnapshot()` で初回スナップショットを取得し、`autosave.enabled` が `true` のときのみ AutoSave ブートストラップ (`bootstrapAutoSave(flags.autosave)`) を非同期実行する。
- Flag 変更時（`subscribeFlags`）に AutoSave ワーカーへ `lease` 状態を伝播し、`enabled=false` へ戻った場合はワーカー終了と UI インジケータ停止を保証する。
- 既存キーバインド・手動保存フローを不変とし、Flag が `false` のときは副作用（`setInterval`、ロック取得）を作らない。【F:src/App.tsx†L1-L79】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L5-L37】
- 依存ポイント: `App.tsx` は `localStorage.dockOpen` をブート時に同期し、`setDockOpen` トグル時に書き戻している。Flag 運用開始時は `resolveFlags()` から得た `source.autosaveEnabled` をログへ出力するだけに留め、`localStorage` 直読みは Phase B まで維持する。【F:src/App.tsx†L26-L65】

### 6.2 `MergeDock.tsx`
- `const { merge } = useFlagSnapshot(); const showDiff = merge.precision !== 'legacy';` を起点に Diff Merge タブ表示可否を制御する。
- `beta`/`stable` 時は Diff Merge タブを追加し、既存タブ順序とアクセシビリティラベルを維持する。`legacy` 時は現在の 5 タブ構成を保つ。【F:docs/IMPLEMENTATION-PLAN.md†L23-L31】
- Flag 変更時は開いているタブが非表示になる場合に `Golden` タブへフォールバックし、テレメトリへ `merge.precision` のソース情報を付与する。
- 依存ポイント: 現状は `pref` state と `useMemo` のみで `localStorage` に依存しないため、Flag 導入後も UI の表示制御のみを `FlagSnapshot` に委譲する。`localStorage` から `pref` を復元する将来要件が発生した場合は `flags.ts` を経由する。

### 6.3 `localStorage` 後方互換撤廃ステップ
1. Phase A（現状）: `App.tsx` は `localStorage` の `dockOpen` を読み書きしつつ、`resolveFlags()` から得た `source` 情報をテレメトリに転送する。`MergeDock.tsx` は現行ロジック維持。
2. Phase A-2: `src/config/flags.ts` に `getLegacyStorageItem(key)` を追加し、`App.tsx` の初期読取を `flags.ts` へ委譲。`setDockOpen` は互換性のために書き戻し継続。
3. Phase B-0: `dockOpen` の保存先を `flag:dock.open`（仮）へ移行し、`App.tsx` の直接 `localStorage` 書込を `flags.ts` のヘルパにリダイレクトする。旧キーを読み取った場合はヘルパが新キーへ移行し、UI からの直接参照を削除。
4. Phase B-1: QA 完了後に `App.tsx` の `localStorage` 呼び出しを全面削除し、`FlagSnapshot` ベースの状態同期に統合。`MergeDock.tsx` については `flag:merge.precision` が安定するまで現状維持。

### 6.3 Day8 依存構造との整合
- Flag 変更イベントは `Collector → Analyzer → Reporter` の ETL に影響しないよう JSONL スキーマを不変で維持し、ソース情報は追加フィールドとして伝搬する。【F:Day8/docs/day8/design/03_architecture.md†L1-L31】
- AutoSave/差分マージのテレメトリは既存 Day8 パイプラインの監視周期（15 分単位）と整合させ、`reports/` 生成プロセスへ副作用を持ち込まない。【F:docs/IMPLEMENTATION-PLAN.md†L66-L83】
- `subscribeFlags` が UI 層のみで完結し、`workflow-cookbook/` 配下の Analyzer スクリプトへ直接依存しないことで Day8 の責務分離を保つ。

## 7. フラグ変化テスト観点（TDD ケース）
| ID | シナリオ | 期待挙動 | テスト種別 |
| --- | --- | --- | --- |
| A1 | `autosave.enabled=false`（既定値）で初期化 | AutoSave ワーカー未起動、ロック取得なし、UI インジケータ非表示 | Node unit (`tests/autosave/flags.disabled.test.ts`) |
| A2 | Env `VITE_AUTOSAVE_ENABLED=true` → Flag 解決 | AutoSave ブート起動、`source.autosaveEnabled='env'` | Node unit + React hook (`tests/autosave/flags.enabled-env.test.ts`) |
| A3 | Storage 切替 (`localStorage.autosave.enabled` トグル) | `subscribeFlags` で差分検知し、AutoSave ワーカー開始/停止を即時反映 | Integration (`tests/autosave/flags.toggle.test.ts`) |
| A4 | 無効値（`VITE_AUTOSAVE_ENABLED=foo`） | `FlagResolutionError{code:'invalid-value', retryable=false}`、AutoSave 未起動 | Unit |
| M1 | `merge.precision=legacy` | Diff Merge タブ非表示、既存タブ順序 Snapshot 一致 | React UI snapshot (`tests/merge/flags.legacy.test.ts`) |
| M2 | Env `VITE_MERGE_PRECISION=beta` | Diff Merge タブ表示、アクセシビリティラベル保持、`source.mergePrecision='env'` | React UI + accessibility |
| M3 | Storage 値 `stable` へ更新 | `subscribeFlags` 経由でタブ表示更新、既存タブ state を `Golden` へフォールバック | Integration |
| M4 | 無効値（`localStorage.merge.precision='ga'`） | `FlagResolutionError{code:'invalid-value', retryable=true}` → 再試行待ち、Diff Merge 非表示 | Unit |
| C1 | CLI モード (`mode='cli'`) | Storage を読まず既定値採用、`source.*` が `'default'` になる | Node unit |
| C2 | Flag Snapshot 連続取得 | メモ化が働き、再解決が発生しないことを `Symbol.for('nodejs.util.inspect.custom')` 等で検証 | Unit |

- 各テストは **先に失敗テストを実装 → 実装 → リファクタ** の順で TDD を徹底する。
- テストデータは `docs/CONFIG_FLAGS.md` の既定値 JSON を fixture 化し、後方互換検証を容易にする。
- フラグ ON/OFF・既定値フォールバックの検証を優先するため、`tests/config/flags.resolve-default.test.ts`（`resolveFlags` のデフォルト経路）、`tests/config/flags.source-order.test.ts`（env/storage/default の優先順位）を追加し、CI で Phase A から監視する。

## 8. 回帰リスクと緩和策
- AutoSave 起動フロー: フラグ OFF 時に余計なロック取得・setInterval が走ると OPFS 競合や Day8 Collector の監視対象外ログ増加リスクがあるため、`autosave.enabled=false` ケースのユニットテスト（A1）でブート抑止を検証する。【F:docs/IMPLEMENTATION-PLAN.md†L10-L18】【F:docs/AUTOSAVE-DESIGN-IMPL.md†L5-L37】
- Diff Merge 表示: `merge.precision=legacy` でタブ構造が変化すると既存 QA 手順が崩れるため、UI スナップショット（M1）でタブ順序・アクセシビリティ属性を固定する。【F:docs/IMPLEMENTATION-PLAN.md†L23-L31】
- フラグソース整合性: Env/Storage の値が不正なまま UI に伝搬すると Day8 ETL のエラー判定と乖離するため、`FlagResolutionError` を通じて再試行可否を識別し、`retryable` 判定でフェイルセーフへ倒す。【F:docs/IMPLEMENTATION-PLAN.md†L32-L46】

## 9. 後方互換ポリシー
- 既存 `localStorage` 直接参照は `FlagSnapshot.source` で決定ソースを報告しながら段階的に排除し、既存 UI のデバッグ手順を維持する。【F:docs/IMPLEMENTATION-PLAN.md†L32-L46】
- CLI/JSON 出力は `mode='cli'` オプションで Storage を無視し既定値へフォールバックすることで、Day8 パイプラインおよび既存スクリプトとの互換性を担保する。【F:docs/IMPLEMENTATION-PLAN.md†L66-L83】
- `docs/CONFIG_FLAGS.md` に定義された既定値を `DEFAULT_FLAGS` へインライン化し、Snapshot テストで乖離検知するまで UI/API の挙動変更を禁止する。

## 10. 移行・運用メモ
- 既存 `localStorage` キー（`autosave.enabled`, `merge.precision`, `dockOpen`）を読み取った後、新規 `flag:` プレフィックスへ書き戻す移行処理は追跡タスクで別実装とする。
- `pnpm run flags:status` など運用スクリプトは `resolveFlags({ mode: 'cli' })` を利用し、ブラウザ依存を排除する。【F:docs/IMPLEMENTATION-PLAN.md†L66-L83】
- テレメトリは `autosave.flag.source` / `merge.flag.source` を追加フィールドとして送信し、既存 JSONL スキーマを変更しない。
