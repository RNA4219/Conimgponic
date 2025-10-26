import { deepStrictEqual, ok as assertOk } from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  COLLECT_METRICS_CONTRACT,
  FLAG_RESOLUTION_SOURCE_VARIANTS
} from '../../scripts/monitor/collect-metrics.js'

const findTelemetrySpec = (event: string) =>
  COLLECT_METRICS_CONTRACT.telemetry.events.find((spec) => spec.event === event)

// RED: VS Code 拡張メッセージ/テレメトリ JSONL 契約と再試行条件を固定する。
describe('vscode extension telemetry contract (RED)', () => {
  test('message envelope は type/apiVersion/reqId/ts を含む Day8 Collector 順序を固定する', () => {
    deepStrictEqual(COLLECT_METRICS_CONTRACT.telemetry.envelope, [
      'type',
      'apiVersion',
      'reqId',
      'ts',
      'correlationId',
      'phase',
      'schema',
      'event',
      'attempt',
      'maxAttempts',
      'backoffMs',
    ])
  })
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

  test('flag_resolution telemetry の source 受け入れ値が FlagSource と一致する', () => {
    deepStrictEqual(FLAG_RESOLUTION_SOURCE_VARIANTS, [
      'env',
      'workspace',
      'localStorage',
      'default'
    ])
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
  test.todo('export.* telemetry が format ごとに started/succeeded/failed を記録し、エラー時は retryable + next_backoff_ms を出力する')
  test('plugins telemetry は pluginId/action/result を Collector JSONL に固定する', () => {
    const completed = findTelemetrySpec('plugins.completed')
    assertOk(completed, 'plugins.completed telemetry spec is missing')
    const failed = findTelemetrySpec('plugins.failed')
    assertOk(failed, 'plugins.failed telemetry spec is missing')

    const requiredFields = ['payload.pluginId', 'payload.action', 'payload.result'] as const

    for (const field of requiredFields) {
      assertOk(
        completed.jsonlFields.includes(field),
        `plugins.completed must require ${field} in Reporter JSONL`
      )
      assertOk(
        failed.jsonlFields.includes(field),
        `plugins.failed must require ${field} in Reporter JSONL`
      )
    }
  })
  test.todo('JSONL 再試行は最大 3 回、指数バックオフ 0.1/0.3/0.9s で Collector -> Analyzer -> Reporter が整合することを検証する')
})
