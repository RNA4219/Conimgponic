# 要件（Requirements）

Katamari `docs/Katamari_Requirements_v3_ja.md` の章立てを踏襲し、Day8 の反省パイプラインに適用した要件定義です。Collector / Analyzer / Reporter / Proposer / Governance の責務分離は [ADR 0001](../../adr/0001-collector-analyzer-reporter-pipeline.md)・[ADR 0003](../../adr/0003-propose-only-governance.md) を参照し、本書はその上位制約と受入判定軸を集約します。

## 固定事項（Fixed）
- **propose-only の厳守** — 自動化は Issue / Draft PR の提案に限定し、Git ツリーへの直接コミットは禁止する。逸脱時は [Day8 Release Checklist](../../Release_Checklist.md) と [Appendix J Runbook](../../addenda/J_Runbook.md) に従い是正する。
- **ワークスペース境界** — GitHub Actions では `defaults.run.working-directory=workflow-cookbook/` を必須とし、Collector から Analyzer への引き渡しでサブディレクトリ越しのファイル参照を許容する。
- **ログの一次形式** — 解析対象は `workflow-cookbook/logs/*.jsonl` に配置する JSON Lines（UTF-8, LF）で統一し、Collector は [JSONL イベント契約](../../adr/0002-jsonl-event-contract.md) を満たすレコードのみを Analyzer に渡す。
- **秘密情報の遮断** — Secrets/API トークン/PII の含まれるログは収集禁止。やむを得ない場合は [Appendix G Security & Privacy](../../addenda/G_Security_Privacy.md) のマスク手順を実行する。

## スコープ
- **対象コンポーネント** — Day8 の反省（Reflection）パイプライン全体。Collector による CI/テスト/運用ログの取り込み、Analyzer のヒューリスティック分析、Reporter の日次レポート生成、Proposer による改善提案までを含む。
- **対象リポジトリ** — 本リポジトリと `workflow-cookbook/` サブツリー。外部依存は参照のみで書き込み禁止。
- **対象タイムライン** — 日次バッチ（Actions 手動/スケジュール起動）と手動トリガー。イベントドリブン運用は将来検討とし、本要件には含めない。

## ユースケース
1. **CI 失敗の振り返り** — `workflow-cookbook/logs/test.jsonl` を取り込み、`reports/today.md` に失敗テストの要約と再現ステップを掲載。必要に応じ [docs/TASKS.md](../../TASKS.md) 形式の Task Seed 下書きを Proposer が添付する。
2. **運用インシデントの一次整理** — `workflow-cookbook/logs/incident.jsonl`（RUNBOOK に沿ったタグ付け）を解析し、[Appendix J Runbook](../../addenda/J_Runbook.md) の初動ステップに沿ったインシデント要約とフォローアップ TODO を出力する。
3. **改善アイデアの backlog 化** — Analyzer がヒューリスティックで改善候補を検出した場合、Proposer が Draft PR ではなく Issue テンプレート（`docs/seeds/` の Task Seed）を生成し、ガバナンスの承認待ちに回す。

## 機能要件（FR）
1. **反省パイプラインの自動実行** — `workflow-cookbook/tools/codemap/update.py` 等の CI 成果物と連携し、入力ログから Analyzer が指標計算を行い、Reporter が `reports/today.md` を生成する。生成時は [Appendix E Evaluator Details](../../addenda/E_Evaluator_Details.md) のメトリクス閾値を参照する。
2. **提案成果物の生成** — Reporter がまとめた改善候補は Proposer により Issue 草案（`docs/seeds/TASK.<slug>-YYYY-MM-DD.md`）として保存できる。Draft PR を出す場合も propose-only を厳守し、`workflow-cookbook/CHANGELOG.md` には直接書き込まない。
3. **自動改変の抑止** — 本番コードや `workflow-cookbook/` 外ディレクトリへの書き込みは禁止。差分は Issue/Draft PR の添付ファイルに限定し、Git 操作は人間レビューを経て適用する。
4. **サブディレクトリ運用** — `defaults.run.working-directory` 設定を利用し、Collector が `workflow-cookbook/` 配下のログを処理しつつ `reports/`（ルート配下）へ成果物を配置できるようにする。

## 非機能要件（NFR）
- **冪等性** — 同一ログに対し同一レポート・提案が得られること。ハッシュ比較は [Appendix M Versioning & Release](../../addenda/M_Versioning_Release.md) に従い CI で検証する。
- **可観測性** — 実行ログは JSON 形式で GitHub Actions Artifacts に保存できること。`workflow-cookbook/tools/codemap/update.py --emit index+caps` を組み合わせ、Birdseye への反映手順（[docs/BIRDSEYE.md](../../BIRDSEYE.md)）と整合させる。
- **拡張性** — Analyzer はヒューリスティック実装から LLM 実装へ差し替え可能であること。差し替え時は [Appendix D Trim Design](../../addenda/D_Trim_Design.md) を活用し、コストインパクトを ±5% 以内に収める。
- **アクセシビリティ** — `reports/today.md` は [Appendix K Accessibility & UX](../../addenda/K_Accessibility_UX.md) の配色・代替テキスト基準を満たす。
- **セキュリティ** — PII/Secrets を含むログを扱う場合は [Appendix G Security & Privacy](../../addenda/G_Security_Privacy.md) のマスキング・保管ポリシーを適用し、エスカレーションは [workflow-cookbook/SECURITY.md](../../../workflow-cookbook/SECURITY.md) に従う。

## データモデル
- **入力（JSONL レコード）**
  - 必須フィールド: `timestamp` (ISO8601), `source` (`ci` / `ops` / `qa`), `severity` (`info` / `warning` / `error`), `message` (UTF-8), `artifact_path` (相対パス)。
  - 任意フィールド: `run_id`, `workflow`, `tags`（[Appendix J Runbook](../../addenda/J_Runbook.md) に定義されたタグセット）。
  - バリデーション: フィールド欠落時は Collector がレコードを破棄し、Reporter へ通知する。
- **出力**
  - `reports/today.md`: ヘッダー（日時/対象ログ）、サマリ（成功/失敗件数、重要警告）、詳細（ログエントリ抜粋、対応状況）、フォローアップ（Task Seed 参照）。
  - `reports/today.json`: Analyzer の内部スコアとメタデータ（optional, [Appendix E Evaluator Details](../../addenda/E_Evaluator_Details.md) のスコアリングを保持）。
  - `docs/seeds/TASK.<slug>-YYYY-MM-DD.md`: Proposer が Issue 化した場合のテンプレート下書き。

## 受入基準
- `workflow-cookbook/logs/test.jsonl` を入力して `reports/today.md` を再生成した際、前回成果物との差分が評価指標更新によるものだけであること（冪等性確認）。
- Reporter が生成した `reports/today.md` 内の TODO が [Appendix J Runbook](../../addenda/J_Runbook.md) の初動手順と矛盾しない。
- Proposer が出力する Issue 草案が [docs/TASKS.md](../../TASKS.md) のテンプレート構造（背景/手順/検証ログ/フォローアップ）を保持している。
- GitHub Actions ワークフローで Artifact 化したログが [Appendix G Security & Privacy](../../addenda/G_Security_Privacy.md) のマスキング基準を満たし、Secrets が含まれない。

## マイルストーン
1. **M0: Collector ベースライン確立** — JSONL 契約の実装・検証を完了し、`workflow-cookbook/logs/` から `reports/today.md` を生成できる。依存資料: ADR 0001/0002。
2. **M1: 可観測性と評価ライン整備** — [Appendix E Evaluator Details](../../addenda/E_Evaluator_Details.md) の評価指標と [Appendix M1 Metrics + Healthz ADR](../../addenda/M1_Metrics_Healthz_ADR.md) を満たすメトリクス収集を Actions 上で実装。`docs/birdseye/index.json` / `hot.json` を同期する。
3. **M2: propose-only ガバナンス統合** — Proposer が Issue 草案を `docs/seeds/` に配置し、[workflow-cookbook/governance/policy.yaml](../../../workflow-cookbook/governance/policy.yaml) に沿った承認フローで運用できる。
4. **M3: LLM Analyzer パイロット** — [Appendix D Trim Design](../../addenda/D_Trim_Design.md) のトリム設計を適用し、LLM ベース Analyzer を試験導入。コスト増が ±5% を超える場合は Task Seed でフォローアップを起票する。
