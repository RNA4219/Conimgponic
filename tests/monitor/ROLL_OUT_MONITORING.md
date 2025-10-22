# Rollout Monitoring Contract Tests

## 正常サイクル
- 入力: Phase A-1、`autosave_p95=2200ms`、`restore_success_rate=0.999`、`merge_auto_success_rate=0.85`
- 期待: Slack/PagerDuty 通知は生成されない (`notify=auto`)、Analyzer へ 15 分ウィンドウの JSONL が出力。
- コマンド: `pnpm test --filter monitor -- --scenario normal-cycle`

## 閾値超過アラート
- 入力: Phase A-1、`autosave_p95=2600ms`（閾値 2500ms 超過）
- 期待: Slack 通知 payload に `autosave_p95` の breach 情報、テンプレート `templates/alerts/rollback.md` を参照。
- コマンド: `pnpm test --filter monitor -- --scenario threshold-breach`

## ロールバックトリガー
- 入力: Phase B-0、`merge_auto_success_rate=0.72`（閾値 0.8 未満）、Phase B 移行フラグ。
- 期待: PagerDuty 通知 payload 生成、`pnpm run flags:rollback --phase A-2` がロールバックコマンドとして記録。
- コマンド: `pnpm test --filter monitor -- --scenario rollback`
