---
intent_id: INT-001
owner: your-handle
status: active   # draft|active|deprecated
last_reviewed_at: 2025-10-14
next_review_due: 2025-11-14
---

# Evaluation

## Acceptance Criteria

- 必須要件（フォーマット・件数・整合性など）
- PR本文に Priority Score（値と根拠）が記録されていること。
- governance/policy.yaml の forbidden_paths を変更しないこと。
- インシデント発生時は docs/IN-YYYYMMDD-XXX.md を作成し、該当PRおよびRUNBOOKから相互リンクする

## KPIs

- compress_ratio: 85%〜115% を許容レンジとし、tools/perf/collect_metrics.py の圧縮統計から週次集計。
- semantic_retention: 95%以上を維持し、tools/perf/collect_metrics.py のレビューログ解析出力をスプリントごとに確認。

## Test Outline

- 単体: 入力→出力の例テーブル
- 結合: 代表シナリオ
- 回帰: 重要パス再確認

## Verification Checklist

- [ ] 主要フローが動作する（手動確認）
- [ ] エラー時挙動が明示されている
- [ ] 依存関係が再現できる環境である
