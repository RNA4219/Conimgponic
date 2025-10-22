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
