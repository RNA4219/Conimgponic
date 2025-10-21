# Day8 ドキュメント索引

Day8 の仕様・設計・運用資料を一覧化した索引用ページです。必要なトピックへ素早くアクセスするための起点として利用してください。

## ハブドキュメント
- [Day8 ROADMAP & SPECS ハブ](ROADMAP_AND_SPECS.md) — Guardrails や workflow-cookbook との横断整合を確認する際の起点。
  - 参照優先度: 横断計画・ロードマップの確認は本ハブ→本索引の順、Day8 専用ディレクトリの詳細閲覧は本索引を優先。

## Day8 コア資料
- [Day8 Docs 総覧](day8/README.md) — サブディレクトリ構成とドキュメント群の概要。

## Architecture Decision Records (ADR)
- [ADR 目次](adr/README.md) — Collector / Analyzer / Reporter の設計判断や propose-only 運用方針を整理した記録。
- [ADR 0001: Collector/Analyzer/Reporter の 3 層パイプライン](adr/0001-collector-analyzer-reporter-pipeline.md)
- [ADR 0002: JSONL イベント契約と Analyzer 連携](adr/0002-jsonl-event-contract.md)
- [ADR 0003: Propose-only 運用と Governance 境界](adr/0003-propose-only-governance.md)

## 仕様・設計
- [要件（Requirements）](day8/spec/01_requirements.md) — Katamari 章立てに沿って固定事項/スコープ/ユースケース/FR/NFR/データモデル/受入基準/マイルストーンを整理し、Appendix G/J/K/M1 などの参照を束ねた要件ハブ。
- [仕様詳細（Spec）](day8/spec/02_spec.md) — ワークフローとコンポーネントの具体的な仕様。
- [アーキテクチャ](day8/design/03_architecture.md) — システム構成とアーキテクチャガイドライン。
  - ASCII フォールバック: [Day8 Architecture ASCII Map](Architecture_ASCII.md) — Mermaid が読めない環境で Collector/Analyzer/Reporter/Proposer/Governance の流れを再確認するときに利用。

## 運用・セキュリティ・品質
- [運用ガイド](day8/ops/04_ops.md) — 導入・運用フローとサブディレクトリ管理手順。
- [Day8 デプロイ付録（Appendix H）](addenda/H_Deploy_Guide.md) — ローカル検証、Docker 化、GitHub Actions リリースの要点をまとめた導入補助資料。
- [Day8 設定リファレンス（Appendix L）](addenda/L_Config_Reference.md) — 環境変数・設定ファイル・デバッグフラグを網羅し、導入前チェックリストとして活用できる設定付録。
- [Day8 Release Checklist (Katamari Flow)](Release_Checklist.md) — propose-only 前提のリリース手順と Birdseye 更新順を整理したチェックリスト。
- [Versioning & Release Operations（Appendix M）](addenda/M_Versioning_Release.md) — semver ラベル運用とタグ作成フロー、互換性レビューの基準を集約。
- [Day8 評価器構成（Appendix E）](addenda/E_Evaluator_Details.md) — BERTScore/ROUGE/ルール判定の設定と運用チェックリスト。
- [セキュリティ指針](day8/security/05_security.md) — セキュリティ/ガバナンスポリシーと対応方針。Appendix G と連携し、Secrets/Rate limit/OAuth のチェックリストを提供。
- [品質評価](day8/quality/06_quality.md) — メトリクス、SLO、評価プロセス。

## Upstream 運用
- [Day8 Fork Notes](FORK_NOTES.md) — Katamari 本家の Fork Notes を補完し、Day8 固有の追加コンポーネント・依存・ライセンス同梱ルールを確認する際の入口。
- [Day8 Upstream 運用ガイド](UPSTREAM.md) — Katamari ワークフロー資産との同期手順と週次チェックの基準。
- [Day8 Upstream 週次ログ テンプレート](UPSTREAM_WEEKLY_LOG.md) — 週次レビュー用の記録テンプレート。

## 貢献・サンプル
- [貢献ガイド](day8/guides/07_contributing.md) — 貢献手順とタスク運用ルール。
- [サンプル集](day8/examples/10_examples.md) — 反省 DSL やガバナンス設定のサンプル。

## セーフティ関連
- [安全性ドキュメント](safety.md) — `workflow-cookbook/SAFETY.md` をハブとし、フェイルセーフ/例外/Hot 更新手順を整理。
- [セキュリティ & プライバシー付録（Appendix G）](addenda/G_Security_Privacy.md) — キー管理・ログ衛生・データ保持・通信保護・OAuth ガードの運用ノート。

## 付録
- [Day8 用語集](addenda/A_Glossary.md) — ドキュメントレビューや新規タスク着手前に、Collector/Analyzer などの用語を素早く再確認するための参照先。
- [トリム設計付録（Appendix D）](addenda/D_Trim_Design.md) — Sliding Window / Semantic / Memory Hybrid の圧縮戦略と保持率指標を整理し、ログトリムの判断と Birdseye メタデータ整合の根拠を提供。
- [UI モック（Appendix B）](addenda/B_UI_Mock.md) — 画面共有できない環境で CLI/レポートの骨子をレビューし、Day8 の主要画面を擦り合わせるときに利用。
- [プロバイダーマトリクス（Appendix F）](addenda/F_Provider_Matrix.md) — モデル差分調査やフォールバック順序の確認時に、Day8 が許容するプロバイダー構成と運用ガードを参照。
