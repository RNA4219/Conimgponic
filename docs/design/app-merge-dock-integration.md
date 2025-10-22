# App/MergeDock 統合設計

## 1. 目的とスコープ
- **目的**: `App.tsx` での AutoSave 初期化と `src/components/MergeDock.tsx` の Diff Merge タブ露出を `FlagSnapshot` ベースのフラグで段階制御し、既存 UX を崩さずロールアウトする。
- **スコープ**: `App.tsx`, `src/components/MergeDock.tsx`, 統合テスト（E2E）。他画面のナビゲーションは変更しない。
- **依拠文書**: AutoSave の保存ポリシー・API は [docs/AUTOSAVE-DESIGN-IMPL.md](../AUTOSAVE-DESIGN-IMPL.md) を、全体責務とデータフローは [Day8/docs/day8/design/03_architecture.md](../../Day8/docs/day8/design/03_architecture.md) を参照する。

## 2. フラグ依存の画面遷移図
`FlagSnapshot` の `autosave.enabled` と `merge.precision` により、App 初期化と MergeDock タブ構成を段階制御する。既存フローの Collector→Analyzer→Reporter 連携は [Day8/docs/day8/design/03_architecture.md](../../Day8/docs/day8/design/03_architecture.md) の責務区分を尊重し、UI でのみ分岐する。

```mermaid
digraph FlagGatedFlow {
  rankdir=LR;
  subgraph cluster_app {
    label="App.tsx";
    Flags[useFlagSnapshot()];
    AutoSaveInit[AutoSave Runner init];
    DockToggle[MergeDock mount gate];
    Flags -> AutoSaveInit [label="autosave.enabled"];
    Flags -> DockToggle [label="merge.precision"];
  }
  subgraph cluster_merge {
    label="MergeDock.tsx";
    Legacy[precision=legacy\nDiff hidden];
    Beta[precision=beta\nDiff optional];
    Stable[precision=stable\nDiff default];
  }
  DockToggle -> Legacy [label="legacy / unknown"];
  DockToggle -> Beta [label="beta"];
  DockToggle -> Stable [label="stable"];
  AutoSaveInit -> Beta [label="AutoSave snapshot\nfor backup CTA"];
  AutoSaveInit -> Stable;
}
```

- `autosave.enabled=false` の場合は AutoSave を起動せず、MergeDock でもバックアップ CTA を非表示にする（[docs/AUTOSAVE-DESIGN-IMPL.md](../AUTOSAVE-DESIGN-IMPL.md) §0)。
- `merge.precision` の 3 フェーズ（legacy/beta/stable）は [docs/MERGEDOCK-FLAG-DESIGN.md](../MERGEDOCK-FLAG-DESIGN.md) の配置方針を継承し、Diff タブの露出のみを切り替える。

## 3. 初期化シーケンス仕様
FlagSnapshot を単一ソースとして利用し、AutoSave ブートストラップと MergeDock プロップスを同期させる。AutoSave API の整合性要件は [docs/AUTOSAVE-DESIGN-IMPL.md](../AUTOSAVE-DESIGN-IMPL.md) §1〜4 を遵守する。

| 手順 | トリガー/条件 | App.tsx の挙動 | MergeDock.tsx への影響 | 備考 |
| --- | --- | --- | --- | --- |
| 1 | `App` マウント | `useFlagSnapshot()` で `FlagSnapshot` を取得。`source` メタはログ用に保持。 | - | `docs/design/config-flags.md` の優先順位 (env→localStorage→default) を踏襲。 |
| 2 | `autosave.enabled === true` | `initAutoSave(getStoryboard, options)` を非同期呼出し。`FlagSnapshot.autosave.phase` が `disabled` なら no-op。 | `useAutoSaveSnapshot()` が有効化され、Diff タブのバックアップ CTA 判定に利用。 | AutoSave のデバウンス・容量制約は [docs/AUTOSAVE-DESIGN-IMPL.md](../AUTOSAVE-DESIGN-IMPL.md) §1.1。 |
| 3 | `autosave.enabled === false` | AutoSave ランナーを起動せず `phase='disabled'` を通知。 | MergeDock 側のバックアップ CTA は常に非表示。 | Collector/Analyzer への副作用を発生させない。 |
| 4 | `merge.precision` 判定 | `FlagSnapshot.merge.precision` を `MergeDock` プロップ/コンテキストへ渡す。 | `precision=legacy`: Diff 非表示。`beta`: 末尾追加+Beta バッジ。`stable`: Diff デフォルト選択。 | タブ配列は [docs/MERGEDOCK-FLAG-DESIGN.md](../MERGEDOCK-FLAG-DESIGN.md) §3, §6 の擬似コード通り再構成。 |
| 5 | Flag 更新イベント | `useFlagSnapshot()` の再発行を検知し AutoSave ランナーを再起動/停止。 | precision 変更に応じてタブ構成を再評価し、`merge.lastTab` のフォールバックを適用。 | ロールアウト/ロールバック時の整合性を保証。 |

## 4. precision モード別 UI 導線
### 4.1 タブ構成と戻り動線
- **legacy**: Diff タブ非表示。MergeDock の既存タブ配列と初期アクティブタブ（Overview）を維持。戻り動線は既存 `merge.lastTab` のみ。
- **beta**: Diff タブを末尾に追加。初期タブは従来どおり Overview。Diff へ遷移後の戻りはタブ UI で行い、`merge.lastTab` が Diff でも `precision` を legacy に戻した瞬間に `overview` へフォールバック。
- **stable**: Diff タブを `settings` 直前へ挿入し、初期アクティブタブを Diff とする。ユーザが他タブへ戻った場合は `merge.lastTab` を更新し、次回マウント時に尊重。
- バックアップ CTA は `precision in {beta, stable}` かつ `AutoSavePhase !== 'disabled'`、`lastSuccessAt` が 5 分超過時に表示する（[docs/MERGEDOCK-FLAG-DESIGN.md](../MERGEDOCK-FLAG-DESIGN.md) §4.2）。

### 4.2 ロールバック手順
フラグ既定値を引き下げる際の UI/状態ロールバック手順を明文化する。
1. Feature flag サービスのデフォルトを `stable`→`beta` または `beta`→`legacy` に変更。
2. `FlagSnapshot` 更新イベントを検知した `App.tsx` が AutoSave 状態を再評価し、必要に応じてランナーを停止（`enabled=false` の場合）。
3. `MergeDock.tsx` は新しい precision でタブ配列を再構築し、`merge.lastTab` が Diff である場合は `overview` へフォールバックさせる。
4. QA では [docs/AUTOSAVE-DESIGN-IMPL.md](../AUTOSAVE-DESIGN-IMPL.md) §2 の状態整合性チェック（`current.json`/`index.json`）を実行し、Collector/Analyzer へのノイズがないか確認する。

## 5. 統合テスト戦略
### 5.1 E2E テストケース案
Playwright もしくは Cypress でフラグ値をモックし、App 全体の動作を検証する。AutoSave の永続化自体は OPFS モックで `flushNow` 呼び出しを確認する。

| ID | フラグ構成 | シナリオ | 期待結果 |
| --- | --- | --- | --- |
| E2E-1 | `autosave.enabled=false`, `merge.precision='legacy'` | App 起動→MergeDock 表示 | AutoSave 初期化がスキップされ、Diff タブが DOM に存在しない。 |
| E2E-2 | `autosave.enabled=true`, `merge.precision='beta'` | App 起動後 Diff タブ選択 | AutoSave runner が起動し、Diff タブ末尾に `Beta` バッジ付きで表示。バックアップ CTA は `lastSuccessAt>5min` の場合のみ露出。 |
| E2E-3 | `autosave.enabled=true`, `merge.precision='stable'` | 初期ロード | 初期アクティブタブが Diff。`flushNow()` をモックして CTA 押下時に呼ばれることを確認。 |
| E2E-4 | precision `stable` → `legacy` にロールバック | フラグ変更イベントをシミュレート | タブが再描画され Diff 非表示、AutoSave runner は継続（enabled=true のまま）。`merge.lastTab` が `overview` に戻る。 |
| E2E-5 | autosave フラグ OFF → ON | `autosave.enabled` トグル | ランナー停止→再起動が発生し、`snapshot().phase` が `disabled`→`idle` に遷移。MergeDock CTA の表示状態が同期する。 |

### 5.2 監視と回帰チェック
- AutoSave 書き込み整合性は E2E 後に `current.json`/`index.json` の存在と整合を検証し、[docs/AUTOSAVE-DESIGN-IMPL.md](../AUTOSAVE-DESIGN-IMPL.md) §0 の不変条件を守る。
- Collector→Analyzer→Reporter へのログノイズが発生しないかを `workflow-cookbook/logs` のメトリクスで監視し、[Day8/docs/day8/design/03_architecture.md](../../Day8/docs/day8/design/03_architecture.md) の責務境界内に留める。

## 6. 今後の実装タスク
1. `useFlagSnapshot()` を `App.tsx` へ導入し、AutoSave ランナー初期化をフラグ駆動にする。
2. `MergeDock.tsx` のタブビルダーを `precision` フラグ依存にリファクタし、Diff タブ挿入/初期タブ選択ロジックを分離テスト可能にする。
3. E2E テストで上記シナリオを自動化し、フラグロールバック手順の回帰を検証する。

