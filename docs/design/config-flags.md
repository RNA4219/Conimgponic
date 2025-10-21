# Config Flags 設計メモ

## 1. 目的
- AutoSave / Diff Merge を段階的に公開するため、フラグ値の解決と伝播を一箇所に集約する。
- `docs/CONFIG_FLAGS.md` に定義された優先順位と既定値をコードへ同期し、誤差が生じた際はレビューで検出できるようにする。【F:docs/CONFIG_FLAGS.md†L1-L90】
- AutoSave モジュールの不変条件や保存ポリシー、UI 表示要件との整合を担保する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L5-L37】
- Day8 パイプラインへ出力する CLI/Telemetry の JSON 互換を維持し、Collector→Analyzer→Reporter への影響を遮断する。【F:Day8/docs/day8/design/03_architecture.md†L1-L31】

## 2. モジュール構成
```
src/config/
  ├─ index.ts          # 既存 env / localStorage ラッパー（OLLAMA_BASE など）
  ├─ flags.ts          # 新規: resolveFlags() / useFlags()
  └─ __tests__/...     # resolveFlags のユニットテスト
```
- 既存の `src/config/flags.ts`（boolean 型のみ）は廃止予定。新設モジュールの導入段階で、旧 API の `resolveFeatureFlag` 互換関数を一時的に残しつつ deprecate メッセージを付与する。
- `flags.ts` は `DEFAULT_FLAGS` を内包し、`docs/CONFIG_FLAGS.md` と同一 JSON をエクスポートするチェックを CI に追加する（別タスク）。

## 3. 公開 API（案）
```ts
export interface FlagSnapshot {
  autosave: { enabled: boolean; phase: 'phase-a' | 'phase-b' | 'disabled' };
  merge: { precision: 'legacy' | 'beta' | 'stable' };
  source: {
    autosaveEnabled: 'env' | 'storage' | 'default';
    mergePrecision: 'env' | 'storage' | 'default';
  };
}

export interface FlagInputs {
  env?: Partial<Record<'VITE_AUTOSAVE_ENABLED' | 'VITE_MERGE_PRECISION', string | undefined>>;
  storage?: Pick<Storage, 'getItem'>;
  defaults?: typeof DEFAULT_FLAGS;
  mode?: 'browser' | 'cli';
}

export function resolveFlags(inputs?: FlagInputs): FlagSnapshot;
export function getFlagSnapshot(): FlagSnapshot; // memoized, throws before init
export function useFlagSnapshot(): FlagSnapshot; // React hook (App.tsx)
export function subscribeFlags(listener: (next: FlagSnapshot) => void): () => void;
```
- `resolveFlags` は `env → localStorage → defaults` の順に評価し、`FlagSnapshot.source` に決定経路を残す。`mode='cli'` のときは storage をスキップする。
- `subscribeFlags` は Phase B のホットリロードを見据えた API。初期実装では storage 変更検知を持たないが、差分検出イベントを注入することで後方互換を保つ。

## 4. `src/config/index.ts` との依存性
- `getFlagSnapshot()` 初期化時に `src/config/index.ts` の副作用（`localStorage` 参照、`import.meta.env` 参照）を横取りしない。`index.ts` の現状は `OLLAMA_BASE` などを即時評価する軽量関数であり、後方互換のため呼び出し順序を維持する。【F:src/config.ts†L1-L8】
- `src/config/index.ts` からは `export { DEFAULT_FLAGS }` のみを再エクスポートしない。責務分離のため `flags.ts` 単体で import する。
- 将来的に `src/config/index.ts` へ `FlagSnapshot` を透過させる場合も、既存の `OLLAMA_BASE` API 形状（同期的関数）を崩さない。

## 5. コンシューマ API 形状
### App.tsx
```ts
const flags = useFlagSnapshot();
useEffect(() => {
  if (!flags.autosave.enabled) return;
  bootstrapAutoSave(flags.autosave, {/* options */});
}, [flags.autosave]);
```
- AutoSave の起動条件と保存ポリシーは `docs/AUTOSAVE-DESIGN-IMPL.md` に基づき、`enabled=false` 時は一切の副作用を発生させない。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L5-L37】
- 既存の手動保存ショートカットや `setOllamaBase` は変更せず、`useFlagSnapshot()` で得たフェーズ情報をテレメトリへ送出するのみ。【F:src/App.tsx†L1-L79】

### MergeDock.tsx
```ts
const { merge } = useFlagSnapshot();
const showDiffTab = merge.precision !== 'legacy';
```
- `precision='legacy'` の場合は現行タブ構成（Compiled/Shot/Assets/Import/Golden）を保持する。`beta`/`stable` の場合のみ Diff Merge タブと `pref='diff-merge'` を有効化する。【F:src/components/MergeDock.tsx†L1-L89】【F:docs/CONFIG_FLAGS.md†L24-L47】
- タブ表示切替時にはアクセシビリティラベルと順序を保持し、テレメトリ（Collector）へは既存スキーマで通知する。【F:Day8/docs/day8/design/03_architecture.md†L1-L31】

## 6. 後方互換性
- 旧 `localStorage` キー（`autosave.enabled`, `merge.precision`, `dockOpen`）はそのまま読み取る。未設定時に限り `flag:` プレフィックスへ移行する。
- `resolveFeatureFlag`（旧 API）は `resolveFlags` のラッパーとして残し、deprecated JSDoc を追加する。削除時期は Phase B-1 のリリースノートで告知。
- CLI/JSON 出力は Day8 の Collector が期待するキー名を維持し、`source` 情報はメタデータとして別フィールドに出力する。

## 7. レビュー用チェックリスト
- [ ] `DEFAULT_FLAGS` が `docs/CONFIG_FLAGS.md` と byte-to-byte で一致している。
- [ ] `resolveFlags()` のユニットテストが env/storage/default の三経路と CLI モードを網羅している。
- [ ] AutoSave 初期化テストで `enabled=false` の際に副作用が起きていない。
- [ ] MergeDock のタブ構成スナップショットが `legacy` のまま安定している。
- [ ] Telemetry/CLI 出力が既存 JSONL 契約と互換である（Day8 ドキュメント参照）。

## 8. ゲートコマンド
```bash
# フラグ解決ユニットテスト
pnpm exec node --test tests/config/flags.resolve.test.ts

# AutoSave 連携統合テスト
pnpm exec node --test tests/autosave/flags.integration.test.ts

# MergeDock 表示スナップショット
pnpm exec node --test tests/merge/flags.ui.test.ts
```
- 将来的に `pnpm` スクリプトへ昇格させる場合も、各コマンドは Node.js 標準テストランナーを利用する方針を維持する（ESM 構成を共有するため）。
