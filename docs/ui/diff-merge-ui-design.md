# DiffMerge UI タブ/ペイン設計

## スコープ
- 対象ファイル: `src/components/DiffMergeView.tsx`, `src/components/MergeDock.tsx`
- `merge.precision` フラグによる UI レベル切替を定義し、既存タブとの互換を維持する。

## ワイヤフレーム
```
MergeDock (precision ∈ {legacy, beta, stable})
└─ Tab Header (compiled | shot | assets | import | golden | [diff])
    ├─ Diff タブ (beta/stable)
    │   └─ DiffMergeView
    │       ├─ Header: Title + Precision Badge(beta時) + SubTab Nav(diff/merged/review*)
    │       ├─ Body
    │       │   ├─ Pane: Hunk List (select/skip/edit)
    │       │   └─ Pane: Action Panel (queue merge / metrics / backup CTA)
    │       └─ Overlay: Modal Editor (open-editor/commit-edit/cancel-edit)
    └─ 他タブ: 既存ビュー (compiled, shot, assets, import, golden)
```
`* legacy precision は review パネルのみ表示し、サブタブナビゲーション非表示`

## precision レベル別 UI 制御
| precision | MergeDock 初期タブ | Diff サブタブ初期値 | サブタブナビ表示 | Diff タブ表示順 | バックアップ CTA | 備考 |
| --- | --- | --- | --- | --- | --- | --- |
| legacy | `compiled` | `review` | 非表示 | なし | 無効 | Diff タブを生成しない |
| beta | `compiled` (lastTab=diff で復元) | `review` | 表示 | 末尾 ("Diff (Beta)" バッジ) | Diff タブ滞在時・5分超 | 既存タブ順を保持 |
| stable | `diff` (lastTab 優先) | `diff` | 表示 | `golden` の直前 | Diff タブ滞在時・5分超 | Diff がデフォルトフォーカス |

## イベントフロー
| ID | trigger | source | target | outcome | precision |
| --- | --- | --- | --- | --- | --- |
| DM-TAB-001 | tab-change | DiffMergeView サブタブボタン | 比較/集約ペイン | 選択タブにあわせてペインを切替 | beta/stable |
| DM-HUNK-002 | toggle-select | ハンク行トグル | hunkStates reducer | 選択状態とアクションパネルが同期 | 全 precision |
| DM-ACT-003 | queue-merge | アクション CTA | queueMergeCommand | 選択ハンクIDを渡しコマンド生成 | beta/stable |
| DM-EDT-004 | open-editor | Edit ボタン | モーダルエディタ | ハンク内容を読み込み表示 | beta/stable |
| DM-EDT-005 | commit-edit | Save ボタン | queueMergeCommand | 編集結果を保存しマージ確定 | beta/stable |
| DM-EDT-006 | cancel-edit | Cancel ボタン | モーダルエディタ | 編集状態をリセットして閉じる | 全 precision |
| MD-PRC-001 | precision-change | merge.precision フラグ | planMergeDockTabs | precision ごとにタブ構成を再計算 | 全 precision |
| MD-TAB-002 | tab-change | MergeDock タブボタン | localStorage.merge.lastTab | 選択タブを永続化 | 全 precision |
| MD-BKP-003 | backup-trigger | Diff タブ CTA | __mergeDockFlushNow | バックアップ即時実行 | beta/stable |

## UI テスト仕様
### DiffMergeView
| ID | precision | フォーカス | 手順 | 期待結果 |
| --- | --- | --- | --- | --- |
| DM-LEG-01 | legacy | Tab Navigation | legacy precision でマウント → タブ確認 | ナビ非表示 / review 表示のみ |
| DM-BETA-02 | beta | Tab Navigation | Review 初期表示 → Diff 遷移 → Queue Merge | DM-TAB-001/DM-ACT-003 を満たす |
| DM-STB-03 | stable | Edit Flow | Diff 初期表示 → Edit → Save | DM-EDT-004/005 発火 → タブ状態維持 |

### MergeDock
| ID | precision | フォーカス | 手順 | 期待結果 |
| --- | --- | --- | --- | --- |
| MD-LEG-01 | legacy | Tab Plan | planMergeDockTabs を legacy で実行 | BASE_TABS と一致 / 初期タブ compiled |
| MD-BETA-02 | beta | Persistence | lastTab=diff を保存 → plan を確認 | Diff 追加 / initialTab=diff |
| MD-STB-03 | stable | Backup CTA | lastSuccessAt 過去設定 → shouldShowDiffBackupCTA | threshold 超過で true / 直後 false |

## 参照コード
- `planDiffMergeSubTabs`, `planMergeDockTabs`
- `diffBackupPolicy`, `shouldShowDiffBackupCTA`
