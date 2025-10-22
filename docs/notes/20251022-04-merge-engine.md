# Task 20251022-04 Mergeエンジン設計メモ

## 設計メモ
- `resolveProfile` で `merge.precision`（env→overrides）と `MergeProfile` を統合し、精度別しきい値・重み・lockPolicy を `docs/MERGE-DESIGN-IMPL.md` の表に沿って補完。
- セクション分割は入力指定を優先し、無い場合は段落区切り（空行）で `section-${index}` を生成。lock はセクションIDで強制し、`strict` ポリシー時は常に衝突扱い。
- スコアリングは簡易トークナイザ＋Jaccard/Cosine を算出し、precisionごとの重みで合成（historyBoost は依存データ未提供のため 0）。
- 決定ロジックは lock→prefer→スコアの順で適用し、auto採択テキストは prefer に応じて Manual/AI を選択。競合は Base テキストを保持。
- Telemetry/EventHub は merge:start → hunk-decision → merge:finish を順序保証し、trace へ `segment/score/decide/emit` ステージを記録。

## TDD草案
- `legacy` 精度で ours/theirs が一致するハッピーパス → 全ハンク auto、平均類似度=1、stats.autoDecisions=セクション数。
- `beta` 精度で類似度が auto 閾値未満の差分 → conflict 判定と `merge:conflict-detected` イベントを検証。
- lock 指定されたセクション → 類似度に関係なく conflict、prefer が lock 値に一致、lockedDecisions カウント加算。
- Telemetry フック → merge:start/hunk/finish の順序と `processingMillis` 計測をモック検証。

## リスク評価
- precision 閾値・重みの変動が UI 期待値と乖離する恐れ → docs の表を参照し単体テストで閾値境界をカバー。
- 段落区切り分割が入力と不整合になるケース → 今後 sectionDescriptors サポート拡充時に追加テストを計画。
- AbortSignal の運用依存（timeout理由の文字列差異） → 理由未特定時は安全側で `aborted` を返し再試行とUI通知に委任。
