# MergeDock フラグ連動設計

## 1. 目的とスコープ
- **目的**: `src/components/MergeDock.tsx` におけるタブレンダリングを `merge.precision` フラグで段階露出するための UI/状態設計を定義する。
- **スコープ**:
  - タブ露出条件と並び順の整理。
  - 既存 preference セレクタとの統合パターン。
  - Diff Merge タブ活性時のバックアップ誘導（AutoSave 連携）仕様。
- **除外**: Diff タブ内部 UI（`DiffMergeView`）・差分計算処理。

## 2. 参照資料
- [docs/AUTOSAVE-DESIGN-IMPL.md](./AUTOSAVE-DESIGN-IMPL.md): AutoSave API と状態遷移を参照し、Diff タブ導線の一貫性を確保する。
- [Day8/docs/day8/design/03_architecture.md](../Day8/docs/day8/design/03_architecture.md): 既存パイプラインと責務境界を踏まえ、MergeDock が UI 層でフラグ判定のみを行い下層へ副作用を持ち込まない設計とする。

## 3. タブ露出ポリシー
`merge.precision` フラグは `"legacy" | "beta" | "stable"` を想定し、既定は `legacy`。タブ構成は既存の "Overview"、"Settings" 等を保持したまま Diff タブを段階的に露出する。

| precision | Diff タブ露出 | 並び順 | 初期選択タブ | 備考 |
| --- | --- | --- | --- | --- |
| `legacy` | 非表示 | - | 既存初期タブ（Overview） | 既存 UX を完全維持。 |
| `beta` | タブ末尾に追加 | `[...] , Diff` | 既存初期タブ（Overview） | 選択時のみマウント。バッジ `Beta` を表示。 |
| `stable` | タブリストへ常設 | `[..., Diff, ...]`（既存最終タブ直前に配置） | Diff | 初期表示で Diff タブを選択。`Beta` バッジ削除。 |

- precision が未定義・未知値の場合は `legacy` と同等に扱い、Diff タブを隠す。
- タブ構造の変更は React key を安定させ、マウント/アンマウントで状態ロスを回避する（既存タブ配列再利用）。

## 4. 状態・フロー
### 4.1 状態遷移図（MergeDock 内部）
```mermaid
digraph MergeDockPrecision {
  rankdir=LR;
  Legacy [label="precision=legacy\nDiff hidden"];
  Beta [label="precision=beta\nDiff on-demand"];
  Stable [label="precision=stable\nDiff default"];

  Legacy -> Beta [label="feature rollout"];
  Beta -> Stable [label="flag promoted"];
  Stable -> Beta [label="roll back"];
  Beta -> Legacy [label="flag disable"];
}
```

### 4.2 バックアップ導線
- Diff タブ遷移時に AutoSave ステータスを確認し、`AutoSavePhase` が `disabled` 以外で最後の成功保存 (`lastSuccessAt`) が 5 分超過の場合、UI 上部に "バックアップを作成" CTA を表示する。
- CTA 操作で `initAutoSave().flushNow()` 相当のファサードを呼び出し（既存 AutoSave ファサードへ委譲）、完了後に `listHistory()` へ誘導するトーストを表示。
- AutoSave 無効 (`precision=legacy` で Diff 非表示) の場合は従来導線に影響なし。

## 5. I/O 契約
- `merge.precision` は既存 `usePref("merge.precision", "legacy")` で取得し、`setPref` はタブ切替や設定更新で利用する。
- precision が `stable` へ昇格した際は初期タブ選択を Diff に切替えるが、ユーザが明示的に他タブへ移動した場合は `setPref("merge.lastTab", <id>)` により従来の記憶ロジックを継承する。
- タブ配列は既存 `const tabs: MergeDockTab[]` をベースに Diff タブを条件付きで挿入し、残りのプロパティ（`render`, `beforeLeave` など）は後方互換を維持する。

## 6. 擬似コード
```tsx
// 擬似コード（型アノテーション略）
function MergeDock() {
  const precision = usePref('merge.precision', 'legacy');
  const lastTab = usePref('merge.lastTab', 'overview');
  const autoSave = useAutoSaveSnapshot(); // { phase, lastSuccessAt }

  const baseTabs = useMemo(() => buildBaseTabs(), []);
  const diffTab = useMemo(() => ({
    id: 'diff',
    label: precision === 'beta' ? 'Diff (Beta)' : 'Diff',
    render: () => <DiffMergeView onBackup={handleBackup} />,
  }), [precision]);

  const tabs = useMemo(() => {
    if (precision === 'legacy' || precision == null) return baseTabs;
    if (precision === 'beta') return [...baseTabs, diffTab];
    // stable
    return insertBefore(baseTabs, 'settings', diffTab);
  }, [baseTabs, diffTab, precision]);

  const initialTab = precision === 'stable' ? 'diff' : lastTab;

  return (
    <Tabs
      tabs={tabs}
      initialActive={initialTab}
      onChange={(tabId) => setPref('merge.lastTab', tabId)}
    />
  );

  function handleBackup() {
    if (autoSave.phase === 'disabled') return;
    if (isOlderThan(autoSave.lastSuccessAt, 5 * MINUTES)) {
      flushNow().finally(() => showHistoryToast());
    }
  }
}
```

## 7. テストケース
| ID | シナリオ | 前提 | 入力 | 期待結果 |
| --- | --- | --- | --- | --- |
| T1 | legacy で Diff 非表示 | `precision=legacy` | MergeDock 初期描画 | タブ一覧に `diff` が含まれない。`initialActive=overview`。 |
| T2 | beta で末尾追加 | `precision=beta` | MergeDock 初期描画 | タブ配列末尾が Diff。`initialActive=overview`。バッジ `Beta` が表示。 |
| T3 | stable で初期タブ | `precision=stable` | MergeDock 初期描画 | Diff が `settings` 直前に配置され、`initialActive=diff`。 |
| T4 | 未知 precision フォールバック | `precision='experimental'` | MergeDock 初期描画 | Diff 非表示。既存挙動維持。 |
| T5 | Diff 選択時のバックアップ CTA | `precision in {beta, stable}`、AutoSave `lastSuccessAt` >5分 | Diff タブを開く | CTA 表示、押下で `flushNow()` が呼ばれ履歴トーストが表示。 |
| T6 | legacy フォールバック TDD | `precision=legacy` → `setPref('merge.precision', 'stable')` | フラグ昇格 | Diff が UI に現れ、初期タブが次回マウントで Diff へ遷移。 |

## 8. TDD 観点
- タブ構成は `renderMergeDockTabs(precision)` の純粋関数として切り出し、T1〜T4 を Jest/React Testing Library でスナップショット検証。
- バックアップ CTA は AutoSave モック (`phase`, `lastSuccessAt`) を差し替え、T5 をユニットテスト（CTA 表示、クリック時の `flushNow` 呼び出し）で先に記述。
- precision 遷移時の初期タブは `useEffect` + `setPref` の副作用をモックし、T6 で差分確認。

## 9. 互換性と移行
- `legacy` をデフォルトに据えることで既存ユーザの UX を維持（AutoSave 連携も影響なし）。
- 既存書き出しフロー（Collector/Analyzer 経由のメトリクス収集）はタブ露出に影響されない。タブ判定は UI 層のみで完結。
- precision フラグがダウングレードされた場合も状態遷移図の通り Diff タブを非表示に戻し、`merge.lastTab` が `diff` を指す場合は `overview` へフォールバックする。

## 10. 今後の課題
- Diff タブの安定化後に `merge.precision` の値を `stable` へ昇格する際、サーバ設定との同期を自動化する。
- バックアップ CTA の発火条件（5 分閾値）は本番導入後にテレメトリを観測して再評価する。
