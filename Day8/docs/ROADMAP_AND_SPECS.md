# Day8 ロードマップ & 仕様メモ

プロジェクト全体の現在地と次の一手を素早く把握するためのガイドです。既存ドキュメントの骨格を保ちつつ、各資料の読みどころを短くまとめました。迷ったときはここから辿れば、必要な一次資料に直接到達できます。

## 1. 上位ドキュメント索引

### Guardrails ナレッジマップ

| ドキュメント | 目的 | 参照タイミング |
| --- | --- | --- |
| [workflow-cookbook/HUB.codex.md](../workflow-cookbook/HUB.codex.md) | Day8 の変更要求を Katamari 側のイベントにマッピングし、必要な一次資料を抽出する | 新規課題が発生した直後に参照し、影響範囲を整理するとき |
| [workflow-cookbook/GUARDRAILS.md](../workflow-cookbook/GUARDRAILS.md) | 設計判断とレビュー基準を制約として明文化する | HUB の観測内容を踏まえ、設計方針を決めるタイミング |
| [workflow-cookbook/BLUEPRINT.md](../workflow-cookbook/BLUEPRINT.md) | プロセスの骨格と Day8 仕様との差分を可視化する | Guardrails を適用した後、要件と画面仕様を整合させるとき |
| [workflow-cookbook/RUNBOOK.md](../workflow-cookbook/RUNBOOK.md) | 運用手順と検証ステップを決め、Day8 側の ops/quality 文書と同期する | 実装プランが固まったら運用・品質更新前に確認するとき |
| [workflow-cookbook/EVALUATION.md](../workflow-cookbook/EVALUATION.md) | RUNBOOK に定義した手順が満たすべき評価指標と計測方法を整備する | Runbook を改訂した直後や品質ゲートの更新判断時 |
| [workflow-cookbook/CHECKLISTS.md](../workflow-cookbook/CHECKLISTS.md) | RUNBOOK のアクションをレビューフローに合わせた実行チェックへブレークダウンする | Evaluation の結果を反映し、運用・レビュー実行前に順序を確認するとき |
| [workflow-cookbook/TASK.codex.md](../workflow-cookbook/TASK.codex.md) | 実行タスクを分解し、Day8 の実装・テスト項目へ落とし込む | Checklists を踏まえて具体的なタスク化や Issue 起票時 |
| [workflow-cookbook/SECURITY.md](../workflow-cookbook/SECURITY.md) | セキュリティ例外や脅威対応の承認プロセスと責務を定義する | Task を起票し、リスク緩和策や例外申請を組み込むとき |
| [workflow-cookbook/SAFETY.md](../workflow-cookbook/SAFETY.md) | 倫理・安全配慮の判断基準とハンドリング動線を明文化する | Security の結論を踏まえて人・社会影響の最終確認をするとき |

### Guardrails 文書概要

- [workflow-cookbook/HUB.codex.md](../workflow-cookbook/HUB.codex.md): 変更要求を Katamari の観測イベントへ対応付け、初動で必要な資料一覧を洗い出すときに使う。
- [workflow-cookbook/GUARDRAILS.md](../workflow-cookbook/GUARDRAILS.md): HUB で得た課題を制約条件に落とし込み、設計判断やレビュー方針を確定したいタイミングで参照する。
- [workflow-cookbook/BLUEPRINT.md](../workflow-cookbook/BLUEPRINT.md): Guardrails を踏まえた理想プロセスと Day8 差分を記録し、仕様・要件を整理する際に確認する。
- [workflow-cookbook/RUNBOOK.md](../workflow-cookbook/RUNBOOK.md): BLUEPRINT に沿って運用手順を更新し、リリースや運用変更の作業前に参照する。
- [workflow-cookbook/EVALUATION.md](../workflow-cookbook/EVALUATION.md): RUNBOOK の更新内容が満たすべき評価指標と測定プロセスを整理し、品質ゲートの更新や指標見直し時に参照する。
- [workflow-cookbook/CHECKLISTS.md](../workflow-cookbook/CHECKLISTS.md): RUNBOOK・EVALUATION の結果をチェック項目へ展開し、品質ゲートを適用するレビュー・運用の直前に順序と抜け漏れを点検する。
- [workflow-cookbook/TASK.codex.md](../workflow-cookbook/TASK.codex.md): Guardrails で確定した作業を実装タスクに分解し、Checklists の反映後に Issue 作成やスプリント計画時へ活用する。
- [workflow-cookbook/SECURITY.md](../workflow-cookbook/SECURITY.md): タスク化した変更に潜むリスク対応や例外承認のルールを確認し、セキュリティ緩和策を手順へ織り込む。
- [workflow-cookbook/SAFETY.md](../workflow-cookbook/SAFETY.md): Security で整理したリスクのうち倫理・安全面の追加確認が必要な項目を洗い出し、最終判断のガードを適用する。

### ADR ハイライト（設計判断の根拠）

- [docs/adr/0001-collector-analyzer-reporter-pipeline.md](adr/0001-collector-analyzer-reporter-pipeline.md): Collector / Analyzer / Reporter を 3 層で運用し、ログ処理の責務を分離する決定。
- [docs/adr/0002-jsonl-event-contract.md](adr/0002-jsonl-event-contract.md): Collector が出力する JSONL スキーマと Analyzer の検証手順を規定し、`workflow-cookbook/logs/` の品質を保証する。
- [docs/adr/0003-propose-only-governance.md](adr/0003-propose-only-governance.md): Reporter/Proposer が propose-only を遵守し、`governance/policy.yaml` の制約タグと連携する運用境界を定義する。

上記の流れで HUB → Guardrails → Blueprint → Runbook → Evaluation → Checklists → Task → Security → Safety の順に確認したら、本節の索引表と「## 2. 実装モジュールと対応仕様」へ進み、Day8 側の更新対象とトレーサビリティを確定させる。

| 種別 | 主な用途 | Day8 リポジトリ | workflow-cookbook | 備考 |
| --- | --- | --- | --- | --- |
| 要求 | ユーザー課題の把握とスコープ設定 | [docs/day8/spec/01_requirements.md](day8/spec/01_requirements.md) | [workflow-cookbook/BLUEPRINT.md](../workflow-cookbook/BLUEPRINT.md) | Katamari 章立てを Day8 固有の固定事項/ユースケース/FR/NFR/データモデル/受入基準/マイルストーンへ翻訳し、Appendix G/J/K/M1 と Release Checklist を同時確認 |
| 仕様 | 画面・ユースケースの確定版 | [docs/day8/spec/02_spec.md](day8/spec/02_spec.md) | [workflow-cookbook/HUB.codex.md](../workflow-cookbook/HUB.codex.md) | HUB の自動タスク分解と整合させる |
| 設計 | アーキテクチャと責務分担 | [docs/day8/design/03_architecture.md](day8/design/03_architecture.md) / [docs/Architecture_ASCII.md](Architecture_ASCII.md) | [workflow-cookbook/GUARDRAILS.md](../workflow-cookbook/GUARDRAILS.md) | 設計判断を Guardrails の原則に沿って記録 |
| 運用・品質 | リリース手順と品質ゲート | [docs/day8/ops/04_ops.md](day8/ops/04_ops.md) / [docs/day8/quality/06_quality.md](day8/quality/06_quality.md) / [docs/addenda/H_Deploy_Guide.md](addenda/H_Deploy_Guide.md) | [workflow-cookbook/RUNBOOK.md](../workflow-cookbook/RUNBOOK.md) / [workflow-cookbook/CHECKLISTS.md](../workflow-cookbook/CHECKLISTS.md) / [workflow-cookbook/EVALUATION.md](../workflow-cookbook/EVALUATION.md) | 承認フローと計測指標を同期 |
| セキュリティ | 脅威モデリングと権限設計 | [docs/day8/security/05_security.md](day8/security/05_security.md) / [docs/addenda/G_Security_Privacy.md](addenda/G_Security_Privacy.md) | [workflow-cookbook/SECURITY.md](../workflow-cookbook/SECURITY.md) | Appendix G で Secrets/ログ/通信の運用ノートを同期し、例外申請は SECURITY.md の承認フローに従う |
| 安全性レビュー | 倫理・安全配慮の基準 | [docs/safety.md](safety.md) | [workflow-cookbook/SAFETY.md](../workflow-cookbook/SAFETY.md) | Appendix G・SECURITY からのハンドオフを受け、フェイルセーフと Hot 更新手順を適用 |
| ガバナンス | 優先度・承認ルール | [governance/policy.yaml](../governance/policy.yaml) | [workflow-cookbook/governance/policy.yaml](../workflow-cookbook/governance/policy.yaml) / [workflow-cookbook/governance/prioritization.yaml](../workflow-cookbook/governance/prioritization.yaml) | Katamari ガバナンスに倣い意思決定を記録 |

## 2. 実装モジュールと対応仕様

| 領域 | Day8 側の主要ディレクトリ | 参照すべき仕様/設計 | workflow-cookbook の対応資料 | 補足 |
| --- | --- | --- | --- | --- |
| 要求・仕様トレーサビリティ | `docs/day8/spec/` / `docs/day8/design/` | [docs/day8/spec/01_requirements.md](day8/spec/01_requirements.md) / [docs/day8/spec/02_spec.md](day8/spec/02_spec.md) / [docs/day8/design/03_architecture.md](day8/design/03_architecture.md) | [workflow-cookbook/BLUEPRINT.md](../workflow-cookbook/BLUEPRINT.md) / [workflow-cookbook/GUARDRAILS.md](../workflow-cookbook/GUARDRAILS.md) | スプリント冒頭に差分確認 |
| オペレーション & QA | `docs/day8/ops/` / `docs/day8/quality/` | [docs/day8/ops/04_ops.md](day8/ops/04_ops.md) / [docs/day8/quality/06_quality.md](day8/quality/06_quality.md) / [docs/addenda/M1_Metrics_Healthz_ADR.md](addenda/M1_Metrics_Healthz_ADR.md) | [workflow-cookbook/RUNBOOK.md](../workflow-cookbook/RUNBOOK.md) / [workflow-cookbook/CHECKLISTS.md](../workflow-cookbook/CHECKLISTS.md) / [workflow-cookbook/EVALUATION.md](../workflow-cookbook/EVALUATION.md) | CI・運用承認の判断基準を同期し、`/healthz` と MetricsRegistry の移行タイムラインを追跡 |
| セキュリティ & レジリエンス | `docs/day8/security/` / `docs/birdseye/` / `docs/safety.md` | [docs/day8/security/05_security.md](day8/security/05_security.md) / [docs/safety.md](safety.md) | [workflow-cookbook/SECURITY.md](../workflow-cookbook/SECURITY.md) / [workflow-cookbook/SAFETY.md](../workflow-cookbook/SAFETY.md) | 監査ログと例外手続きの窓口を共有 |
| 自動化・CI パイプライン | `tools/` / `scripts/` | [docs/day8/quality/06_quality.md](day8/quality/06_quality.md) / [docs/day8/examples/10_examples.md](day8/examples/10_examples.md) | [workflow-cookbook/scripts/run_ci_tests.py](../workflow-cookbook/scripts/run_ci_tests.py) / [workflow-cookbook/CHECKLISTS.md](../workflow-cookbook/CHECKLISTS.md) | mypy/ruff/pytest/node:test のゲート維持 |
| ガバナンス・優先度管理 | `governance/` / `docs/ROADMAP_AND_SPECS.md` | [governance/policy.yaml](../governance/policy.yaml) / 本ページ | [workflow-cookbook/governance/policy.yaml](../workflow-cookbook/governance/policy.yaml) / [workflow-cookbook/governance/prioritization.yaml](../workflow-cookbook/governance/prioritization.yaml) / [workflow-cookbook/HUB.codex.md](../workflow-cookbook/HUB.codex.md) | Katamari 承認フローを Day8 に反映 |

## 3. ロードマップ

1. <a id="roadmap-step1"></a>**索引・基準整備** — Guardrails フローでの差分承認（[workflow-cookbook/GUARDRAILS.md](../workflow-cookbook/GUARDRAILS.md) 更新) 直後、同一 PR のレビュー完了時点で差分検知を行い、本ページと [docs/day8/spec](day8/spec/) を照合する。Katamari 版の索引（[workflow-cookbook/HUB.codex.md](../workflow-cookbook/HUB.codex.md)）との差異を毎スプリントで解消し、ガバナンス更新（[workflow-cookbook/governance/policy.yaml](../workflow-cookbook/governance/policy.yaml)）と併せて Birdseye 更新のハンドオフを確認する。入口手順はルート [README](../README.md) の LLM-BOOTSTRAP に従い、`docs/ROADMAP_AND_SPECS.md` → `docs/birdseye/index.json` → `docs/birdseye/caps/` → `docs/birdseye/hot.json` の順で参照する。差分は [docs/birdseye/index.json](birdseye/index.json) にも反映する。Guardrails を更新したら、Step1 の一部として Birdseye 反映 4 ステップを再実行し、索引と可視化の整合を確保する。運用手順は [docs/birdseye/README.md](birdseye/README.md) に従い、必ず「index → caps → hot」の順で更新し `generated_at` を同期させる。
2. **自動化ゲートの維持** — `tools/` / `scripts/` の CI エントリポイントを見直し、[workflow-cookbook/scripts/run_ci_tests.py](../workflow-cookbook/scripts/run_ci_tests.py) で実行される mypy / ruff / pytest / node:test の整合を保証。チェックリスト更新時は [docs/day8/quality/06_quality.md](day8/quality/06_quality.md) を同時改訂する。
3. **実装・検証のアップデート** — [docs/day8/design/03_architecture.md](day8/design/03_architecture.md) に基づき実装やテストの差分をまとめ、[docs/day8/examples/10_examples.md](day8/examples/10_examples.md)・[docs/day8/guides/07_contributing.md](day8/guides/07_contributing.md) を更新。Katamari の [workflow-cookbook/CHANGELOG.md](../workflow-cookbook/CHANGELOG.md) に成果を同期する。
4. **リリース・承認フロー** — フェーズ完了ごとに [docs/day8/ops/04_ops.md](day8/ops/04_ops.md) と [workflow-cookbook/RUNBOOK.md](../workflow-cookbook/RUNBOOK.md) を突き合わせ、[workflow-cookbook/governance/policy.yaml](../workflow-cookbook/governance/policy.yaml) の承認記録を更新。`/healthz` と MetricsRegistry の移行計画は [docs/addenda/M1_Metrics_Healthz_ADR.md](addenda/M1_Metrics_Healthz_ADR.md) を参照し、リリース判定前にヘルスチェック・メトリクスを検証する。例外は [docs/safety.md](safety.md) の安全審査に連携。

### 更新手順

1. **BLUEPRINT を起点に制約と仕様を固める** — [workflow-cookbook/BLUEPRINT.md](../workflow-cookbook/BLUEPRINT.md) と [docs/day8/spec/01_requirements.md](day8/spec/01_requirements.md) / [docs/day8/spec/02_spec.md](day8/spec/02_spec.md) を照合し、[workflow-cookbook/GUARDRAILS.md](../workflow-cookbook/GUARDRAILS.md) の原則との齟齬を潰す。
2. **RUNBOOK / CHECKLISTS を同期** — [workflow-cookbook/RUNBOOK.md](../workflow-cookbook/RUNBOOK.md)・[workflow-cookbook/CHECKLISTS.md](../workflow-cookbook/CHECKLISTS.md) と [docs/day8/ops/04_ops.md](day8/ops/04_ops.md) / [docs/day8/quality/06_quality.md](day8/quality/06_quality.md) を突き合わせ、運用動線とゲート条件を更新する。
3. **EVALUATION で評価指標を確定** — [workflow-cookbook/EVALUATION.md](../workflow-cookbook/EVALUATION.md) と [docs/day8/quality/06_quality.md](day8/quality/06_quality.md) の測定軸を反映し、CI/レビュー判定の調整を記録する。
4. **TASK seed を起票** — [workflow-cookbook/TASK.codex.md](../workflow-cookbook/TASK.codex.md) と [workflow-cookbook/HUB.codex.md](../workflow-cookbook/HUB.codex.md) の対応表を用いて、Issue テンプレートとチェックリストの追従タスクを作成する。
5. **Birdseye / ADR の整合を取る** — [docs/birdseye/index.json](birdseye/index.json)・[docs/day8/design/03_architecture.md](day8/design/03_architecture.md) を更新し、可視化ビューと設計判断を [workflow-cookbook/CHANGELOG.md](../workflow-cookbook/CHANGELOG.md) へ反映する。

> Guardrails 群を更新した場合は、必ず本 ROADMAP（`docs/ROADMAP_AND_SPECS.md`）も同じ PR で同期し、差分根拠を併記すること。
>
> 参照チェック（PR 本文に記載）:
> - Guardrails 文書群 — [workflow-cookbook/HUB.codex.md](../workflow-cookbook/HUB.codex.md) / [workflow-cookbook/GUARDRAILS.md](../workflow-cookbook/GUARDRAILS.md) / [workflow-cookbook/BLUEPRINT.md](../workflow-cookbook/BLUEPRINT.md) / [workflow-cookbook/RUNBOOK.md](../workflow-cookbook/RUNBOOK.md) / [workflow-cookbook/EVALUATION.md](../workflow-cookbook/EVALUATION.md) / [workflow-cookbook/CHECKLISTS.md](../workflow-cookbook/CHECKLISTS.md) / [workflow-cookbook/TASK.codex.md](../workflow-cookbook/TASK.codex.md) / [workflow-cookbook/SECURITY.md](../workflow-cookbook/SECURITY.md) / [workflow-cookbook/SAFETY.md](../workflow-cookbook/SAFETY.md)
- Birdseye 連携 — [docs/birdseye/README.md](birdseye/README.md)（更新順序と `generated_at` 同期の必須手順を参照） / [docs/birdseye/index.json](birdseye/index.json) / [docs/BIRDSEYE.md](BIRDSEYE.md)（Guardrails 参照順と `edges` チェックポイントのフォールバック手順を参照）

## 4. 参照クイックリンク

- [Katamari ガードレール](../workflow-cookbook/GUARDRAILS.md)
- [運用 RUNBOOK](../workflow-cookbook/RUNBOOK.md)
- [品質チェックリスト](../workflow-cookbook/CHECKLISTS.md)
- [Day8 Release Checklist (Katamari Flow)](Release_Checklist.md)
- [Versioning & Release Operations（Appendix M）](addenda/M_Versioning_Release.md)
- [Day8 コントリビューションガイド](day8/guides/07_contributing.md)
- [安全性レビュー基準](safety.md)
- [セキュリティ & プライバシー付録（Appendix G）](addenda/G_Security_Privacy.md)
- [ガバナンス方針](../workflow-cookbook/governance/policy.yaml)
- [Birdseye フォールバック手順](BIRDSEYE.md)
- [Day8 Architecture ASCII Map](Architecture_ASCII.md)
- [Birdseye 反映 4 ステップ（ロードマップ Step1 の必須作業）](#roadmap-step1)
  1. **ノード追加** — [docs/birdseye/index.json](birdseye/index.json) に該当エントリを追加・更新し、`mtime` を差分検知時刻へ合わせる。
  2. **Capsule 更新** — `docs/birdseye/caps/` 配下の対象 Capsule を差分内容へ反映し、役割・保守手順を同期させる。
  3. **hot.json 更新** — [docs/birdseye/hot.json](birdseye/hot.json) の `reason` を最新フローへ揃え、重点参照ポイントを再評価する。
  4. **generated_at 揃え** — `index.json` / `hot.json` 双方の `generated_at` を同一値へ更新し、Birdseye 再生成の履歴を同期する。
- [Day8 Upstream 運用ガイド](UPSTREAM.md)
- [Day8 Upstream 週次ログ テンプレート](UPSTREAM_WEEKLY_LOG.md)

## ライセンス

- Day8 リポジトリ: [LICENSE](../LICENSE)
- workflow-cookbook: [workflow-cookbook/LICENSE](../workflow-cookbook/LICENSE)
