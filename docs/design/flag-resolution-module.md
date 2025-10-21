# フラグ解決モジュール設計（src/config/flags.ts）

## Task Seed
### Objective
- env → localStorage → 既定値の優先順位でフラグを正規化し、`FlagSnapshot` 経由で AutoSave・精緻マージ機能の段階導入を制御する。

### Scope
- In: `src/config/flags.ts`, フラグ既定値 JSON, `App.tsx` と `MergeDock.tsx` のフラグ読取ロジック。
- Out: フラグ更新 CLI、既存ローカルストレージ直接操作の段階的撤廃。

### Requirements
- Behavior: env → localStorage → 既定値の優先順位で決定し、ソース種別付き `FlagSnapshot` を返却。
- I/O Contract: 入力は env / storage 値、出力は厳密型付けされた `FlagSnapshot`。リゾルバは副作用なし。
- Constraints: 既存 UI 動線を変えず、後方互換のためローカルストレージ直読を段階的に退避。
- Acceptance Criteria: 状態遷移、エラー処理、TDD シナリオ（typecheck / node:test / eslint）を設計ドキュメントで網羅。

### Commands
1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test`

## 設計メモ
### 1. 解決責務とデータフロー
- `resolveFlagDefinitions(defs, options)`（新設）で複数定義を一括評価し、`FlagSnapshot` を生成。
- 優先順位: `import.meta.env` → `localStorage`（`Storage` 抽象）→ `DEFAULT_FLAGS`。既存 `resolveFlag` は薄いラッパーに維持し後方互換。
- `FlagSnapshot` は AutoSave と Merge の両セクションを保持し、各値に対応する `source` メタを同梱。
- `App.tsx` / `MergeDock.tsx` では `useFlagSnapshot()`（新設フック）を用い、`FlagSnapshot` 経由で UI へ伝播。直接 `localStorage` を参照する箇所を置換し、段階導入フラグに集約。

### 2. 型・状態管理
- `FlagSnapshot` 拡張: `{ autosave: { enabled: boolean; phase: 'disabled' | 'phaseA' | 'phaseB' }, merge: { precision: 'legacy' | 'beta' | 'stable' } }`。
- `source` マップは `Record<FlagPath, FlagSource>` とし、`FlagPath` は `'autosave.enabled' | 'autosave.phase' | 'merge.precision'`。
- Snapshot は不変（`Readonly`）で、`flags.ts` 以外からの直接編集を禁止。更新は `emitSnapshot(next)` のみ。
- 状態遷移: AutoSave → `disabled`（フラグ false）→ `phaseA`（env/localStorage で true, phase=pilot）→ `phaseB`（精緻マージ安定化後）。Merge 精緻度は `'legacy'` → `'beta'` → `'stable'`。

### 3. エラー処理とフォールバック
- env 値が不正（`coerce` 失敗）時は `FlagResolutionError`（再試行不可）を投げ、呼出し側で `reporter.error` による単行ログ記録（`docs/AUTOSAVE-DESIGN-IMPL.md` 既定に準拠）。
- Storage 取得が `DOMException` で失敗した場合は `retryable=true` の `FlagResolutionError` を返却し、次回再評価で復旧。
- 例外発生時は `default` ソースにフォールバックし、`source` を `'default'`、`origin` メタに `error` を保持。UI では警告バナーのみ表示（UI 動線不変）。

### 4. CLI と既存ローカルストレージ操作の整理
- `scripts/flags/set-flag.ts`（仮）で `pnpm flags set autosave.enabled true` を追加。`Storage` 直書きは CLI を経由する形へガイド。
- 既存ローカルストレージ操作は `useFlagSnapshot` 内部で `storageAdapter.write` を介して段階的に移行し、`FlagSnapshot` を再発行。

### 5. テスト戦略
- TDD: `tests/config/flags.test.ts` で env/Storage/default 優先順位、エラー時フォールバック、`source` メタ付与を先に実装。
- Type: `pnpm typecheck` で `FlagSnapshot` の strict typing を検証。
- Lint: `pnpm lint` で import 並び・不変性を確認。
- UI: `node:test` による `useFlagSnapshot` hooks テストで `App.tsx` / `MergeDock.tsx` への影響を最小化。

## テストケース一覧
1. env 値が存在する場合に `source='env'` で `FlagSnapshot.autosave.enabled` が true になる。
2. env 不在で localStorage に保存済みなら `source='localStorage'` が選択される。
3. 両方不在の場合 `default` が適用され、`source='default'`。
4. env 解析失敗時に `FlagResolutionError` を捕捉し、`source='default'` + `origin='error'` が付く。
5. Storage 例外時に `retryable=true` のエラーを返却し再評価で復旧する。
6. `useFlagSnapshot` が `App.tsx` と `MergeDock.tsx` 双方に同一スナップショットを供給し UI 挙動が変わらない。
