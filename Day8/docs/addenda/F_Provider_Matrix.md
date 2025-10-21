# 付録F: プロバイダーマトリクス

## Status
- Published: 2025-10-26
- Steward: Day8 Governance WG

## 目的
Day8 が自動化ワークフローで利用する生成 AI プロバイダーとモデルの差異を即座に把握するためのリファレンスを提供する。Katamari 版 Appendix F を基に、Day8 の Reflection DSL／レポート運用に合わせたモデル選定、利用ガード、監査手順を整理した。

## 活用タイミング
- 新しいモデルやエンドポイントを検証する際に、既存プロバイダーの役割と Day8 ガードレールを比較する。
- 失敗ログや反省レポートでモデル差分が疑われる場合に、許容範囲とフォールバック優先度を確認する。
- 契約・利用条件（Rate Limit/データ保持）が変更されたときに、Day8 ガバナンスとの整合をチェックする。

## プロバイダーマトリクス（Day8 運用基準）
| Provider | Day8 想定モデル / バージョン | 主なユースケース | 強み | リスクとフォールバック |
| --- | --- | --- | --- | --- |
| OpenAI | `gpt-4.1-mini`（反省 DSL 既定）、`gpt-4o`（長文レポート）、`text-embedding-3-large` | 反省 DSL の洞察生成、提案下書き、ログの要約 | Latency と品質のバランスが高く、Day8 のテストワークフローで最も検証済み | API リトライ時の Rate Limit 超過。Collector 経由で `gpt-4o` を使用する場合は `workflow-cookbook/GUARDRAILS.md` に沿ったトークン制御を実施し、30% トークン超過で `gpt-4.1-mini` へフォールバック。 |
| Anthropic | `claude-3-5-sonnet`（長文推論）、`claude-3-haiku`（高速レビュー） | ガバナンスレビューのロールプレイ、長文チェックリストの整合判定 | 厳格なガバナンス説明性と LLM ガードでの検閲が充実 | コンテキスト長制限。Haiku へ切り替える際は spec 02 の Review ステップで出力差分を検証し、差異が大きい場合は OpenAI 提案を一次参照とする。 |
| Google | `gemini-1.5-pro`（マルチモーダル）、`text-embedding-004` | マルチモーダルログ解析、イメージ付きインシデント報告の要約 | 画像や表の理解力が高く、Collector のサマリ生成に適する | データ保持条件が厳格。アップロード前に Appendix G のデータ分類チェックを通過させ、保持不可のログは `claude-3-haiku` に切替。 |
| Meta (Azure) | `llama-3.1-70b-instruct`（セルフホスト）、`llama-3.1-8b-instruct`（軽量検証） | エアギャップ環境での追試や、Day8 ツールチェーンのセルフホスト検証 | コスト効率が高く、データを外部に送らずに再現性を担保できる | 推論品質のばらつき。70B の GPU 要件が高いため、クラスタ混雑時は 8B へダウングレードし、結果を OpenAI でクロスチェック。 |

## モデル差分チェックリスト
1. `workflow-cookbook/reflection.yaml` の `llm_model` を変更する場合、ガバナンス承認ログを残す。
2. Rate Limit が 80% を超えたら Collector 側でキュー制御を有効化し、Appendix G のシークレットローテーション手順を確認する。
3. フォールバック後 3 回連続で提案品質がしきい値 (`quality/06_quality.md` のプロポーザル SLO) を下回った場合は、Day8 Ops にエスカレーションする。

## 連携ドキュメント
- [Day8 仕様詳細](../day8/spec/02_spec.md) — Reflection DSL 設定とレポート生成ワークフロー。
- [Appendix G: セキュリティ & プライバシー](G_Security_Privacy.md) — データ取り扱い基準とログ匿名化のルール。
- [Appendix H: デプロイガイド](H_Deploy_Guide.md) — プロバイダー切替時の CI/CD テスト確認ポイント。

## 改訂ガイド
- プロバイダー契約、モデル名称、利用ガードレールを更新したら、本マトリクスと Birdseye カプセルの `summary`/`maintenance`/`generated_at` を同期する。
- 変更内容は Day8 Ops 週次ログに記録し、`docs/birdseye/index.json` のエッジを再生成する。
