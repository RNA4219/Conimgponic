# 付録A: Day8 用語集

## Status
- Published: 2025-10-21
- Steward: Day8 Governance WG

## 主要用語
- **Collector** — CI 実行ログやテレメトリを収集して Day8 ワークスペースへ格納する役割。サンドボックス化された Pull/Push アクセスで読み取りのみを保証する。
- **Analyzer** — Collector が取り込んだアーティファクトを解析し、失敗シグナルや品質指標を抽出するコンポーネント。再現性確保のために deterministic な解析パイプラインを遵守する。
- **Reporter** — Analyzer の出力を整形し、運用者向けのレポートや通知チャンネルへ安全に配信するプロセス。Day8 では外部公開前にガバナンスチェックを必須化する。
- **Proposer** — Reporter の結果から具体的な改善提案や Issue 下書きを生成する役割。自動マージや直接コミットは禁止され、提案レベルで止めることで安全性を担保する。
- **Governance** — Collector から Proposer までのエンドツーエンド挙動を監査・制御する枠組み。権限境界やポリシー、監査ログを統合的に管理する。
- **Reflection DSL** — Day8 が観測・反省サイクルを記述するための専用スキーマ。`version` で DSL の互換性を宣言し、`context` に対象ワークスペースとイベントメタデータを記録、`observations` 配列で Collector から Analyzer への入力を列挙する。`insights` セクションでは Analyzer の解析結果を構造化し、`proposals` で Reporter/Proposer が提示するアクション候補を定義、`governance_notes` に承認ステータスや留意点を残す。
- **Safety Envelope** — Day8 全体で守る「自動化の上限」。外部公開や高リスク操作を行う場合は Governance が Envelope 境界を明示し、逸脱時は即座に停止する。
- **Observation Channel** — Collector が受け取る入力ストリームの論理単位。`context.channels` で宣言し、Analyzer が対象範囲を判別する。
- **Proposal Gate** — Proposer の出力を Governance が評価するワークフロー。`governance_notes.status` を `pending`, `approved`, `rejected` などで管理し、Ops 手動レビューの起点とする。
