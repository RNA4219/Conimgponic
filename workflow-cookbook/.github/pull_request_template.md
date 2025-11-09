# Pull Request テンプレート

> **必須**: `Intent: INT-xxx` と `EVALUATION` のアンカーを本文に含めないと CI が失敗します。

## Intent Metadata

| 項目 | 記入例 |
| --- | --- |
| Intent ID | INT-___ |
| EVALUATION Anchor | [Acceptance Criteria](../EVALUATION.md#acceptance-criteria) |
| Priority Score | `number` |

## 記入項目

### 概要

- 種別: feature / fix / chore / docs
- 主要変更点: <!-- 箇条書きで記載 -->

### リンク

- BLUEPRINT: <!-- path or permalink -->
- TASK: <!-- path -->

## EVALUATION

- 受入条件リンク: [Acceptance Criteria](../EVALUATION.md#acceptance-criteria)
- 補足: <!-- 必要に応じて記載 -->

### リスクとロールバック

- 主要リスク:
- Canary条件: （/governance/policy.yaml に準拠）
- Rollback手順: RUNBOOK の該当手順リンク

### チェックリスト

- [ ] 受入基準（EVALUATION）緑
- [ ] CHECKLISTS 該当項目完了
- [ ] CHANGELOG 追記
- [ ] REQUIREMENTS（REQUIREMENTS.md or docs/requirements.md）がある（無ければ後追いで作る）
- 禁止パス遵守チェック（governance/policy.yaml）: <!-- 例: OK / 対象外 / 詳細 -->
- Priority Score: <!-- 例: 5 / prioritization.yaml#phase1 -->

## INT Logs

- YYYY-MM-DD: <!-- Intentの経緯や承認ログを箇条書きで記載 -->
- YYYY-MM-DD: <!-- 追加の更新履歴 -->

## Docs matrix (FYI)

- REQUIREMENTS: present?  [] yes / [] later
- SPEC:         present?  [] yes / [] later
- DESIGN:       present?  [] yes / [] later
