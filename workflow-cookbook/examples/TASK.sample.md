---
intent_id: INT-999
owner: sample-author
status: active
last_reviewed_at: 2025-01-15
next_review_due: 2025-02-15
---

# Task Seed Sample

## メタデータ

```yaml
task_id: 20250115-01
repo: https://github.com/example/workflow-cookbook-sample
base_branch: main
work_branch: feat/add-slo-reports
priority: P2
langs: [python, typescript]
```

## Objective

SLO レポート生成ワークフローの自動化手順を整備する。

## Scope

- In: docs/slo/**, tools/reporting/**, github-workflows/slo-report.yml
- Out: backend/api/**, frontend/**, infra/terraform/**

## Requirements

- Behavior:
  - `python tools/reporting/generate.py` で週次レポートが生成される。
  - GitHub Actions から同スクリプトを呼び出し、成果物をアーティファクトとして保存する。
- I/O Contract:
  - Input: `config/slo.yaml`（閾値と対象サービス名を含む YAML）
  - Output: `artifacts/slo-report-<date>.md`（Markdown レポート）
- Constraints:
  - 既存API破壊なし / 不要な依存追加なし
  - Lint/Type/Test はゼロエラー
- Acceptance Criteria:
  - 週次レポート作成ジョブが CI で成功する。
  - 生成物にサービス別の SLO/エラー率が記載される。

## Affected Paths

- docs/slo/**
- tools/reporting/**
- .github/workflows/slo-report.yml

## Local Commands（存在するものだけ実行）

```bash
## Python
ruff check docs/slo tools/reporting \
  && mypy --strict tools/reporting \
  && pytest tests/reporting -q

## TypeScript/Node
pnpm lint --filter slo-dashboard && pnpm test --filter slo-dashboard

## Fallback
make ci || true
```

## Deliverables

- PR: タイトル/要約/影響/ロールバックに加え、本文へ `Intent: INT-999` と `## EVALUATION` アンカーを明記
  - 必要なら `Priority Score: 5.0` を追記
- Artifacts: 変更パッチ、テスト、SLO 手順の README 追記、CI ログ

---

## Plan

### Steps

1) docs/slo および tools/reporting の現行フローとテストケースを確認する。
2) 週次レポート生成処理を追加し、CI から呼び出せるよう構成する。
3) 既知の sample::fail ケース（閾値未設定）を再現し、ガード処理を追加する。
4) 成果物検証用のユニットテストとワークフローテストを作成する。
5) ruff / mypy / pytest / pnpm lint / pnpm test を順に実行し全て成功させる。
6) SLO の更新手順を README に追記する。

## Patch

***Provide a unified diff. Include full paths. New files must be complete.***

## Tests

### Outline

- Unit:
  - config/slo.yaml を入力し、閾値内の場合に成功するケース
  - 閾値超過で警告が記録されるケース
- Integration:
  - GitHub Actions から generate.py を実行し、アーティファクトを確認するシナリオ

## Commands

### Run gates

- ruff check docs/slo tools/reporting
- mypy --strict tools/reporting
- pytest tests/reporting -q
- pnpm lint --filter slo-dashboard
- pnpm test --filter slo-dashboard

## Notes

### Rationale

- SLO 監視を自動化し、インシデント検知までのリードタイムを短縮するため。

### Risks

- 設定ファイルのスキーマ変更が既存の分析ジョブに影響する可能性。

### Follow-ups

- SLO ダッシュボードのビジュアル更新を次フェーズで実施する。
