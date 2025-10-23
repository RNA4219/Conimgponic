# MERGE — 精緻マージ仕様

## 1. 目的
- 外部・他世代の差分を**3-wayマージ**し、**自動採用率**を高めつつ、衝突時はUIで介入。

## 2. 基本
- 入力: Base / Ours / Theirs。
- 分割: カード→フィールド→トークン（文字 or 単語）。
- 類似度: LCS比率 or Cosine（文字n-gram）。
- しきい値: 0.0–1.0、既定 0.72。

## 3. ルール（抜粋）
- Ours=Theirs 同一 → 採用。
- 一方のみ変更 → 変更側採用（しきい値で微差除外）。
- 両者変更・差異大 → 衝突（UI提示）。

## 4. 証跡JSON（例）
```json
{
  "profile": {"threshold": 0.72, "seed": "abc123"},
  "hunks": [
    {"path": "scenes[3].manual", "decision": "auto_ours", "sim": 0.91},
    {"path": "scenes[5].title", "decision": "conflict", "ours": "...", "theirs": "..."}
  ]
}
```

## 5. 受入基準
- サンプル10件で**自動採用>=80%**（ラベル付きケース）。

## 6. Phase別 UI ガードとしきい値クランプ
- MergeDock は `merge.precision`（legacy/beta/stable）と VS Code 設定 `conimg.merge.threshold` を `resolveMergeDockPhasePlan()` で統合し、フェーズごとのタブ露出と自動採用ガードを計算する。
- 設定値が欠落/NaN の場合は `DEFAULT_THRESHOLD=0.72` を基準にする。
- しきい値は Phase B 要件に応じてクランプし、UI スライダー最小/最大と自動採用率ターゲットを同時に更新する。

| precision | request.threshold | Diff タブ露出 | 自動採用 band | Review band | Conflict band | Phase B guard |
| --- | --- | --- | --- | --- | --- | --- |
| legacy | `max(cfg, 0.65)` | hidden | `>= threshold + 0.08` | なし | なし | false |
| beta | `clamp(cfg, 0.68, 0.9)` | opt-in | `>= threshold + 0.05` | `[threshold-0.02, threshold+0.05)` | `< threshold-0.02` | `reviewBandCount > 0` |
| stable | `clamp(cfg, 0.7, 0.94)` | default | `>= threshold + 0.03` | `[threshold-0.01, threshold+0.03)` | `< threshold-0.01` | `(review+conflict) > 0` |

- 自動採用率がターゲットを下回る場合、Diff タブは Phase B の opt-in 状態に留まり、Collector ログへ `autoAppliedRate < target` を書き出す。UI スライダー値の更新は `merge.request.threshold` に即時反映する。
- 詳細は [docs/AUTOSAVE-DESIGN-IMPL.md](../AUTOSAVE-DESIGN-IMPL.md) のフラグ協調要件および [Day8/docs/day8/design/03_architecture.md](../../Day8/docs/day8/design/03_architecture.md) の Collector/Analyzer 連携を参照。
