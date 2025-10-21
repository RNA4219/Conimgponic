# Architecture Decision Records (ADR)

短時間で意思決定の背景を共有するためのフォルダです。
設計方針が変わるPRでは、以下テンプレートで1ファイルを追加してください。

```text
# ADR-XXX: タイトル
- 日付: YYYY-MM-DD
- 変更理由: 背景や課題
- 影響範囲: 影響を受けるモジュール/チーム
- 決定: 合意した方針
```

命名ルール:

- `ADR-<連番>.md` とし、連番は昇順で管理
- PR内の主要な設計判断ごとに1ファイル

<!-- markdownlint-disable-next-line MD033 -->
<a id="レビューフロー"></a>
レビューフロー:

1. PR内でテンプレを埋める
2. レビューで補足が出た場合は同じファイルに追記
3. マージ後も履歴として残す

意思決定の根拠を10秒で参照できるよう、記述は簡潔にまとめてください。

## 主要カテゴリと代表 ADR

ADR は判断の粒度に応じて以下のカテゴリに整理し、同一カテゴリの判断は代表 ADR 番号を起点に連番で管理します。
更新時は `CHECKLISTS.md` の[Release](../../CHECKLISTS.md#release)を参照し、レビューテンプレに ADR と関連資料を添付してください。

<!-- markdownlint-disable-next-line MD033 -->
<a id="adr-core-policy"></a>

- **ADR-001 基盤方針**：アーキテクチャ全体の前提・制約を定義します。`BLUEPRINT.md` の[Constraints / Assumptions][blueprint-constraints]と同期し、判断変更時は根拠と影響範囲を本テンプレートで明記してください。
  - 更新手順：`CHECKLISTS.md` の[Release][checklists-release]で証跡を確認し、本書の[レビューフロー](#レビューフロー)に従って [PR テンプレート][pr-template]へ ADR 番号・関連資料リンクを追記します。

<!-- markdownlint-disable-next-line MD033 -->
<a id="adr-milestone-dod"></a>

- **ADR-010 マイルストーン DoD**：ロードマップ上の主要マイルストーンに対する Done 判断基準を管理します。各マイルストーンの指標と証跡を整理し、進捗レポートと一緒に維持してください。
  - 更新手順：`CHECKLISTS.md` の[Release][checklists-release]で確認したエビデンスを添付し、本書の[レビューフロー](#レビューフロー)と [PR テンプレート][pr-template]で共有してからマージします。

<!-- markdownlint-disable-next-line MD033 -->
<a id="adr-operations-governance"></a>

- **ADR-020 運用ガバナンス**：セキュリティ・SLO など運用統制方針の変更を記録します。`SECURITY.md` や `RUNBOOK.md` の差分を連携し、統制判断の履歴を保持してください。
  - 更新手順：`CHECKLISTS.md` の[Release][checklists-release]で統制結果を確認したうえで、本書の[レビューフロー](#レビューフロー)と [PR テンプレート][pr-template]に差分リンクと影響範囲を記述します。

[blueprint-constraints]: ../../BLUEPRINT.md#3-constraints--assumptions
[checklists-release]: ../../CHECKLISTS.md#release
[pr-template]: ../../.github/pull_request_template.md
