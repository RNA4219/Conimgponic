import { deepStrictEqual, ok as assertOk } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

import {
  COLLECT_METRICS_CONTRACT,
  FLAG_RESOLUTION_SOURCE_VARIANTS
} from '../../scripts/monitor/collect-metrics.js'
import {
  collectFlagResolutionPayloads,
  DEFAULT_FLAGS,
  resolveFlags
} from '../../src/config/index.js'
import type { WorkspaceConfiguration } from '../../src/config/flags.js'
import {
  publishFlagResolution,
  type Day8Collector,
  type Day8CollectorFlagResolutionEvent,
  type FlagResolutionEventPayload
} from '../../src/telemetry/day8Collector.js'

type JsonSchemaObject = {
  readonly type?: string
  readonly enum?: readonly string[]
  readonly $ref?: string
  readonly properties?: {
    readonly [key: string]: JsonSchemaObject
  }
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean | JsonSchemaObject
}

type TelemetrySchema = {
  readonly required?: readonly string[]
  readonly allOf: readonly TelemetrySchemaConditional[]
  readonly properties?: {
    readonly [key: string]: JsonSchemaObject
  }
  readonly definitions?: {
    readonly [key: string]: JsonSchemaObject
  }
}

type TelemetrySchemaConditional = {
  readonly if?: {
    readonly properties?: {
      readonly event?: {
        readonly const?: string
      }
    }
  }
  readonly then?: {
    readonly required?: readonly string[]
    readonly properties?: {
      readonly payload?: JsonSchemaObject
    }
  }
}

const telemetrySchema = JSON.parse(
  readFileSync(new URL('../../schemas/telemetry.schema.json', import.meta.url), 'utf-8')
) as TelemetrySchema

const findConditional = (predicate: (entry: TelemetrySchemaConditional) => boolean) => {
  const entry = telemetrySchema.allOf.find(predicate)
  assertOk(entry, 'telemetry schema conditional not found')
  assertOk(entry.then, 'telemetry schema conditional lacks then clause')
  return entry.then
}

const assertPayloadSchema = (
  thenClause: NonNullable<TelemetrySchemaConditional['then']>,
  expectedRequired: readonly string[]
) => {
  assertOk(thenClause.properties, 'telemetry schema conditional lacks properties')
  const payloadSchema = thenClause.properties.payload
  assertOk(payloadSchema, 'telemetry schema conditional must define payload')
  assertOk(payloadSchema.required, 'payload schema must define required fields')
  deepStrictEqual(payloadSchema.required, Array.from(expectedRequired))
  return payloadSchema
}

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

    assertOk(
      telemetrySchema.required,
      'telemetry schema must define required envelope fields'
    )
    deepStrictEqual(telemetrySchema.required, [
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
      'payload',
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
      'payload.evaluation_ms',
      'payload.threshold',
      'payload.status',
      'payload.detail.retryable',
      'payload.detail.default_used'
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

  test('publishFlagResolution の payload.phase が RolloutPhase 契約に一致する', () => {
    const thenClause = findConditional(
      (entry) => entry.if?.properties?.event?.const === 'flag_resolution'
    )
    const payloadSchema = assertPayloadSchema(thenClause, [
      'flag',
      'variant',
      'source',
      'phase',
      'evaluation_ms',
      'threshold',
      'status',
      'detail',
      'errors'
    ])
    assertOk(
      payloadSchema.properties,
      'flag_resolution payload schema must define properties'
    )
    const phaseSchema = payloadSchema.properties.phase
    assertOk(phaseSchema, 'flag_resolution payload schema must define phase')
    const allowedPhaseEnum =
      phaseSchema.enum ??
      (phaseSchema.$ref
        ? telemetrySchema.definitions?.[
            phaseSchema.$ref.replace('#/definitions/', '')
          ]?.enum ?? null
        : null)
    assertOk(allowedPhaseEnum, 'flag_resolution phase must define enum')

    const captured: Day8CollectorFlagResolutionEvent[] = []
    const scope = globalThis as { Day8Collector?: Day8Collector }
    const previousCollector = scope.Day8Collector
    scope.Day8Collector = {
      publish(event) {
        captured.push(event as Day8CollectorFlagResolutionEvent)
      }
    } as Day8Collector

    try {
      const payload: FlagResolutionEventPayload = {
        flag: 'autosave.enabled',
        variant: 'true',
        source: 'env',
        phase: 'phase-a0',
        evaluation_ms: 42,
        errors: [],
        threshold: null,
        status: 'success',
        detail: { retryable: false, default_used: false }
      }
      publishFlagResolution('app.autosave', 'bootstrap', [payload], 42)
    } finally {
      scope.Day8Collector = previousCollector
    }

    assertOk(captured.length > 0, 'flag_resolution telemetry must be published')
    const [event] = captured
    assertOk(event, 'flag_resolution event must be captured')
    const allowedPhases = new Set(allowedPhaseEnum)
    assertOk(
      allowedPhases.has(event.payload.phase),
      `flag_resolution payload.phase must be one of ${Array.from(allowedPhases).join(', ')}`
    )
    deepStrictEqual(event.payload.status, 'success')
    deepStrictEqual(event.payload.detail, {
      retryable: false,
      default_used: false
    })
  })

  test('telemetry schema の flag_resolution payload が FlagSource と必須フィールドを同期する', () => {
    const thenClause = findConditional(
      (entry) => entry.if?.properties?.event?.const === 'flag_resolution'
    )
    const payloadSchema = assertPayloadSchema(thenClause, [
      'flag',
      'variant',
      'source',
      'phase',
      'evaluation_ms',
      'threshold',
      'status',
      'detail',
      'errors'
    ])

    assertOk(payloadSchema.properties, 'flag_resolution payload schema must define properties')
    const sourceSchema = payloadSchema.properties.source
    assertOk(sourceSchema, 'flag_resolution payload schema must define source')
    assertOk(sourceSchema.enum, 'flag_resolution source must define enum')
    deepStrictEqual(sourceSchema.enum, Array.from(FLAG_RESOLUTION_SOURCE_VARIANTS))

    const errorsSchema = payloadSchema.properties.errors
    assertOk(errorsSchema, 'flag_resolution payload schema must define errors array')
    assertOk(errorsSchema.type === 'array', 'flag_resolution payload errors must be an array')

    const detailSchema = payloadSchema.properties.detail
    assertOk(detailSchema, 'flag_resolution payload schema must define detail object')
    assertOk(detailSchema.type === 'object', 'flag_resolution payload detail must be an object')
    assertOk(detailSchema.required, 'flag_resolution payload detail must define required fields')
    deepStrictEqual(detailSchema.required, ['retryable', 'default_used'])
    assertOk(detailSchema.properties, 'flag_resolution payload detail must define properties')
    const retryableSchema = detailSchema.properties.retryable
    assertOk(retryableSchema, 'flag_resolution payload detail must define retryable property')
    deepStrictEqual(retryableSchema, { type: 'boolean' })
    const defaultUsedSchema = detailSchema.properties.default_used
    assertOk(
      defaultUsedSchema,
      'flag_resolution payload detail must define default_used property'
    )
    deepStrictEqual(defaultUsedSchema, { type: 'boolean' })
  })

  test('publishFlagResolution は errors/threshold を Collector payload に伝搬する', () => {
    const captured: Day8CollectorFlagResolutionEvent[] = []
    const scope = globalThis as { Day8Collector?: Day8Collector }
    const previousCollector = scope.Day8Collector
    scope.Day8Collector = {
      publish(event) {
        captured.push(event as Day8CollectorFlagResolutionEvent)
      }
    } as Day8Collector

    const errors: FlagResolutionEventPayload['errors'] = [
      {
        code: 'invalid-boolean',
        flag: 'autosave.enabled',
        raw: 'not-a-bool',
        message: 'expected boolean',
        retryable: false,
        source: 'env',
        phase: 'phase-a0'
      }
    ]

    try {
      const payload: FlagResolutionEventPayload = {
        flag: 'autosave.enabled',
        variant: 'false',
        source: 'default',
        phase: 'phase-a0',
        evaluation_ms: 7,
        errors,
        threshold: 0.75,
        status: 'failure',
        detail: { retryable: false, default_used: true }
      }
      publishFlagResolution('app.autosave', 'bootstrap', [payload], 13)
    } finally {
      scope.Day8Collector = previousCollector
    }

    assertOk(captured.length > 0, 'flag_resolution telemetry must be published')
    const [event] = captured
    assertOk(event, 'flag_resolution event must be captured')
    deepStrictEqual(event.payload.errors, errors)
    deepStrictEqual(event.payload.threshold, 0.75)
    deepStrictEqual(event.payload.status, 'failure')
    deepStrictEqual(event.payload.detail, {
      retryable: false,
      default_used: true
    })
  })

  test('collectFlagResolutionPayloads は workspace 設定の検証失敗で default threshold へフォールバックした場合に default_used=true を通知する', () => {
    const workspace = {
      __called: false,
      get(this: { __called: boolean }, key: string) {
        if (key === 'merge.threshold') {
          if (!this.__called) {
            this.__called = true
            return 'beta'
          }
          return 'not-a-number'
        }
        return undefined
      }
    } satisfies WorkspaceConfiguration & { __called: boolean }

    const workspaceOption: WorkspaceConfiguration = workspace
    const resolution = resolveFlags(
      { workspace: workspaceOption },
      { withErrors: true }
    )

    assertOk('errors' in resolution, 'resolveFlags must return errors summary')
    assertOk(resolution.errors.length > 0, 'merge.precision errors must be recorded')
    const payloads = collectFlagResolutionPayloads(
      resolution.snapshot,
      resolution.errors,
      7
    )
    const mergePayload = payloads.find(
      (payload) => payload.flag === 'merge.precision'
    )
    assertOk(mergePayload, 'merge.precision payload must exist')
    deepStrictEqual(mergePayload.source, 'workspace')
    deepStrictEqual(mergePayload.threshold, DEFAULT_FLAGS.merge.profile.threshold)
    deepStrictEqual(mergePayload.detail.default_used, true)
  })

  test('telemetry schema の status.autosave payload が Collector 要件を固定する', () => {
    const thenClause = findConditional(
      (entry) => entry.if?.properties?.event?.const === 'status.autosave'
    )
    const payloadSchema = assertPayloadSchema(thenClause, [
      'state',
      'debounce_ms',
      'latency_ms',
      'attempt',
      'phase_step',
      'guard'
    ])

    assertOk(payloadSchema.properties, 'status.autosave payload schema must define properties')
    const guardSchema = payloadSchema.properties.guard
    assertOk(guardSchema, 'status.autosave payload schema must define guard')
    assertOk(guardSchema.required, 'status.autosave guard must define required fields')
    deepStrictEqual(guardSchema.required, ['current', 'rollbackTo'])
  })

  test('telemetry schema の merge.trace payload が Collector 要件を固定する', () => {
    const thenClause = findConditional(
      (entry) => entry.if?.properties?.event?.const === 'merge.trace'
    )
    const payloadSchema = assertPayloadSchema(thenClause, [
      'phase',
      'collisions',
      'processing_ms',
      'guardrail',
      'digest'
    ])

    assertOk(payloadSchema.properties, 'merge.trace payload schema must define properties')
    const guardrailSchema = payloadSchema.properties.guardrail
    assertOk(guardrailSchema, 'merge.trace payload schema must define guardrail')
    assertOk(guardrailSchema.required, 'merge.trace guardrail must define required fields')
    deepStrictEqual(
      guardrailSchema.required,
      ['metric', 'observed', 'tolerance_pct', 'rollbackTo']
    )
  })

  test('merge.trace telemetry は Phase 情報と ±5% 監視用メトリクスを保持する', () => {
    const spec = findTelemetrySpec('merge.trace')
    assertOk(spec, 'merge.trace telemetry spec is missing')
    const telemetrySpec = spec

    const requiredFields = [
      'payload.phase',
      'payload.collisions',
      'payload.processing_ms',
      'payload.digest',
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
  test('export.failed/plugins.failed telemetry は retry backoff を Collector 契約で固定する', () => {
    const exportFailed = findTelemetrySpec('export.failed')
    assertOk(exportFailed, 'export.failed telemetry spec is missing')

    deepStrictEqual(exportFailed.jsonlFields, [
      'payload.runId',
      'payload.matchRate',
      'payload.formats',
      'payload.error.code',
      'payload.error.message',
      'payload.error.retryable',
      'payload.entries[].format',
      'payload.entries[].name',
      'payload.entries[].status',
      'payload.entries[].diff',
      'payload.next_backoff_ms'
    ])

    const exportThen = findConditional(
      (entry) => entry.if?.properties?.event?.const === 'export.failed'
    )
    const exportPayloadSchema = assertPayloadSchema(exportThen, [
      'runId',
      'matchRate',
      'formats',
      'error',
      'entries',
      'next_backoff_ms',
    ])

    assertOk(
      exportPayloadSchema.properties,
      'export.failed payload schema must define properties'
    )
    deepStrictEqual(exportPayloadSchema.type, 'object')
    deepStrictEqual(exportPayloadSchema.additionalProperties, false)
    const exportBackoffSchema = exportPayloadSchema.properties.next_backoff_ms
    assertOk(
      exportBackoffSchema,
      'export.failed payload schema must define next_backoff_ms'
    )
    deepStrictEqual(exportBackoffSchema, { type: 'number', minimum: 0 })

    const pluginsFailed = findTelemetrySpec('plugins.failed')
    assertOk(pluginsFailed, 'plugins.failed telemetry spec is missing')
    deepStrictEqual(pluginsFailed.jsonlFields, [
      'payload.pluginId',
      'payload.action',
      'payload.result',
      'payload.duration_ms',
      'payload.sandboxViolation',
      'payload.next_backoff_ms'
    ])

    const pluginsThen = findConditional(
      (entry) => entry.if?.properties?.event?.const === 'plugins.failed'
    )
    const pluginsPayloadSchema = assertPayloadSchema(pluginsThen, [
      'pluginId',
      'action',
      'result',
      'duration_ms',
      'sandboxViolation',
      'next_backoff_ms',
    ])

    assertOk(
      pluginsPayloadSchema.properties,
      'plugins.failed payload schema must define properties'
    )
    deepStrictEqual(pluginsPayloadSchema.type, 'object')
    deepStrictEqual(pluginsPayloadSchema.additionalProperties, false)
    const pluginsBackoffSchema = pluginsPayloadSchema.properties.next_backoff_ms
    assertOk(
      pluginsBackoffSchema,
      'plugins.failed payload schema must define next_backoff_ms'
    )
    deepStrictEqual(pluginsBackoffSchema, { type: 'number', minimum: 0 })
  })
  test('plugins telemetry は pluginId/action/result/duration_ms を Reporter JSONL に固定する', () => {
    const completed = findTelemetrySpec('plugins.completed')
    assertOk(completed, 'plugins.completed telemetry spec is missing')
    const failed = findTelemetrySpec('plugins.failed')
    assertOk(failed, 'plugins.failed telemetry spec is missing')

    const requiredFields = [
      'payload.pluginId',
      'payload.action',
      'payload.result',
      'payload.duration_ms'
    ] as const

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
