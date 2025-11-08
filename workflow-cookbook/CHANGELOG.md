---
intent_id: INT-001
owner: your-handle
status: active   # draft|active|deprecated
last_reviewed_at: 2025-10-14
next_review_due: 2025-11-14
---

# Changelog

## [Unreleased]

### Changed

- 0007: `CHECKLISTS.md` に Development / Pull Request / Ops チェックリストを追加し、Release セクションが新設項目と重複しないよう参照構造へ更新
- 0008: 過去のブランド表現をワークフロー向けの共通名称・リンクへ差し替え、関連チェックリストとメトリクス定義の整合性を再確認
- 0009: `<旧ブランド名>` 参照を中立表現へ整理
- 0010: ブランド非依存の表現へ整理し、`CHANGELOG.md` と `CHECKLISTS.md` の記述を同期
- 0011: `docs/Release_Checklist.md` に上流同期確認のチェック項目を追加し、`docs/UPSTREAM*.md` とのリンクを明示
- 0012: `EVALUATION.md` の KPI 定義を `governance/metrics.yaml` と同期し、`RUNBOOK.md#Observability` と相互参照するリンクを追加
- 0013: `EVALUATION.md` の KPI を目的・収集方法・目標値付きの表形式へ整理し、`RUNBOOK.md#Observability` の手順と整合させた
- 0014: `docs/security/SAC.md` の対象範囲を運用UIカテゴリへ一般化し、特定UI名称への依存を排除
- 0015: `docs/security/SAC.md` の SAC 対象説明を運用系 Web UI として再定義し、特定製品前提を除去
- 0016: `RUNBOOK.md` に外部通信承認フローを追加し、`docs/addenda/G_Security_Privacy.md` の参照内容を同期
- 0017: `datasets/README.md` を新設し、データ保持レビューで参照するデータセット管理手順を整備
- 0018: セキュリティゲート CI（`.github/workflows/security.yml`）を追加し、SAST/Secrets/依存/Container 検証を直列実行で整備
- 0019: `docs/addenda/G_Security_Privacy.md` のセキュリティゲート参照を
  [`.github/workflows/security.yml`](../../.github/workflows/security.yml) へ更新
- 0020: `docs/addenda/G_Security_Privacy.md` から旧 `ci/security.yml` 参照を排除し、CI 手順のリンクを現行構成へ揃えた
- 0021: `security-ci.yml` の Bandit 対象を実在する Python ソースへ更新し、検出時に失敗するゲートへ修正
- 0022: `.github/workflows/reusable/security-ci.yml` の Bandit 監査範囲を `tests` へ拡張し、`safety` ステップの戻り値を尊重
- 0023: `reusable/security-ci.yml` の Bandit 対象ディレクトリを明示し、Secrets/依存診断の失敗を許容しないよう `safety` ゲートを修正
- 0024: `.github/workflows/reusable/security-ci.yml` の Safety 検出で GitHub Actions/`act` が失敗することを次の手順で確認
  1. 脆弱バージョンの依存（例: `pip install 'urllib3==1.25.8'`）を一時的に追加してブランチを作成する
  2. `act -j dep_audit -W .github/workflows/reusable/security-ci.yml --input python-version=3.11`
  3. `safety check --exit-code 1` ステップが非ゼロ終了し、ジョブ全体が失敗することを確認する（GitHub Actions 上でも同様）
- 0025: `.github/workflows/labels-sync.yml` の `concurrency` ブロックをガイド記載の配置へ整え、`.github/workflows/security.yml` と同一形式となることを確認

## 0.1.0 - 2025-10-13

- 0001: 初版（MD一式 / Codex対応テンプレ含む）

## 1.0.0 - 2025-10-16

### Added

- 0002: Stable Template API（主要MDの凍結）
- 0003: PR運用の明確化（Intent / EVALUATION リンク / semverラベル）
- 0004: CIワークフロー（links/prose/release）

### Known limitations

- 0005: SLOバッジ自動生成は未実装（README と policy.yaml を手動同期）
- 0006: Canary 連携は任意
