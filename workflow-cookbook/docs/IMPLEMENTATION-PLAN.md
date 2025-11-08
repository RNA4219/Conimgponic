---
intent_id: INT-001
owner: docs-core
status: draft
last_reviewed_at: 2025-10-28
next_review_due: 2025-11-28
---

# 実装計画（Implementation Plan）

本計画は [README.md](../README.md) および [HUB.codex.md](../HUB.codex.md) の導入指針に従い、AutoSave と Merge の段階導入を支える
最小単位の意思決定と依存関係を整理する。

## フラグ方針

- `autosave.project_lock` フラグで AutoSave のプロジェクトロック機構を段階的に有効化する。
  詳細な不変条件とテレメトリは
  [docs/AUTOSAVE-DESIGN-IMPL.md#不変条件](
    AUTOSAVE-DESIGN-IMPL.md#%E4%B8%8D%E5%A4%89%E6%9D%A1%E4%BB%B6) と
  [docs/AUTOSAVE-DESIGN-IMPL.md#テレメトリ要件](
    AUTOSAVE-DESIGN-IMPL.md#%E3%83%86%E3%83%AC%E3%83%A1%E3%83%88%E3%83%AA%E8%A6%81%E4%BB%B6) を参照。
- `merge.precision_mode` フラグで Merge の精度モード（`baseline` / `strict`）を切り替え、後方互換を維持する。
  I/O 契約とロック協調は
  [docs/MERGE-DESIGN-IMPL.md#i-o-契約](MERGE-DESIGN-IMPL.md#i-o-%E5%A5%91%E7%B4%84) と
  [docs/MERGE-DESIGN-IMPL.md#ロック協調](MERGE-DESIGN-IMPL.md#%E3%83%AD%E3%83%83%E3%82%AF%E5%8D%94%E8%AA%BF) に従う。
- 両フラグともに [docs/tasks/task-autosave-project-locks.md](tasks/task-autosave-project-locks.md)
  のチェックリスト完了を有効化条件とし、未完了状態では強制的にオフ。

## 依存関係

- AutoSave の不変条件・例外設計・I/O 契約は
  [docs/AUTOSAVE-DESIGN-IMPL.md#不変条件](AUTOSAVE-DESIGN-IMPL.md#%E4%B8%8D%E5%A4%89%E6%9D%A1%E4%BB%B6) /
  [#例外設計](AUTOSAVE-DESIGN-IMPL.md#%E4%BE%8B%E5%A4%96%E8%A8%AD%E8%A8%88) /
  [#i-o-契約](AUTOSAVE-DESIGN-IMPL.md#i-o-%E5%A5%91%E7%B4%84) を参照する。
- Merge 精度モード・ロック協調・テレメトリ要件は
  [docs/MERGE-DESIGN-IMPL.md#精度モード](MERGE-DESIGN-IMPL.md#%E7%B2%BE%E5%BA%A6%E3%83%A2%E3%83%BC%E3%83%89) /
  [#ロック協調](MERGE-DESIGN-IMPL.md#%E3%83%AD%E3%83%83%E3%82%AF%E5%8D%94%E8%AA%BF) /
  [#テレメトリ要件](MERGE-DESIGN-IMPL.md#%E3%83%86%E3%83%AC%E3%83%A1%E3%83%88%E3%83%AA%E8%A6%81%E4%BB%B6) に従う。
- タスク実行フローとテスト駆動の証跡は
  [docs/tasks/task-autosave-project-locks.md#tdd](tasks/task-autosave-project-locks.md#tdd) /
  [#ロールバック手順](
    tasks/task-autosave-project-locks.md#%E3%83%AD%E3%83%BC%E3%83%AB%E3%83%90%E3%83%83%E3%82%AF%E6%89%8B%E9%A0%86)
  に準拠する。

## 段階導入チェックリスト

1. `autosave.project_lock` を `baseline` プロジェクトに対してカナリア実行し、
   [docs/AUTOSAVE-DESIGN-IMPL.md#不変条件](AUTOSAVE-DESIGN-IMPL.md#%E4%B8%8D%E5%A4%89%E6%9D%A1%E4%BB%B6) で定義した監視アラートを有効化する。
2. `merge.precision_mode` を `baseline` → `strict` へ段階昇格し、
   [docs/MERGE-DESIGN-IMPL.md#テレメトリ要件](
     MERGE-DESIGN-IMPL.md#%E3%83%86%E3%83%AC%E3%83%A1%E3%83%88%E3%83%AA%E8%A6%81%E4%BB%B6)
   の指標で回帰を確認する。
3. 1・2 の結果を [docs/tasks/task-autosave-project-locks.md#ロールバック手順][task-autosave-rollback]
   に沿ってレビューし、完了後にフラグを恒常化する。

---

- 逆リンク: [README.md](../README.md) / [HUB.codex.md](../HUB.codex.md)

[task-autosave-rollback]:
  tasks/task-autosave-project-locks.md#ロールバック手順
