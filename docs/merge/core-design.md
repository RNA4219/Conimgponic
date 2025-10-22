# 精緻マージコア設計仕様

## 3-way マージパイプライン

```mermaid
flowchart TD
  A([DiffMerge:segment]) --> B[scoreSections]
  B --> C{similarity >= auto band?}
  C -- Yes --> D[decide:auto]
  C -- No --> E[decide:conflict]
  D --> F[buildMergePlan]
  E --> F
  F --> G{queueMergeCommand?}
  G -- yes --> H[createQueueMergeCommand]
  G -- no --> I[Result only]
  H --> J[queueMergeCommand(payload)]
  I --> K([MergeResult])
  J --> K
```

### ステージ定義
| ステージ | 対応実装 | 入力 | 出力 | 精度フラグ影響 |
| --- | --- | --- | --- | --- |
| `segment` | `splitSections` | `MergeInput`, `ResolvedMergeProfile` | セクション列 | `precision.sectionSizeHint` に従い区切り |
| `score` | `scoreSection` + `scoring` | セクション | `MergeScoringMetrics` | `PRECISION_CONFIG[precision].weights` を適用 |
| `decide` | `decideSection` | `MergeScoringMetrics` | `MergeHunk` | `similarityBands.auto/review` を閾値に採用 |
| `emit` | ハンクイベント発火 | `SectionDecision` | `MergeDecisionEvent` | `lockPolicy` に応じて再試行制御 |
| `queue` | `buildMergePlan`→`createQueueMergeCommand` | `MergeHunk[]`, `MergeStats` | `MergeQueueCommand` | `precision` ごとの `allowsAutoApply` 判定 |

## スコアリング基準

| precision | minAutoThreshold | auto band | review band | queue 動作 |
| --- | --- | --- | --- | --- |
| legacy | ≥0.75 | `threshold+0.08` | `threshold-0.04` | `auto` は即時適用、`conflict` は保留 |
| beta | ≥0.75 | `clamp(threshold+0.05, 0.8, 0.92)` | `threshold-0.02` | `auto` は即時適用、`review` 帯域は `score-underflow` エラーで保留 |
| stable | ≥0.82 | `clamp(threshold+0.03, 0.86, 0.95)` | `threshold-0.01` | すべて `hold`、レビュー後に適用 |

## 公開 API 出力

- `buildMergePlan` は `MergePlanResult` を返却し、`locked-conflict` (非再試行) / `score-underflow` (再試行可) / 正常系を分類。
- `getPrecisionUiState` により UI はバッジ文言と自動適用可否を制御。
- `createQueueMergeCommand` の payload は `queueMergeCommand` ワーカーと互換 (`type: 'merge:enqueue'`).

## テスト観点

| シナリオ | 入力条件 | 期待結果 |
| --- | --- | --- |
| auto 適用 | `precision=legacy`, 全ハンク `similarity>=auto` | `queueAction='apply'`, `queueMergeCommand` にエンキュー |
| score-underflow | `precision=beta`, いずれか `similarity<review` | `MergePlanResult.kind='error'`, イベントは `retryable=true` |
| locked conflict | `locks` 指定+`precision=stable`, 衝突発生 | `MergePlanResult.kind='error'`, `code='locked-conflict'`, queue 無実行 |
| 編集介入 | `precision=stable`, `auto` ハンクあり | `queueAction='hold'`, UI はレビュー強制 (`requiresReview=true`) |

## 競合時の判断メモ

- ノート→ 競合はロック優先。queue ステージで `locked-conflict` を返し外部再処理を促す。
