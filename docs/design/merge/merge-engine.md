# Merge Engine 設計サマリ

## 1. 目的
- Base/Ours/Theirs の 3-way 決定的マージ `merge3` を確立し、セクション単位で自動採択と競合提示を切り替える。【F:docs/MERGE-DESIGN-IMPL.md†L4-L19】

## 2. スコープ
| 項目 | 内容 | 参照 |
| --- | --- | --- |
| `merge3` | `MergeInput`→`MergeResult` を返し、決定的なハンク列と統合済みテキストを生成する中核エンジン。 | 【F:docs/MERGE-DESIGN-IMPL.md†L21-L89】 |
| プロファイル | `MergeProfile` の解決順序・precision 下限・lock/Prefer 優先度を規定し、決定性と SLA を担保する。 | 【F:docs/MERGE-DESIGN-IMPL.md†L36-L111】 |
| イベント | `merge:auto-applied` / `merge:conflict-detected` を UI・Telemetry へ送出し、AutoSave との連携をトリガーする。 | 【F:docs/MERGE-DESIGN-IMPL.md†L91-L130】 |

## 3. 設計詳細

### 3.1 プロファイル解決
| ステップ | 詳細 | 制約 |
| --- | --- | --- |
| 1. `resolveProfile` | ユーザ入力 `Partial<MergeProfile>` に precision 下限を適用し `ResolvedMergeProfile` を生成。 | `minAutoThreshold = max(profile.threshold, precision.min)` を必須化。 | 【F:docs/MERGE-DESIGN-IMPL.md†L36-L111】 |
| 2. Lock 優先 | セクション lock が存在する場合は `prefer` / 類似度計算を迂回して決定。 | lock が未指定時のみ `prefer` → `similarity` の順で評価。 | 【F:docs/MERGE-DESIGN-IMPL.md†L46-L110】 |
| 3. 決定性維持 | セクションキーの辞書順ソートとトークン安定ソート、決定時の `prefer` 固定順序でハッシュ以外の乱数を排除。 | `seed` は入力ハッシュ由来の deterministic 値のみ許容。 | 【F:docs/MERGE-DESIGN-IMPL.md†L49-L53】 |

### 3.2 スコアリング手順
| フェーズ | 入力 | 出力 | SLA 対応 |
| --- | --- | --- | --- |
| `tokenizeSection` | セクションテキスト、`cfg.tokenizer` | `MergeScoringInput` | トークンキャッシュとバッチ処理で 100 カット 5 秒を満たす。 | 【F:docs/MERGE-DESIGN-IMPL.md†L96-L111】 |
| `score` | `MergeScoringInput`, `ResolvedMergeProfile` | `MergeScoringMetrics`（Jaccard/Cosine/Blended） | `AbortSignal` により SLA 超過前に `MergeError` を送出。 | 【F:docs/MERGE-DESIGN-IMPL.md†L96-L111】 |
| `decide` | `MergeScoringMetrics`, lock, `prefer` | `MergeDecision`, `similarity` | `similarity < minAutoThreshold` は必ず競合扱いとし再試行を許容。 | 【F:docs/MERGE-DESIGN-IMPL.md†L14-L110】 |
| `emitDecision` | `MergeDecision`, `MergeHunk` | UI / Telemetry イベント | 1 ハンク ≤1ms を上限にイベントファンアウト。 | 【F:docs/MERGE-DESIGN-IMPL.md†L103-L111】 |

### 3.3 決定イベント
| イベント | トリガー | UI プロトコル | Telemetry |
| --- | --- | --- | --- |
| `merge:auto-applied` | `similarity ≥ minAutoThreshold` か lock で自動採択されたハンク。 | precision `legacy` では従来 UI、`beta/stable` では Diff タブ上でバッジ表示し AutoSave `flushNow()` を条件起動。 | Analyzer に `confidence_score=blended` を送出し成功率を precision 別に集計。 | 【F:docs/MERGE-DESIGN-IMPL.md†L91-L130】 |
| `merge:conflict-detected` | `similarity < minAutoThreshold` かつ lock が競合を指定。 | `beta/stable` では `DiffMergeView` に競合ハンクを表示し再試行ボタンを活性化。 | `merge.precision.blocked` と `retryable` 区分を Collector→Analyzer→Reporter で連携。 | 【F:docs/MERGE-DESIGN-IMPL.md†L91-L130】 |

### 3.4 precision 別パラメータ
| precision | `minAutoThreshold` | 類似度バンド | スコア重み / ブースト | UI 連携 | Telemetry |
| --- | --- | --- | --- | --- | --- |
| `legacy` | `max(profile.threshold, 0.65)` | `auto = threshold + 0.08` / `review = threshold - 0.04` | `0.5*jaccard + 0.5*cosine` | Diff タブ非表示、`pref` は Manual/Ai の二択。 | `merge:finish` で従来統計のみ。 | 【F:docs/MERGE-DESIGN-IMPL.md†L114-L130】 |
| `beta` | `max(profile.threshold, 0.75)` | `auto = clamp(threshold+0.05, 0.8, 0.92)` / `review = threshold - 0.02` | `0.4*jaccard + 0.6*cosine` | Diff タブ末尾、`Beta` バッジと AutoSave `flushNow()` を併走。 | `merge.precision.suggested` に `confidence_score` を付与。 | 【F:docs/MERGE-DESIGN-IMPL.md†L114-L130】 |
| `stable` | `max(profile.threshold, 0.82)` | `auto = clamp(threshold+0.03, 0.86, 0.95)` / `review = threshold - 0.01` | `0.3*jaccard + 0.7*cosine + historyBoost≤0.05` | Diff タブ初期選択、AutoSave 遅延時に CTA 常時表示。 | `merge.precision.blocked` を SLO 監視に使用。 | 【F:docs/MERGE-DESIGN-IMPL.md†L114-L130】 |

## 4. TDD / ベンチマーク計画

### 4.1 `tests/merge/merge3.spec.ts` で実装するケース
| 区分 | precision | テスト観点 | 期待結果 |
| --- | --- | --- | --- |
| プロファイル解決 | `legacy` | 部分指定プロファイルが precision 下限へ引き上げられること。 | `resolveProfile` が `threshold=0.7` 指定でも `minAutoThreshold=0.7` を維持。 |
| プロファイル解決 | `stable` | lock 優先が `prefer` より先に適用されること。 | `locks` 指定セクションが常に auto 決定されイベント `merge:auto-applied` 発火。 |
| スコアリング | `beta` | `AbortSignal` による SLA 監視と `MergeError` 送出。 | 100 カット超で 5 秒直前に `retryable=true` の `MergeError` が投げられる。 |
| イベント | `legacy→beta` 切替 | precision 切替時に `DiffMergeView` がマウントされ AutoSave `flushNow()` を呼び出す。 | UI モックが `merge:auto-applied` 受信後に AutoSave 呼び出し履歴を保持。 |
| イベント | `beta→legacy` ロールバック | `merge.lastTab` が `overview` へ戻り Diff 状態が破棄される。 | イベント列が `merge:finish` 後に `Diff` タブ非表示となる。 |
| precision チューニング | `stable` | `historyBoost` 適用時の `blended` 計算と自動採択判定。 | AutoSave 履歴がある場合に `similarity + boost` で auto 判定となる。 |

### 4.2 ベンチマーク計画
- **対象**: 100 カットのセクションを含む `MergeInput` サンプル 3 種（`legacy`/`beta`/`stable`）。
- **測定**: `AbortController` 計測で `processingMillis` を取得し、平均 4.5s 以下、最大 5.0s 未満を合格基準とする。
- **ツール**: Node 18 + `node --test` で micro-benchmark、`performance.mark/measure` を利用。
- **回数**: プロファイルごとに 5 連続試行し、`95th percentile ≤ 4.8s` を保証。
- **回帰監視**: CI で週次ジョブを追加し、閾値超過時は `merge.precision.blocked` イベントを付与してリトライ判定を促す。

## 5. リスク・フォローアップ
| リスク/課題 | 対応策 |
| --- | --- |
| `MergeError` の retryable 区分が UI/Telemetry へ伝搬されない。 | `MergeError` に `retryable: boolean` を保持し、SLA 超過や precision ブロック時は `true` を設定。Collector 経由で Analyzer へ転送し再試行 UI を活性化する。 |
| AutoSave 連携時の証跡欠落。 | AutoSave 有効時は `runs/<ts>/merge.json` へ決定イベントと `confidence_score` を必ず保存し、`merge:auto-applied` 毎にファイル追記する。証跡が欠けた場合はリリース停止条件とする。 | 【F:docs/MERGE-DESIGN-IMPL.md†L19-L130】 |
| precision 切替の UI 異常で SLA 超過が顕在化。 | `merge.precision` 切替テストを CI の smoke に追加し、5 秒 SLA のベンチ指標が 5% 超過した場合はローリングバック手順を即時実行。 |
