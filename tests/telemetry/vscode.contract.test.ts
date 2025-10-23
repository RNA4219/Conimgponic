import { describe, test } from 'node:test'

// RED: VS Code 拡張メッセージ/テレメトリ JSONL 契約と再試行条件を固定する。
describe('vscode extension telemetry contract (RED)', () => {
  test.todo('message envelope: {type,apiVersion,reqId,ts} を全方向で必須化し、phase.guard への観測フックを持つ')
  test.todo('status.autosave telemetry を JSONL で {state,debounce_ms,latency_ms,attempt} と RED/GREEN パイプラインに記録する')
  test.todo('flag_resolution telemetry が feature flag の source/variant/phase をローテーションメトリクスへ送出する')
  test.todo('merge.trace telemetry が collision 数と guardrail 判定 (rollbackTo) を含み Analyzer に 15m バッチ投入される')
  test.todo('export.* telemetry が format ごとに started/succeeded/failed を記録し、エラー時は retryable + next_backoff_ms を出力する')
  test.todo('plugins.* telemetry が pluginId/action/result と correlationId を固定し、プラグイン sandbox 違反時に rollback 条件を通知する')
  test.todo('JSONL 再試行は最大 3 回、指数バックオフ 0.1/0.3/0.9s で Collector -> Analyzer -> Reporter が整合することを検証する')
})
