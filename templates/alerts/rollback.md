# Rollback Notification Template

## Slack 投稿（#launch-autosave / #merge-ops / #incident）
- 件名: `[Rollback][Phase <current>] <feature> フラグを <prev_phase> へロールバック`
- 冒頭本文:
  1. 発生時刻（UTC / JST）とトリガー指標 (`autosave_p95` / `restore_success_rate` / `merge_auto_success_rate`)
  2. 実行コマンド: ``pnpm run flags:rollback --phase <prev_phase>`` の出力ログリンク（`governance/policy.yaml#rollback.command` 参照）
  3. 影響範囲: 対象フェーズ・ユーザーセグメント（QA/Canary/GA）
- 添付: `reports/monitoring/<timestamp>.jsonl`（Collector 出力）、Analyzer 判定サマリ、`reports/rca/<phase>-<date>.md` プレースホルダー
- ハッシュタグ: `#autosave` / `#merge` / `#incident`（必要に応じて複数）
- 参考リンク: `docs/IMPLEMENTATION-PLAN.md#21-フェーズ基準と運用統制`（通知フロー）

## PagerDuty Incident-001 ハンドオフ
- サービス: `Autosave & Precision Merge`
- 優先度: `P1` （SLO 違反が 24h 継続時） / `P2` （単発重大違反）
- 概要テンプレート:
  ```text
  [Phase <current>] Rollback executed
  Trigger metric: <metric>=<value> (threshold <threshold>)
  Command: pnpm run flags:rollback --phase <prev_phase>
  Follow-up: RCA draft scheduled <due_date>
  ```
- 添付ノート: Slack 投稿 URL、`reports/rca/<phase>-<date>.md` のプレースホルダー、再発防止タスクの Jira リンク、`templates/alerts/rollback.md` の参照行

## RCA 作成リマインダー
- 担当: Incident Commander（当番 SRE）
- 期限: ロールバック発生から 1 営業日以内
- 必須項目:
  - 事象サマリ（トリガー指標値、影響ユーザー）
  - 暫定対策と恒久対策
  - 再開判断（Phase 再開条件、シミュレーション結果）
- テンプレート: `reports/rca/template.md` を複製し、`templates/alerts/rollback.md` に添付したログを根拠として記載
