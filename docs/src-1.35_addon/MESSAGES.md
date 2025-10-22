# MESSAGES — Webview⇄拡張（将来）

> v1.0（PWA）では未使用だが、将来の互換性のために定義。

## 1. Webview → 拡張
- `snapshot.request` — 現在状態の保存要求
- `merge.request` — 3-wayマージ要求
- `gen.request` — 生成要求（v1.0は無効）

## 2. 拡張 → Webview
- `snapshot.result` — 保存結果
- `merge.result` — マージ結果（証跡JSONを含む）
- `gen.chunk` / `gen.done` / `gen.error`
