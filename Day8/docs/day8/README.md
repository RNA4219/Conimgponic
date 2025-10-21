# Day8 Docs（別名: 8day）
日付: 2025-10-14

Day8 は **「観測 → 反省 → 提案」** に特化した **安全デチューンCI** の追加素材です。
自動改変は行わず、テスト結果や運用ログから洞察をレポート・Issue提案までで止めることで、
OSS でも安心して導入できる“第八日目”の基盤を提供します。

- 目的: 自己観察と学習のループを、CI 上で安全に自動化
- 非目的: 本番コードの自動修正／自動デプロイ／無制限の外部送信

## 構成
- `spec/` 要件・仕様
- `design/` アーキテクチャ・データモデル・図
- `ops/` 運用・導入・サブディレクトリ対応
- `security/` セキュリティ・ガバナンス
- `quality/` メトリクス・SLO・評価
- `guides/` 貢献規約・タスク運用（Task Seeds）
- `examples/` 反省DSL・ガバナンス・CI のサンプル
- ペルソナ付録 — Task Seed 起票や評価指標策定時に参照する [Katamari ペルソナスキーマ](../addenda/C_Persona_Schema.md)

## キーワード
- [Day8 用語集](../addenda/A_Glossary.md) — レビュー前や Reflection DSL 設計の見直し時に、Collector/Analyzer/Proposer などの用語と DSL フィールドを整理するために参照。
- Day8, workflow-cookbook, reflective devops, safe autonomy, propose-only
