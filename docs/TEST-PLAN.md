# テスト計画（v1.3）

## 1) 受入テスト（必須）
- **Seed再現**: 同一 seed/設定でテキスト一致率 ≥ 99%（空白差は無視）。
- **Seed非対応**: `seed_applied:false` が evidence に出る。
- **AutoSave**: 停止後 2.5s 以内に保存／異常終了後の復旧成功。
  - 詳細なテストケースは `tests/autosave/TEST_PLAN.md` を参照。
- **履歴ローテーション**: 21回保存後に最古が削除。
- **3-wayマージ**:
  - ラベルあり：自動マージ成功。
  - 類似度 < 0.75：衝突が残る。
  - 衝突解消後の再実行で結果不変。
  - 詳細なテストケースは `tests/merge/TEST_PLAN.md` を参照。

## 2) E2E（推奨）
- 10カット作成 → 生成（seed指定）→ マージ → Snapshot保存 → 復元 → Export/Import ラウンドトリップ。

## 3) ゲート条件
- **Phase A ロールアウト**:
  - `S-A0`〜`S-A2` のケースが全て成功。
  - `autosave.save.completed` の P95 ≤ 2.5s。
  - 復旧成功率 ≥ 99.5%。
- **Phase B ロールアウト**:
  - `S-A3` の精緻マージ統合と CLI/Collector 互換ケース (CLI-JS-02/03) が全て成功。
  - 自動マージ率 ≥ 80%。
- **ロールバック判定**: Telemetry テストで SLO 違反イベントが出力された場合、`tests/cli` スナップショットと `templates/alerts/rollback.md` の整合を再検証した上で `flags:rollback` 実行フローに従う。
