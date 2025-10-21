# MergeDock フラグ試験計画

## 1. スコープと目的
- 対象: `merge.precision` フラグによるタブ構造とマージ精度モードの切替。
- 目的: Phase B で追加される Diff Merge タブの導線が既存 UI を破壊せず、beta/stable 切替で期待する挙動に遷移することを証明。

## 2. テストケーステンプレート
| 項目 | 記入ルール |
| --- | --- |
| Test ID | `MD-{層}-{連番}` (`U`=ユニット, `I`=統合, `V`=ビジュアルスナップ) |
| Flag State | `legacy` / `beta` / `stable` を明記 |
| Preconditions | `MergeDock` の初期タブ、`mergeProfile` の既定値、差分対象のモックパッケージ |
| Steps | UI 操作またはフック呼出を `Given/When/Then` で整理 |
| Expected Result | タブ配列、アクティブタブ、セレクタ UI、`merge3` 呼出パラメータ |
| Snapshot | DOM/JSON いずれを利用するかを記載 |

### ケース一覧
| Test ID | Flag State | 概要 |
| --- | --- | --- |
| MD-U-01 | legacy | `useMemo` で生成するタブ配列に Diff Merge が含まれないことを検証 |
| MD-U-02 | beta | タブ配列末尾に Diff Merge が追加され、`mergeProfile` が `beta` へ切替る |
| MD-U-03 | stable | 精緻マージ向けスコアリングが有効化され、`merge3` パラメータに `mode:'stable'` が渡る |
| MD-I-01 | legacy | 既存タブ巡回ホットキーが変化しないことを確認 |
| MD-I-02 | beta | Diff Merge タブで AI/手動セレクタが共存し既存ショートカットが後方互換 |
| MD-V-01 | beta/stable | スクリーンショット比較でタブラベル・バッジ表示が期待通り |

## 3. I/O コントラクト
```typescript
export interface MockMergePackage {
  storyboard: MockStoryboard;
  incoming: MockStoryboard;
  mergeProfile: 'legacy' | 'beta' | 'stable';
}

export interface MergeDockTestInput {
  precisionFlag: 'legacy' | 'beta' | 'stable';
  package: MockMergePackage;
  userPrefs: {
    activeTab: string;
    preferredMode: 'manual' | 'ai-first';
  };
}

export interface MergeDockExpectation {
  tabs: string[];
  activeTab: string;
  mergeArgs?: {
    mode: 'legacy' | 'beta' | 'stable';
    weights: Record<string, number>;
  };
  renderedSnapshotKey?: string;
}
```
- `MockStoryboard` は AutoSave 計画と同一型を再利用し、差分生成のために `frames` を変更できるようにする。
- `weights` は `beta`/`stable` でのスコア調整値を格納し、JSON スナップショットで閾値の回帰を検知する。

## 4. スナップショット戦略
- タブ配列は `tabs` の JSON スナップショットで比較し、`legacy` ケースと `beta|stable` ケースを別ディレクトリに保存。
- ビジュアルスナップショットは `pnpm test -- --update-snapshots` 時にのみ更新し、`__screenshots__/merge/` 以下で幅 1280px 固定。
- `mergeArgs.weights` はキー順をソートした上で整形出力し、浮動小数点の比較には 1e-4 の許容差を設ける。

## 5. モックデータ設計
- `MockMergePackage` のデフォルト: 2 つのシーン差分（テキスト差分、メタデータ差分）を含む YAML から生成し、`beta`/`stable` 用に重み付けを変える。
- `preferredMode` は既存 UI と互換性を持つ値のみ使用し、未知値が渡った場合は `legacy` ハンドラで例外化されることを別途試験。
- `merge3` の戻り値モックは `hunks` 配列 + スコア統計 (`score`, `confidence`) を含め、`stable` モードでのみ閾値超過をシミュレート。

## 6. CI コマンド順序
1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test --filter merge`
4. `pnpm test -- --runInBand --update-snapshots`（必要時のみ）
