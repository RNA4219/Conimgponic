# Flags Test Plan (TDD Seeds)

## 1. 対象範囲
- `src/config/flags.ts` の解決ロジック（env → localStorage → 既定値）。
- フラグ変化に応じた AutoSave ワーカー初期化と Diff Merge タブ表示のハンドシェイク。
- CLI / Node.js 実行時における `resolveFlags({ mode: 'cli' })` の分岐互換性。

## 2. ユニットテスト案
| ID | 観点 | 入力 | 期待値 |
| --- | --- | --- | --- |
| U-ENV-PRIMARY | env の値が最優先される | `VITE_AUTOSAVE_ENABLED="true"`, `localStorage.autosave.enabled="false"` | `enabled=true`, `source.autosaveEnabled='env'` |
| U-STORAGE-SECONDARY | env 未設定時は storage が利用される | env 未設定、`localStorage.merge.precision="beta"` | `precision='beta'`, `source.mergePrecision='storage'` |
| U-DEFAULT-FALLBACK | env/storage が不正値なら既定値に戻る | env/storage ともに未設定 or 不正 (`"garbage"`) | `DEFAULT_FLAGS` のスナップショットが採用される |
| U-PHASE-DERIVATION | `AutoSavePhase` の導出 | env=`true`, storage=`stable` | `phase='phase-b'` が算出される |
| U-CLI-BYPASS | CLI モードでは storage を読まない | `resolveFlags({ mode: 'cli', storage: fakeStorage })` | storage 未呼び出しをモックで検証 |

### 補助モック
- `FakeStorage`：`getItem` 呼び出しを記録し、例外注入を許可する（storage 読取エラー時の警告シナリオを検証）。
- `makeEnv()`：渡されたレコードを `Partial<Record<'VITE_AUTOSAVE_ENABLED' | 'VITE_MERGE_PRECISION', string>>` に整形。

## 3. 統合テスト案
| ID | 観点 | トリガー | 期待値 |
| --- | --- | --- | --- |
| I-AUTOSAVE-BOOT | フラグ ON で AutoSave が起動 | `resolveFlags()` で `enabled=true` → `initAutoSave()` を呼び出す | AutoSave が OPFS 書き込み前に Web Lock を取得し、`disabled=false` で実行される（`autosave.enabled=false` 時は no-op）。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L5-L37】 |
| I-AUTOSAVE-OFF | フラグ OFF で手動保存のみ | `resolveFlags()` の結果 `enabled=false` | `initAutoSave()` を呼ばず、既存保存ショートカットがそのまま動作。既存 UI の動線は維持される。 | 
| I-MERGE-TAB-TOGGLE | `merge.precision` の切替で Diff Merge タブ表示が変化 | `precision`=`legacy`→`beta/stable` に変更 | `MergeDock` の Diff Merge タブが Phase B で有効化され、既存タブ構成の順序は不変。【F:docs/CONFIG_FLAGS.md†L24-L47】 |
| I-MERGE-BACKCOMPAT | 既定 `legacy` 維持時は UI 不変 | 既定値のまま | `MergeDock` が従来タブのみを描画し、`beta`/`stable` オプションが非表示。 | 
| I-TELEMETRY-SNAPSHOT | CLI での設定ダンプ互換性 | `resolveFlags({ mode: 'cli' })` | JSON 出力が既存 Collector パイプライン（Day8 参照）と互換であり、source 情報は含めつつ構造は変更しない。【F:Day8/docs/day8/design/03_architecture.md†L1-L31】 |

## 4. TDD 実行順序
1. `U-ENV-PRIMARY` で env 優先ロジックを固定。
2. `U-STORAGE-SECONDARY`・`U-DEFAULT-FALLBACK` でストレージ／既定値経路を実装。
3. `U-PHASE-DERIVATION` と `U-CLI-BYPASS` で派生値と分岐を固める。
4. 統合テスト `I-AUTOSAVE-BOOT` → `I-MERGE-TAB-TOGGLE` をシナリオ通りに通し、`I-TELEMETRY-SNAPSHOT` を最後に実施。

## 5. 注意点
- AutoSave 側の副作用（Web Lock, OPFS）は `docs/AUTOSAVE-DESIGN-IMPL.md` の不変条件に従い、フラグ OFF 時は副作用が発生しないことを assertion する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L5-L37】
- Diff Merge UI の表示・非表示は Phase 管理の要なので、DOM テストではタブの順序とアクセシビリティラベルまで検証する。
- `FlagSnapshot.source` をスナップショットとして保存し、後方互換性の確認に活用する。
