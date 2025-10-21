# 仕様（Specification）

## ディレクトリ標準
- `.github/workflows/` : `test.yml`, `reflection.yml`（必要に応じ `pr_gate.yml`）
- `workflow-cookbook/`
  - `workflow-cookbook/reflection.yaml` （反省DSL）
  - `workflow-cookbook/scripts/analyze.py` （ログ→レポート）
  - `logs/` / `reports/` / `docs/`

## 反省DSL（例）
```yaml
# workflow-cookbook/reflection.yaml
targets:
  - name: unit
    logs: ["logs/test.jsonl"]
metrics: [pass_rate, duration_p95, flaky_rate]
analysis:
  engine: heuristic        # 将来: llm
  llm_model: gpt-4.1-mini  # デチューン時は使用しない
  max_tokens: 0
actions:
  suggest_issues: true
  open_pr_as_draft: false
  auto_fix: false
report:
  output: "reports/today.md"
  include_why_why: true
```

> モデル差分を調査・反映する際は [Appendix F: プロバイダーマトリクス](../../addenda/F_Provider_Matrix.md) を参照し、`llm_model` の切替やフォールバック順序、ガードレール更新をガバナンスに記録する。
>
> ログ圧縮や保持率の調整は [Appendix D: トリム設計](../../addenda/D_Trim_Design.md) に従い、`workflow-cookbook/scripts/analyze.py` の `--trim` オプションや `reflection.yaml` の保持設定を更新する前に保持率指標 (`retention_ratio` など) の SLO と整合させる。

## GitHub Actions（要点）
- `test.yml`: ログ生成→アーティファクト化
- `reflection.yml`: `workflow_run` で `test` 連動。ログを解析してレポートコミット、必要なら Issue 草案起票。
- サブディレクトリ対応: `defaults.run.working-directory: workflow-cookbook`

## 主要ユースケース
- **ログ解析パイプライン**: `workflow-cookbook/scripts/analyze.py` が `logs/*.jsonl` を [Appendix D: トリム設計](../../addenda/D_Trim_Design.md) に従って圧縮し、保持率 KPI と同期させたメトリクスを `reports/` へ出力する。
- **提案生成（Suggest Issues / Auto Fix）**: 反省DSLからの `actions` 設定を基に Analyzer → Proposer チェーンを駆動し、[Appendix C: ペルソナスキーマ](../../addenda/C_Persona_Schema.md) で定義した対象ロール向けに Issue テンプレートを生成する。
- **評価レポート共有**: レポートは `workflow-cookbook/EVALUATION.md` の Gate 通過判定に合わせて Birdseye にリンクされ、Priority Score 設定と合わせた意思決定ログを維持する。
- **フォールバック推論**: LLM 失敗時は [Appendix F: プロバイダーマトリクス](../../addenda/F_Provider_Matrix.md) のフォールバック順序に従い、`engine: heuristic` へ切替えて SLA を確保する。

## チェーン制御
- 反省DSL → Collector（ログ収集）→ Analyzer（特徴抽出）→ Proposer（改善提案）→ Governance（承認）の順にフェーズを固定し、各フェーズの入力・出力契約は `docs/day8/design/03_architecture.md` の責務境界に準拠する。
- 各フェーズは `chain_id` と `step_id` を共有し、[Appendix J: 運用 Runbook](../../addenda/J_Runbook.md) で定義されたリトライ回数を超えた場合にのみ停止する。
- Persona ごとの分岐は Analyzer 内の `target_persona` フィールドで管理し、スコアリング閾値は [workflow-cookbook/CHECKLISTS.md](../../../workflow-cookbook/CHECKLISTS.md) の Release セクションに沿って調整する。

## エラー処理
- リトライ可能エラー（ネットワーク・レート制限）は `retry_window`（標準 5 分）内で最大 3 回再送し、それ以降は `status=requeue` として Queue に戻す。
- リトライ不可エラー（契約違反・フォーマット不正）は `status=abort` とし、`reports/errors.md` に記録して [Appendix I: テストケース](../../addenda/I_Test_Cases.md) のカバレッジに反映する。
- Trim により削除されたログの参照要求は 410（Gone）相当の扱いとし、`workflow-cookbook/RUNBOOK.md` の Observability 手順で説明されるフォールバックダッシュボードを提示する。

## Provider 抽象
- LLM/Embedding/Tool の各 Provider は `provider_spi` に準拠した `ProviderAdapter` を実装し、接続設定は [Appendix L: 設定リファレンス](../../addenda/L_Config_Reference.md) で宣言する。
- Provider の優先度・フェイルオーバー条件は [Appendix F: プロバイダーマトリクス](../../addenda/F_Provider_Matrix.md) を単一の権威として採用し、Diff 発生時はガバナンスレビューとセットで更新する。
- Guardrails のチェック（プロンプトフィルタ、出力検証）は Evaluator と分離し、`workflow-cookbook/SAFETY.md` のポリシーを侵害しないよう実装する。

## 性能指標
- 反省チェーン全体の SLO: `duration_p95` ≤ 45 秒、`pass_rate` ≥ 99% を維持し、逸脱時は [workflow-cookbook/EVALUATION.md](../../../workflow-cookbook/EVALUATION.md) の手順に従いインシデント扱いとする。
- Trim 後の `retention_ratio` は [Appendix D: トリム設計](../../addenda/D_Trim_Design.md) の最小保証（90%）を下回らないよう監視し、逸脱時は `reflection.yaml` の保持設定を更新する。
- `/healthz` の応答指標は [Appendix M1: Metrics & Healthz ADR](../../addenda/M1_Metrics_Healthz_ADR.md) に定義された `analyzer_queue_depth` と `proposal_latency_p95` を用い、デグレ時は Ops Runbook へ即エスカレーションする。

## デプロイ条件
- ステージング → プロダクションの昇格は [docs/day8/ops/04_ops.md](../ops/04_ops.md) と [Appendix H: デプロイガイド](../../addenda/H_Deploy_Guide.md) のチェックリストを満たし、`/healthz` スモークとリカバリ手順の検証ログを添付する。
- Provider の資格情報更新時は `workflow-cookbook/SECURITY.md` のローテーション手順を踏み、Birdseye で差分リンクを維持する。
- Priority Score が閾値未満の改善案は Draft PR として止め、`governance/policy.yaml` で定義された例外フローに従う。

## 評価器ロードマップ
- 現行: Heuristic Evaluator を標準化し、`metrics: [pass_rate, duration_p95, flaky_rate]` を必須評価とする。
- 短期: [Appendix E: Evaluator 詳細](../../addenda/E_Evaluator_Details.md) の Hybrid Evaluator（LLM + Rule）の PoC を、Persona 毎にゴールデンシナリオを追加して検証する。
- 中期: Katamari Evaluator SDK の導入準備として、`docs/addenda/M_Versioning_Release.md` に沿ったセマンティックバージョニングと互換 API を整備し、Birdseye Caps を用いた依存追跡を強化する。
