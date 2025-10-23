import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { COLLECT_METRICS_CONTRACT } from '../../scripts/monitor/collect-metrics'

const findTelemetrySpec = (event: string) =>
  COLLECT_METRICS_CONTRACT.telemetry.events.find((spec) => spec.event === event)

// RED: VS Code 拡張メッセージ/テレメトリ JSONL 契約と再試行条件を固定する。
describe('vscode extension telemetry contract (RED)', () => {
  test.todo('message envelope: {type,apiVersion,reqId,ts} を全方向で必須化し、phase.guard への観測フックを持つ')
  test('status.autosave telemetry は phase 情報と guard スナップショットを記録する', () => {
    const spec = findTelemetrySpec('status.autosave')
    assert(spec, 'status.autosave telemetry spec is missing')

    const requiredFields = [
      'payload.state',
      'payload.debounce_ms',
      'payload.latency_ms',
      'payload.attempt',
      'payload.phase_step',
      'payload.guard.current',
      'payload.guard.rollbackTo'
    ]

    for (const field of requiredFields) {
      assert(
        spec.jsonlFields.includes(field),
        `status.autosave must require ${field} in Collector JSONL`
      )
    }
  })

  test('flag_resolution telemetry は evaluation_ms を必須にし Phase ガード指標へ渡す', () => {
    const spec = findTelemetrySpec('flag_resolution')
    assert(spec, 'flag_resolution telemetry spec is missing')

    const requiredFields = [
      'payload.flag',
      'payload.variant',
      'payload.source',
      'payload.phase',
      'payload.evaluation_ms'
    ]

    for (const field of requiredFields) {
      assert(
        spec.jsonlFields.includes(field),
        `flag_resolution must require ${field} in Collector JSONL`
      )
    }
  })

  test('merge.trace telemetry は Phase 情報と ±5% 監視用メトリクスを保持する', () => {
    const spec = findTelemetrySpec('merge.trace')
    assert(spec, 'merge.trace telemetry spec is missing')

    const requiredFields = [
      'payload.phase',
      'payload.collisions',
      'payload.processing_ms',
      'payload.guardrail.metric',
      'payload.guardrail.observed',
      'payload.guardrail.tolerance_pct',
      'payload.guardrail.rollbackTo'
    ]

    for (const field of requiredFields) {
      assert(
        spec.jsonlFields.includes(field),
        `merge.trace must require ${field} in Collector JSONL`
      )
    }
  })
  test.todo('export.* telemetry が format ごとに started/succeeded/failed を記録し、エラー時は retryable + next_backoff_ms を出力する')
  test.todo('plugins.* telemetry が pluginId/action/result と correlationId を固定し、プラグイン sandbox 違反時に rollback 条件を通知する')
  test.todo('JSONL 再試行は最大 3 回、指数バックオフ 0.1/0.3/0.9s で Collector -> Analyzer -> Reporter が整合することを検証する')
})
