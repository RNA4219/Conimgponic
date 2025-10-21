# Boundary Map

各機能の責務境界を共有するための一覧です。1機能につき1テーブルを追加し、
「提供するもの / 受け取るもの / 備考」を明記してください。

| 機能 | 提供するもの | 受け取るもの | 備考 |
|------|---------------|---------------|------|
| 例: metrics 集計 | 集計済みメトリクスAPI | ログストリーム、設定 | スキーマ: `/docs/spec.template.md` |

| 機能 | 提供するもの | 受け取るもの | 備考 |
|------|---------------|---------------|------|
| context_trimmer | `ContextTrimResult` JSON（`messages`、`omitted`, `token_budget` を含むトリミング後会話コンテキスト） | `ConversationLog` JSON（メッセージ列、`token_budget` 指定、`policy` 設定）、`context_trimmer` の操作ログ出力先 | 入出力スキーマ: `ContextTrimResult` / `ConversationLog`; 依存: structured logging sink。関連仕様: [docs/ROADMAP_AND_SPECS.md](./ROADMAP_AND_SPECS.md) の「Minimal Context Intake」。 |

| 機能 | 提供するもの | 受け取るもの | 備考 |
|------|---------------|---------------|------|
| collect_metrics_cli（仮称） | CLI経由でエクスポートされる `MetricsSnapshot` JSON + Prometheus PushGateway 互換メトリクス | CI/実行時ログ (`StructuredLog`)、`qa-metrics.json`（任意）、Prometheus PushGateway 接続情報 | 入出力スキーマ: `MetricsSnapshot` JSON; 依存: Prometheus PushGateway、構造化ログ。契約: [docs/CONTRACTS.md](./CONTRACTS.md) の `.ga/qa-metrics.json`。 |

追加ルール:

- 新規機能はPRでテーブル行を追加
- 廃止機能は行末に `(deprecated: YYYY-MM-DD)` を追記
- 相互依存がある場合は備考欄に関連機能を記載

このドキュメントにより、並列開発時の責務衝突を防ぎます。
