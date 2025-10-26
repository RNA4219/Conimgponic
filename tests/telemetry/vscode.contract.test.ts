import { ok as assertOk } from 'node:assert/strict'
import { describe, test } from 'node:test'

import { COLLECT_METRICS_CONTRACT } from '../../scripts/monitor/collect-metrics.js'

const findTelemetrySpec = (event: string) =>
  COLLECT_METRICS_CONTRACT.telemetry.events.find((spec) => spec.event === event)

// RED: VS Code 拡張メッセージ/テレメトリ JSONL 契約と再試行条件を固定する。
describe('vscode extension telemetry contract (RED)', () => {
  test.todo('message envelope: {type,apiVersion,reqId,ts} を全方向で必須化し、phase.guard への観測フックを持つ')
  test('status.autosave telemetry は phase 情報と guard スナップショットを記録する', () => {
    const spec = findTelemetrySpec('status.autosave')
    assertOk(spec, 'status.autosave telemetry spec is missing')
    const telemetrySpec = spec

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
      assertOk(
        telemetrySpec.jsonlFields.includes(field),
        `status.autosave must require ${field} in Collector JSONL`
      )
    }
  })

  test('flag_resolution telemetry は evaluation_ms を必須にし Phase ガード指標へ渡す', () => {
    const spec = findTelemetrySpec('flag_resolution')
    assertOk(spec, 'flag_resolution telemetry spec is missing')
    const telemetrySpec = spec

    const requiredFields = [
      'payload.flag',
      'payload.variant',
      'payload.source',
      'payload.phase',
      'payload.evaluation_ms'
    ]

    for (const field of requiredFields) {
      assertOk(
        telemetrySpec.jsonlFields.includes(field),
        `flag_resolution must require ${field} in Collector JSONL`
      )
    }
  })

  test('merge.trace telemetry は Phase 情報と ±5% 監視用メトリクスを保持する', () => {
    const spec = findTelemetrySpec('merge.trace')
    assertOk(spec, 'merge.trace telemetry spec is missing')
    const telemetrySpec = spec

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
      assertOk(
        telemetrySpec.jsonlFields.includes(field),
        `merge.trace must require ${field} in Collector JSONL`
      )
    }
  })
  test('export telemetry は runId/format を必須化し completed → success へ改名する', () => {
    const startedSpec = findTelemetrySpec('export.started')
    assertOk(startedSpec, 'export.started telemetry spec is missing')

    for (const field of ['payload.format', 'payload.runId', 'payload.stage']) {
      assertOk(
        startedSpec.jsonlFields.includes(field),
        `export.started must require ${field} in Collector JSONL`
      )
    }

    const successSpec = findTelemetrySpec('export.success')
    assertOk(successSpec, 'export.success telemetry spec is missing')

    for (const field of ['payload.format', 'payload.runId', 'payload.uri', 'payload.duration_ms']) {
      assertOk(
        successSpec.jsonlFields.includes(field),
        `export.success must require ${field} in Collector JSONL`
      )
    }

    const completedSpec = findTelemetrySpec('export.completed')
    assertOk(!completedSpec, 'export.completed telemetry spec must be removed')

    const failedSpec = findTelemetrySpec('export.failed')
    assertOk(failedSpec, 'export.failed telemetry spec is missing')

    for (const field of [
      'payload.format',
      'payload.runId',
      'payload.error.code',
      'payload.error.message',
      'payload.error.retryable',
      'payload.error.next_backoff_ms',
    ]) {
      assertOk(
        failedSpec.jsonlFields.includes(field),
        `export.failed must require ${field} in Collector JSONL`
      )
    }
  })
  test.todo('plugins.* telemetry が pluginId/action/result と correlationId を固定し、プラグイン sandbox 違反時に rollback 条件を通知する')
  test.todo('JSONL 再試行は最大 3 回、指数バックオフ 0.1/0.3/0.9s で Collector -> Analyzer -> Reporter が整合することを検証する')
})
