# Task Seed

## メタデータ

```yaml
task_id: 20251031-02
repo: local://Conimgponic
base_branch: main
work_branch: feat/csv-import-numeric-normalization
priority: P1
langs: [typescript]
status: draft
last_reviewed_at: 2025-10-31
next_review_due: 2025-11-07
```

## Objective

CSV インポート時に `take` などの数値フィールドへ `Number.isFinite` 正規化を徹底し、非数値値が既存/新規シーンへ混入しないようにする。

## Scope

- In: `src/lib/importers.ts`, `tests/lib/importers/mergeCSV.numeric-normalization.spec.ts`, `docs/seeds/TASK.csv-import-numeric-normalization-2025-10-31.md`
- Out: JSONL インポート、Diff Merge UI、CLI コマンド群

## Requirements

- Behavior:
  - CSV の `take`/`seed` が数値文字列なら数値へ正規化し、非数値は無視する。
  - 既存シーン更新・新規シーン追加の双方で `manual`/`ai` テキスト整合性を保つ。
- I/O Contract:
  - Input: CSV テキスト（1 行目ヘッダ、以降データ）
  - Output: Storyboard オブジェクト（`take`/`seed` は有限数のみ適用）
- Constraints:
  - 既存 Storyboard 型・Public API は破壊しない。
  - `pnpm lint`, `pnpm test --filter lib -- --test-name-pattern mergeCSV.numeric-normalization` をグリーンに保つ。
- Acceptance Criteria:
  - 受け入れテストで非数値 `take` がスキップされ、検証ログに入力 CSV・期待シーン状態を残す。

## Affected Paths

- src/lib/importers.ts
- tests/lib/importers/mergeCSV.numeric-normalization.spec.ts

## Local Commands（存在するものだけ実行）

```bash
pnpm test --filter lib -- --test-name-pattern mergeCSV.numeric-normalization
```

## Deliverables

- PR: Intent `INT-001`、数値正規化の根拠とフォールバック挙動、ロールバック不要性の説明
- Notes: 検証ログ（入力 CSV・出力シーン JSON 抜粋）と再現手順

---

## Plan

1) 既存 `mergeCSV` の数値正規化処理を調査し、新規シーン作成分の欠落を特定する。
2) 非数値 `take` が undefined になる RED テストを追加する。
3) `mergeCSV` を更新し、`Number.isFinite` を新規シーンにも適用する。
4) `pnpm test --filter lib -- --test-name-pattern mergeCSV.numeric-normalization` を実行し検証ログを残す。

## Patch

_未着手_

## Tests

- `tests/lib/importers/mergeCSV.numeric-normalization.spec.ts`
  - [ ] 非数値 `take` が新規シーンへ混入しない
  - [ ] 数値文字列が既存シーンへ反映される（フォローアップ）

## Commands

- `pnpm test --filter lib -- --test-name-pattern mergeCSV.numeric-normalization`
  - 実行ログを Notes に貼り付ける（入力 CSV・出力検証結果を明記）

## Notes

- 検証ログ: 非数値 `take` を含む CSV を添付し、出力 Storyboard の `take` が undefined であることを確認するスクリーンショットを残す。
- Follow-ups: 既存シーン更新の数値正規化テスト追加、他フィールドの正規化網羅確認。
