---
intent_id: INT-001
owner: docs-core
status: planned
last_reviewed_at: 2025-10-28
next_review_due: 2025-11-28
---

# Task Seed: AutoSave Project Locks

## 背景

- AutoSave のロック整合性と Merge 精度モードの切替を同期させる必要が
  ある。
- [docs/IMPLEMENTATION-PLAN.md](../IMPLEMENTATION-PLAN.md) で定義した段階導入フローにより、
  ユーザー影響を最小化する。
- 詳細設計は
  [docs/AUTOSAVE-DESIGN-IMPL.md#不変条件](../AUTOSAVE-DESIGN-IMPL.md#%E4%B8%8D%E5%A4%89%E6%9D%A1%E4%BB%B6) と
  [docs/MERGE-DESIGN-IMPL.md#精度モード](../MERGE-DESIGN-IMPL.md#%E7%B2%BE%E5%BA%A6%E3%83%A2%E3%83%BC%E3%83%89) に委譲する。

## ゴール

- `autosave.project_lock` と `merge.precision_mode` のフラグを段階導入し、
  主要ユースケースのデータ損失ゼロを保証する。
- AutoSave と Merge のログを統合し、
  [docs/AUTOSAVE-DESIGN-IMPL.md#テレメトリ要件](
    ../AUTOSAVE-DESIGN-IMPL.md#%E3%83%86%E3%83%AC%E3%83%A1%E3%83%88%E3%83%AA%E8%A6%81%E4%BB%B6) と
  [docs/MERGE-DESIGN-IMPL.md#テレメトリ要件](
    ../MERGE-DESIGN-IMPL.md#%E3%83%86%E3%83%AC%E3%83%A1%E3%83%88%E3%83%AA%E8%A6%81%E4%BB%B6)
  の指標で回帰が検出された場合に即時ロールバック可能とする。

## TDD

1. AutoSave の不変条件を検証するシナリオテストを追加し、
   [docs/AUTOSAVE-DESIGN-IMPL.md#i-o-契約](
     ../AUTOSAVE-DESIGN-IMPL.md#i-o-%E5%A5%91%E7%B4%84)
   を満たすことを確認する。
2. Merge 精度モードごとの比較テストを作成し、
   [docs/MERGE-DESIGN-IMPL.md#ロック協調](
     ../MERGE-DESIGN-IMPL.md#%E3%83%AD%E3%83%83%E3%82%AF%E5%8D%94%E8%AA%BF)
   の要件を満たすことを検証する。
3. フラグ状態遷移とロールバックを `baseline` → `strict` → `baseline` で往復させ、
   [docs/IMPLEMENTATION-PLAN.md#段階導入チェックリスト][plan-rollout-checklist]
   に沿った可逆性を確認する。

## ロールバック手順

1. テレメトリ指標が閾値を超えた場合、`merge.precision_mode` を `baseline` に戻し、
   AutoSave の書き込みをトグル式で一時停止する。
2. [docs/AUTOSAVE-DESIGN-IMPL.md#例外設計][autosave-exceptions] に従い、
   リトライ可能例外をキューに退避し、リトライ不可例外は即座に人間レビューへ引き渡す。
3. [docs/IMPLEMENTATION-PLAN.md#依存関係][plan-dependencies]
   と [docs/MERGE-DESIGN-IMPL.md#テレメトリ要件][merge-telemetry]
   を参照して影響分析を行い、再度フラグを有効化するかを判断する。

---

- 逆リンク: [docs/AUTOSAVE-DESIGN-IMPL.md](../AUTOSAVE-DESIGN-IMPL.md) /
  [docs/MERGE-DESIGN-IMPL.md](../MERGE-DESIGN-IMPL.md) /
  [docs/IMPLEMENTATION-PLAN.md](../IMPLEMENTATION-PLAN.md) /
  [README.md](../../README.md) /
  [HUB.codex.md](../../HUB.codex.md)

[plan-rollout-checklist]:
  ../IMPLEMENTATION-PLAN.md#段階導入チェックリスト
[autosave-exceptions]:
  ../AUTOSAVE-DESIGN-IMPL.md#例外設計
[plan-dependencies]:
  ../IMPLEMENTATION-PLAN.md#依存関係
[merge-telemetry]:
  ../MERGE-DESIGN-IMPL.md#テレメトリ要件
