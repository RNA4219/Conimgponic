# DiffMerge Phase B UI 設計

## 目的
DiffMergeView と MergeDock のタブ/ペイン構成および precision 別挙動を整理し、Phase B 公開に向けた UI イベントフローとテスト観点を確定する。

## タブ/ペイン構造

### DiffMergeView
| precision | 初期サブタブ | タブ順序 | 主ペイン | 補助ペイン |
|-----------|--------------|----------|----------|-------------|
| legacy    | Review       | Review   | ハンクリスト (選択/スキップ) | アクションパネル (Queue Merge) |
| beta      | Review       | Review → Diff → Merged | ハンクリスト / Diff ビュー | アクションパネル / マージプレビュー |
| stable    | Diff         | Diff → Merged → Review | ハンクリスト / Diff ビュー | アクションパネル / マージプレビュー |

- Diff タブ: 選択ハンクの差分と編集モーダルを提供。編集保存/キャンセルでサブタブ・選択状態を維持。
- Merged タブ: 適用済み/適用予定のプレビューとアクションパネルを並列表示。
- Review タブ: ハンク選択とキュー操作のみ。legacy precision ではこのタブのみを露出。

### MergeDock
| precision | 初期タブ | Diff タブ露出 | バックアップ CTA 発火条件 |
|-----------|----------|---------------|-----------------------------|
| legacy    | Compiled | 非表示        | なし |
| beta      | Compiled | 手動遷移 (Beta バッジ付き) | Diff タブ滞在中 + 最終バックアップ 5 分超 |
| stable    | Diff     | デフォルト表示 | Diff タブ滞在中 + 最終バックアップ 5 分超 |

- Diff タブでは DiffMergeView を埋め込み、planDiffMergeView の初期サブタブ設定を尊重。
- precision が legacy→beta/stable に変化した際は Diff タブを初期タブとして設定し直し、バックアップCTAを有効化。

## イベントフロー

| イベント | 発火元 → 反映先 | precision | 説明 |
|----------|------------------|-----------|------|
| tab-change | tab-header → UI state | beta/stable | Review→Diff→Merged の導線を保持。Diff/Merged から Review へ戻る場合は選択状態を維持。 |
| hunk-toggle | hunk-row → UI state | 全精度 | ハンクの選択/解除。legacy ではレビュータブのみで即適用キューへ反映。 |
| command-queue | action-pane → merge controller | 全精度 | 選択ハンクを queueMergeCommand に渡す。beta/stable ではバックアップ CTA の評価を前段で実施。 |
| edit-open | hunk-row → UI state | beta/stable | Diff タブ限定で編集モーダルを起動。 |
| edit-commit | modal → merge controller | beta/stable | 編集内容を保存し、選択ハンクを維持したまま Diff タブを継続。 |
| edit-cancel | modal → UI state | beta/stable | 編集を破棄し、直前のサブタブと選択状態を再適用。 |

## UI テスト仕様

### タブ遷移
1. precision=legacy: Diff タブが存在しないこと、Review タブ固定で Queue Merge が即時利用可能。
2. precision=beta: 初期タブが Review。Diff → Merged → Review の順で遷移でき、遷移後もハンク選択状態が保持される。
3. precision=stable: MergeDock の初期タブが Diff で、DiffMergeView も Diff サブタブから開始する。

### 操作・警告表示
1. Diff タブで選択ハンクがあり、バックアップ最終成功から 5 分超 → バックアップ CTA が表示される。
2. precision=beta/stable で編集モーダルを開閉した際、アクティブタブと選択状態が変化しないこと。
3. command-queue 実行時に選択済みハンク ID が queueMergeCommand に渡される (モックで検証)。

### 競合操作
1. 同一ハンクを連続で選択/解除しても UI state とキュー対象が同期し続ける。
2. precision を runtime で legacy→stable に切替えた場合、MergeDock が Diff タブに切り替わりバックアップ CTA 条件が再計算される。
3. 編集モーダルを開いたままサブタブ切替が起きないこと (tab-change イベントによりブロック)。

## 実装ノート
- planDiffMergeView と planMergeDockTabs を基点に precision 別の挙動を共通化し、テスト時はこれらプランの snapshot を用いた期待値チェックを行う。
- バックアップ CTA の評価ロジックは plan.diff.backupAfterMs を利用し、precision 切替時にタイマーを再評価する。
