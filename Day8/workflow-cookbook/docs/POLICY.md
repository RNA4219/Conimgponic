# INT Policy

## 1. INT フォーマット

- 形式: `INT-<カテゴリ>-<番号>` または `INT-<番号>` を基本形とし、大文字英数字とハイフンのみを使用する。
- 正規表現: `INT-[0-9A-Z]+(?:-[0-9A-Z]+)*`
- PR 本文・テンプレートでは `Intent: INT-xxx` の表記を必須とする。

## 2. 許可カテゴリ

- `FEATURE`: 新規機能追加や大規模改善。
- `FIX`: バグ修正や不具合是正。
- `CHORE`: メンテナンス・リファクタリング・CI 調整などの内部作業。
- `DOCS`: ドキュメント整備や情報更新。
- `OPS`: 運用変更や手順更新。
- カテゴリはいずれも大文字で記載し、必要に応じて `INT-FEATURE-123` のようにサフィックスを連結する。

## 3. 正規表現

- Intent 検証: `Intent\s*[：:]\s*INT-[0-9A-Z]+(?:-[0-9A-Z]+)*`
- Priority スコア: `Priority\s*Score\s*:\s*[0-9]+`
- INT Logs の日付行: `^\s*-\s*[0-9]{4}-[0-9]{2}-[0-9]{2}:`
- すべてのパターンは `tools/ci/check_governance_gate.py` の検証ロジックと同期させ、変更時は双方を同時更新する。

## 4. 運用ルール

1. すべての PR は `.github/pull_request_template.md` の Intent Metadata テーブルを埋める。
   `Intent: INT-xxx` と EVALUATION アンカー、Priority Score を明示する。
2. `INT Logs` セクションでは Intent の承認・変更履歴を時系列で記録し、日付・概要・関係者を箇条書きで残す。
3. Intent 番号は `governance/policy.yaml` の禁止パスに抵触しない作業のみ紐づけ、逸脱する場合は事前に承認を得る。
4. Priority Score の算定根拠は `governance/prioritization.yaml` を参照し、該当セクションをコメントで示す。
5. テンプレートや検証ロジックを変更する場合は、本ドキュメントを更新し、関連する CI テスト（`test_pr_template_contains_required_sections`）を緑の状態で維持する。
