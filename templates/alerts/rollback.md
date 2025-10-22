# Rollback Notification Template

## Slack 投稿（#launch-autosave / #merge-ops / #incident）
- 件名: `[Rollback][Phase <current>] <feature> フラグを <prev_phase> へロールバック`
- 冒頭本文:
  1. 発生時刻（UTC / JST）とトリガー指標 (`autosave_p95` / `restore_success_rate` / `merge_auto_success_rate`)
  2. 実行コマンド: ``pnpm run flags:rollback --phase <prev_phase>`` の出力ログリンク（`governance/policy.yaml#rollout.rollback.command` を参照）
  3. 影響範囲: 対象フェーズ・ユーザーセグメント（QA/Canary/GA）
- 添付: `reports/monitoring/<timestamp>.jsonl`（Collector 出力）、Analyzer 判定サマリ、`reports/rca/<phase>-<date>.md` プレースホルダー
- ハッシュタグ: `#autosave` / `#merge` / `#incident`（必要に応じて複数）
- 参考リンク: `docs/IMPLEMENTATION-PLAN.md#21-フェーズ基準と運用統制`（通知フロー）と `scripts/monitor/collect-metrics.ts#COLLECT_METRICS_CONTRACT.phaseGates`

### フェーズ別 SLO 判定サマリ（Slack 投稿内に引用）
| Phase | 指標 | 閾値 | 判定 | ロールバック |
|-------|------|------|------|--------------|
| A-1 | autosave_p95 | ≤ 2500ms | breach なら Slack 通知のみ | A-0 へ `pnpm run flags:rollback --phase A-0` |
| A-1 | restore_success_rate | ≥ 0.995 | breach なら Slack+PagerDuty | A-0 へ `pnpm run flags:rollback --phase A-0` |
| A-2 | autosave_p95 | ≤ 2300ms | breach なら Slack 通知 | A-1 へ `pnpm run flags:rollback --phase A-1` |
| A-2 | restore_success_rate | ≥ 0.997 | breach なら Slack+PagerDuty | A-1 へ `pnpm run flags:rollback --phase A-1` |
| B-0 | merge_auto_success_rate | ≥ 0.80 | breach なら Slack+PagerDuty | A-2 へ `pnpm run flags:rollback --phase A-2` |
| B-1 | merge_auto_success_rate | ≥ 0.85 | breach なら Slack+PagerDuty | B-0 へ `pnpm run flags:rollback --phase B-0` |

### 15 分サイクル共有コメント
- Collector → Analyzer → Reporter のジョブを `*/15 * * * *` で実行。最新ウィンドウを引用して breach 判定を記載。
- 通知発火前に `pnpm lint --filter monitor` と `pnpm test --filter monitor` の結果を添付し、policy との差分を `git diff --name-only governance/policy.yaml templates/alerts/rollback.md` で確認。
- ガバナンスチェック: `pnpm exec yaml-lint governance/policy.yaml` が成功したことを記載。

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

### フェーズ移行チェックリスト更新手順
1. `scripts/monitor/collect-metrics.ts` の `COLLECT_METRICS_CONTRACT.phaseGates` を更新し、必要フェーズの閾値とロールバック先を明示。
2. `governance/policy.yaml` の `rollout.phase_gate` / `monitoring` セクションを同期。
3. `tests/monitor/ROLL_OUT_MONITORING.md` のシナリオを追加・更新し、`pnpm test --filter monitor` の観点を拡張。
4. Slack/PagerDuty テンプレへ閾値表を追記し、前フェーズへのロールバック手順が古くないか確認。

## RCA 作成リマインダー
- 担当: Incident Commander（当番 SRE）
- 期限: ロールバック発生から 1 営業日以内
- 必須項目:
  - 事象サマリ（トリガー指標値、影響ユーザー）
  - 暫定対策と恒久対策
  - 再開判断（Phase 再開条件、シミュレーション結果）
- テンプレート: `reports/rca/template.md` を複製し、`templates/alerts/rollback.md` に添付したログを根拠として記載
