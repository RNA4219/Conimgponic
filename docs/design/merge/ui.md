# MergeDock Diff Exposure Plan

## 1. 概要
- `resolveMergeDockPhasePlan()` は MergeDock/DiffMergeView のタブ露出と `merge.request.threshold` の実効値を決める純関数。
- フェーズ情報は [Day8/docs/day8/design/03_architecture.md](../../../Day8/docs/day8/design/03_architecture.md) の Collector/Analyzer パイプラインと同期し、Phase B の rollout/rollback 判定を共有する。
- AutoSave のスナップショットは [docs/AUTOSAVE-DESIGN-IMPL.md](../../AUTOSAVE-DESIGN-IMPL.md) の手順に沿って Diff タブ開閉と整合する。

## 2. Phase 別 UI 行動
| precision | phase | Diff タブ | 初期タブ | threshold clamp | auto target | Phase B guard |
| --- | --- | --- | --- | --- | --- | --- |
| legacy | phase-a | hidden | compiled | `max(cfg,0.65)` | `threshold+0.08` | 常に false |
| beta | phase-b | opt-in | compiled | `clamp(cfg,0.68,0.9)` | `threshold+0.05` | `reviewBandCount>0` |
| stable | phase-b | default | diff | `clamp(cfg,0.7,0.94)` | `threshold+0.03` | `(review+conflict)>0` |

## 3. Rollout / Rollback 条件
- **Rollout**: 自動採用率がターゲット以上、かつ Phase guard 条件を満たす Precision に Diff タブを露出。Beta は opt-in、Stable は default。
- **Rollback**: 自動採用率がターゲット未満、または Phase guard が失敗した場合は Diff タブを削除し、`merge.lastTab` を Base タブへ戻す。Collector には `merge.diff.exposure='suppressed'` を記録。

## 4. Merge 実行パラメータ
- `MergeThresholdPlan.slider` は UI スライダーの min/max/step を提供し、設定値変更時に `merge.request.threshold` を再計算。
- `autoApplied.meetsTarget` が false の場合は Queue 送信 payload に `metadata.autoSaveRequested=false` を固定し、自動採用率の再評価が完了するまで Phase B を維持。
- DiffMergeView は `planDiffMergeView()` を Phase Plan から呼び出し、Review/Hunk UI の露出を precision 単位で同期する。
