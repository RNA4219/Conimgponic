import { deepStrictEqual, ok as assertOk, strictEqual } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

import {
  COLLECT_METRICS_CONTRACT,
  FLAG_RESOLUTION_SOURCE_VARIANTS,
  MERGE_PRECISION_VARIANTS,
  TELEMETRY_ENVELOPE_METADATA_FIELDS
} from '../../scripts/monitor/collect-metrics.js'
import {
  compareNormalizedOutputs,
  createTelemetryEvent
} from '../../src/lib/golden/compare.js'
import type { GoldenArtifacts } from '../../src/lib/golden/compare.js'
import type { NormalizedOutputs } from '../../src/lib/exporters.js'
import {
  collectFlagResolutionPayloads,
  DEFAULT_FLAGS,
  FEATURE_FLAG_DEFINITIONS,
  resolveFlags
} from '../../src/config/index.js'
import type {
  FeatureFlagName,
  FlagSnapshot,
  WorkspaceConfiguration
} from '../../src/config/flags.js'
import {
  publishFlagResolution,
  publishMergeResult,
  publishSnapshotResult,
  resetWorkspaceIdCacheForTests,
  type Day8Collector,
  type Day8CollectorErrorEvent,
  type Day8CollectorFlagResolutionEvent,
  type Day8CollectorMergeResultEvent,
  type Day8CollectorSnapshotResultEvent,
  type FlagResolutionEventPayload
} from '../../src/telemetry/day8Collector.js'

type JsonSchemaObject = {
  readonly type?: string
  readonly enum?: readonly string[]
  readonly $ref?: string
  readonly format?: string
  readonly properties?: {
    readonly [key: string]: JsonSchemaObject
  }
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean | JsonSchemaObject
  readonly minLength?: number
  readonly items?: JsonSchemaObject
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

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

const resolveSchemaRef = (schema: JsonSchemaObject | undefined) => {
  if (!schema) {
    return undefined
  }
  if (schema.$ref) {
    return telemetrySchema.definitions?.[schema.$ref.replace('#/definitions/', '')]
  }
  return schema
}

const resolveSchemaProperties = (schema: JsonSchemaObject | undefined) => {
  const resolved = resolveSchemaRef(schema)
  if (!resolved) {
    return undefined
  }
  if (resolved.properties) {
    return resolved.properties
  }
  const composite = resolved as { readonly allOf?: readonly JsonSchemaObject[] }
  if (Array.isArray(composite.allOf)) {
    for (const entry of composite.allOf) {
      const nested = resolveSchemaProperties(entry)
      if (nested) {
        return nested
      }
    }
  }
  return undefined
}

const assertFlagValidationErrorSchema = (schema: JsonSchemaObject | undefined) => {
  assertOk(schema && typeof schema === 'object', 'flag_resolution payload errors must define item schema')
  const resolved = resolveSchemaRef(schema)
  assertOk(resolved, 'flag_resolution payload error items must resolve to schema')
  assertOk(resolved.type === 'object', 'flag_resolution payload errors must emit objects')
  assertOk(resolved.required, 'flag_resolution payload error objects must define required fields')
  deepStrictEqual(
    Array.from(resolved.required).sort(),
    ['code', 'message', 'flag', 'retryable', 'source', 'phase', 'raw'].sort()
  )
  assertOk(resolved.properties, 'flag_resolution payload error objects must define properties')
  const properties = resolved.properties

  const codeSchema = resolveSchemaRef(properties.code)
  assertOk(codeSchema && codeSchema.type === 'string', 'flag_resolution payload error code must be string')
  assertOk(codeSchema.enum, 'flag_resolution payload error code must define enum')
  deepStrictEqual(codeSchema.enum, ['invalid-boolean', 'invalid-precision'])

  for (const key of ['message', 'flag', 'raw'] as const) {
    const stringSchema = resolveSchemaRef(properties[key])
    assertOk(stringSchema && stringSchema.type === 'string', `flag_resolution payload error ${key} must be string`)
    assertOk(stringSchema.minLength === 1, `flag_resolution payload error ${key} must enforce minLength`)
  }

  const retryableSchema = resolveSchemaRef(properties.retryable)
  assertOk(retryableSchema && retryableSchema.type === 'boolean', 'flag_resolution payload error retryable must be boolean')
  assertOk('const' in retryableSchema && retryableSchema.const === false, 'flag_resolution payload error retryable must be const false')

  const sourceSchema = resolveSchemaRef(properties.source)
  assertOk(sourceSchema && sourceSchema.enum, 'flag_resolution payload error source must resolve to enum')
  deepStrictEqual(sourceSchema.enum, Array.from(FLAG_RESOLUTION_SOURCE_VARIANTS))

  const phaseSchema = resolveSchemaRef(properties.phase)
  assertOk(phaseSchema && phaseSchema.type === 'string', 'flag_resolution payload error phase must be string')
  assertOk(phaseSchema.enum, 'flag_resolution payload error phase must enumerate rollout phases')
  deepStrictEqual(phaseSchema.enum, ['phase-a0', 'phase-a1', 'phase-a2', 'phase-b0', 'phase-b1'])
}

const findTelemetrySpec = (event: string) =>
  COLLECT_METRICS_CONTRACT.telemetry.events.find((spec) => spec.event === event)

// RED: VS Code 拡張メッセージ/テレメトリ JSONL 契約と再試行条件を固定する。
describe('vscode extension telemetry contract (RED)', () => {
  test('message envelope は type/apiVersion/reqId/ts を含む Day8 Collector 順序を固定する', () => {
    const expectedEnvelopeOrder = [
      'type',
      'apiVersion',
      'reqId',
      'ts',
      'correlationId',
      'workspace_id',
      'phase',
      'schema',
      'event',
      ...TELEMETRY_ENVELOPE_METADATA_FIELDS,
      'attempt',
      'maxAttempts',
      'backoffMs',
    ] as const

    deepStrictEqual(
      COLLECT_METRICS_CONTRACT.telemetry.envelope,
      Array.from(expectedEnvelopeOrder)
    )

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
      'workspace_id',
      'phase',
      'schema',
      'event',
      'feature',
      'component',
      'kind',
      'source',
      'evaluation_ms',
      'attempt',
      'maxAttempts',
      'backoffMs',
      'payload',
    ])

    const properties = telemetrySchema.properties
    assertOk(properties, 'telemetry schema must define properties')
    const reqId = properties.reqId
    const correlationId = properties.correlationId
    const workspaceId = properties.workspace_id
    assertOk(reqId && correlationId && workspaceId, 'telemetry schema must define reqId/correlationId/workspace_id')
    strictEqual(reqId.format, 'uuid', 'telemetry reqId must enforce uuid format')
    strictEqual(correlationId.format, 'uuid', 'telemetry correlationId must enforce uuid format')
    strictEqual(
      workspaceId.format,
      'uuid',
      'telemetry workspace_id must enforce uuid format'
    )
  })
  test('telemetry schema は feature/component/kind/source/evaluation_ms を enumerated として公開する', () => {
    assertOk(telemetrySchema.properties, 'telemetry schema must expose properties')
    const properties = telemetrySchema.properties
    const feature = properties.feature
    const component = properties.component
    const kind = properties.kind
    const source = properties.source
    const evaluationMs = properties.evaluation_ms

    deepStrictEqual(
      TELEMETRY_ENVELOPE_METADATA_FIELDS,
      ['feature', 'component', 'kind', 'source', 'evaluation_ms']
    )

    const metadataDefinition =
      telemetrySchema.definitions?.telemetryEnvelopeMetadataField
    assertOk(
      metadataDefinition?.enum,
      'telemetry schema must enumerate metadata fields'
    )
    deepStrictEqual(
      metadataDefinition.enum,
      Array.from(TELEMETRY_ENVELOPE_METADATA_FIELDS)
    )

    assertOk(feature, 'feature property must be defined')
    const featureSchema = resolveSchemaRef(feature)
    assertOk(featureSchema?.enum, 'feature schema must enumerate allowed values')
    deepStrictEqual(featureSchema.enum, ['autosave-diff-merge', 'config.flags'])

    assertOk(component, 'component property must be defined')
    const componentSchema = resolveSchemaRef(component)
    assertOk(componentSchema?.enum, 'component schema must enumerate allowed values')
    deepStrictEqual(componentSchema.enum, ['autosave', 'merge', 'flags', 'export'])

    assertOk(kind, 'kind property must be defined')
    const kindSchema = resolveSchemaRef(kind)
    assertOk(kindSchema?.enum, 'kind schema must enumerate allowed values')
    deepStrictEqual(kindSchema.enum, [
      'save',
      'ui',
      'merge',
      'flag_resolution',
      'export',
      'error'
    ])

    assertOk(source, 'source property must be defined')
    const sourceSchema = resolveSchemaRef(source)
    assertOk(sourceSchema?.enum, 'source schema must enumerate allowed values')
    deepStrictEqual(sourceSchema.enum, ['app.autosave', 'app.merge', 'app.flags', 'vscode.plugins'])

    assertOk(evaluationMs, 'evaluation_ms property must be defined')
    const evaluationSchema = resolveSchemaRef(evaluationMs)
    assertOk(evaluationSchema?.type === 'number', 'evaluation_ms must be a number')
    assertOk(
      'minimum' in evaluationSchema && evaluationSchema.minimum === 0,
      'evaluation_ms must enforce non-negative values'
    )
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
      'payload.guard.rollbackTo',
      'payload.detail.retry_count',
      'payload.performance.flush_latency_ms'
    ]

    for (const field of requiredFields) {
      assertOk(
        telemetrySpec.jsonlFields.includes(field),
        `status.autosave must require ${field} in Collector JSONL`
      )
    }
  })

  test('snapshot.result telemetry は duration/エラー指標を Collector JSONL に含める', () => {
    const spec = findTelemetrySpec('snapshot.result')
    assertOk(spec, 'snapshot.result telemetry spec is missing')
    const telemetrySpec = spec

    const requiredFields = [
      'payload.status',
      'payload.detail.duration_ms',
      'payload.detail.retry_count',
      'payload.detail.retryable',
      'payload.detail.error_code',
      'payload.detail.error_message',
      'payload.detail.lag_seconds',
      'payload.snapshot.bytes',
      'payload.snapshot.retained_bytes',
      'payload.snapshot.generation',
      'payload.snapshot.last_success_at'
    ]

    for (const field of requiredFields) {
      assertOk(
        telemetrySpec.jsonlFields.includes(field),
        `snapshot.result must require ${field} in Collector JSONL`
      )
    }

    strictEqual(telemetrySpec.retryable, true, 'snapshot.result must be retryable in Collector contract')
    strictEqual(telemetrySpec.pipelineStage, 'collector')
  })

  test('snapshot.result telemetry schema は success/failure の detail/error 構造を拘束する', () => {
    const thenClause = findConditional(
      (entry) => entry.if?.properties?.event?.const === 'snapshot.result'
    )
    const payloadSchema = assertPayloadSchema(thenClause, ['status', 'detail'])

    assertOk(payloadSchema.properties, 'snapshot.result payload must expose properties')
    const properties = payloadSchema.properties

    const statusSchema = resolveSchemaRef(properties.status)
    assertOk(statusSchema?.enum, 'snapshot.result status must enumerate outcomes')
    deepStrictEqual(statusSchema.enum, ['success', 'failure'])

    const detailSchema = resolveSchemaRef(properties.detail)
    assertOk(detailSchema, 'snapshot.result must define detail schema')
    assertOk(detailSchema.required, 'snapshot.result detail must define required fields')
    deepStrictEqual(detailSchema.required, [
      'duration_ms',
      'retry_count',
      'retryable',
      'error_code'
    ])
    const detailProperties = resolveSchemaProperties(detailSchema)
    assertOk(detailProperties, 'snapshot.result detail must define properties')

    const durationSchema = resolveSchemaRef(detailProperties.duration_ms)
    assertOk(durationSchema?.type === 'number', 'snapshot.result detail.duration_ms must be number')
    assertOk(
      'minimum' in durationSchema && durationSchema.minimum === 0,
      'snapshot.result detail.duration_ms must enforce minimum 0'
    )

    const retryCountSchema = resolveSchemaRef(detailProperties.retry_count)
    assertOk(retryCountSchema?.type === 'integer', 'snapshot.result detail.retry_count must be integer')
    assertOk(
      'minimum' in retryCountSchema && retryCountSchema.minimum === 0,
      'snapshot.result detail.retry_count must enforce minimum 0'
    )

    const retryableSchema = resolveSchemaRef(detailProperties.retryable)
    assertOk(retryableSchema?.type === 'boolean', 'snapshot.result detail.retryable must be boolean')

    const errorCodeSchema = resolveSchemaRef(detailProperties.error_code)
    assertOk(errorCodeSchema, 'snapshot.result detail.error_code must define schema')
    const errorCodeTypes = errorCodeSchema.type
    const allowsString = Array.isArray(errorCodeTypes)
      ? errorCodeTypes.includes('string')
      : errorCodeTypes === 'string'
    const allowsNull = Array.isArray(errorCodeTypes)
      ? errorCodeTypes.includes('null')
      : errorCodeTypes === 'null'
    assertOk(allowsString || allowsNull, 'snapshot.result detail.error_code must allow string or null')
    if (allowsString) {
      assertOk(
        'minLength' in errorCodeSchema && errorCodeSchema.minLength === 1,
        'snapshot.result detail.error_code string values must enforce minLength'
      )
    }

    const lagSecondsSchema = resolveSchemaRef(detailProperties.lag_seconds)
    assertOk(lagSecondsSchema, 'snapshot.result detail.lag_seconds must define schema')
    assertOk(
      lagSecondsSchema?.type === 'number',
      'snapshot.result detail.lag_seconds must be number'
    )
    assertOk(
      'minimum' in lagSecondsSchema && lagSecondsSchema.minimum === 0,
      'snapshot.result detail.lag_seconds must enforce minimum 0'
    )

    const payloadConditionals = payloadSchema.allOf
    assertOk(
      Array.isArray(payloadConditionals) && payloadConditionals.length >= 2,
      'snapshot.result payload must define success/failure conditionals'
    )

    const successConditional = payloadConditionals.find(
      (entry) => entry.if?.properties?.status?.const === 'success'
    )
    assertOk(successConditional, 'snapshot.result payload must define success conditional')
    const successThen = successConditional.then
    assertOk(successThen, 'snapshot.result success conditional must define then clause')
    assertOk(
      successThen.required?.includes('snapshot'),
      'snapshot.result success payload must require snapshot object'
    )
    const successSnapshotSchema = resolveSchemaRef(
      successThen.properties?.snapshot ?? properties.snapshot
    )
    assertOk(successSnapshotSchema, 'snapshot.result success must define snapshot schema')
    assertOk(
      successSnapshotSchema?.required,
      'snapshot.result snapshot schema must define required fields'
    )
    deepStrictEqual(
      Array.from(successSnapshotSchema.required),
      ['bytes', 'retained_bytes', 'generation', 'last_success_at']
    )

    const failureConditional = payloadConditionals.find(
      (entry) => entry.if?.properties?.status?.const === 'failure'
    )
    assertOk(failureConditional, 'snapshot.result payload must define failure conditional')
    const failureThen = failureConditional.then
    assertOk(failureThen, 'snapshot.result failure conditional must define then clause')
    const failureDetailSchema = resolveSchemaRef(failureThen.properties?.detail)
    const failureDetailProperties = resolveSchemaProperties(failureDetailSchema)
    assertOk(
      failureDetailProperties,
      'snapshot.result failure detail must define properties'
    )
    const errorMessageSchema = resolveSchemaRef(
      failureDetailProperties?.error_message
    )
    assertOk(
      errorMessageSchema && errorMessageSchema.type === 'string',
      'snapshot.result failure must include error_message string'
    )
    assertOk(
      'minLength' in errorMessageSchema && errorMessageSchema.minLength === 1,
      'snapshot.result failure error_message must enforce minLength'
    )
  })

  test('publishSnapshotResult は Collector 契約の success payload を送信する', () => {
    const captured: Day8CollectorSnapshotResultEvent[] = []
    const scope = globalThis as { Day8Collector?: Day8Collector }
    const previousCollector = scope.Day8Collector
    scope.Day8Collector = {
      publish(event) {
        captured.push(event as Day8CollectorSnapshotResultEvent)
      }
    } as Day8Collector

    try {
      const overrides = {
        reqId: '00000000-0000-4000-8000-000000000001',
        correlationId: '00000000-0000-4000-8000-000000000002',
        ts: '2024-01-01T00:00:00.000Z'
      } as const

      publishSnapshotResult({
        phase: 'A-1',
        status: 'success',
        detail: {
          duration_ms: 120,
          retry_count: 1,
          retryable: false,
          error_code: null,
          lag_seconds: 45
        },
        snapshot: {
          bytes: 1024,
          retained_bytes: 2048,
          generation: 3,
          last_success_at: '2023-12-31T23:59:00.000Z'
        },
        overrides
      })
    } finally {
      scope.Day8Collector = previousCollector
    }

    strictEqual(captured.length, 1, 'snapshot.result collector event must be emitted')
    const [event] = captured
    assertOk(event, 'snapshot.result collector event must be captured')
    strictEqual(event.schema, 'vscode.telemetry.v1')
    strictEqual(event.event, 'snapshot.result')
    strictEqual(event.feature, 'autosave-diff-merge')
    strictEqual(event.component, 'autosave')
    strictEqual(event.kind, 'save')
    strictEqual(event.source, 'app.autosave')
    strictEqual(event.reqId, '00000000-0000-4000-8000-000000000001')
    strictEqual(event.correlationId, '00000000-0000-4000-8000-000000000002')
    strictEqual(event.ts, '2024-01-01T00:00:00.000Z')
    strictEqual(event.evaluation_ms, 120)
    deepStrictEqual(event.payload, {
      status: 'success',
      detail: {
        duration_ms: 120,
        retry_count: 1,
        retryable: false,
        error_code: null,
        lag_seconds: 45
      },
      snapshot: {
        bytes: 1024,
        retained_bytes: 2048,
        generation: 3,
        last_success_at: '2023-12-31T23:59:00.000Z'
      }
    })
  })

  test('publishSnapshotResult は failure payload を正規化して Collector へ送信する', () => {
    const captured: Day8CollectorSnapshotResultEvent[] = []
    const scope = globalThis as { Day8Collector?: Day8Collector }
    const previousCollector = scope.Day8Collector
    scope.Day8Collector = {
      publish(event) {
        captured.push(event as Day8CollectorSnapshotResultEvent)
      }
    } as Day8Collector

    try {
      const overrides = {
        reqId: '00000000-0000-4000-8000-000000000003',
        correlationId: '00000000-0000-4000-8000-000000000004',
        ts: '2024-01-02T00:00:00.000Z'
      } as const

      publishSnapshotResult({
        phase: 'A-2',
        status: 'failure',
        detail: {
          duration_ms: 321.6,
          retry_count: 3.9,
          retryable: true,
          error_code: '  disk-full  ',
          error_message: '   disk is full   ',
          lag_seconds: 12.9
        },
        snapshot: {
          bytes: 4096.7,
          retained_bytes: 8191.2,
          generation: 12.5,
          last_success_at: '   '
        },
        overrides
      })
    } finally {
      scope.Day8Collector = previousCollector
    }

    strictEqual(captured.length, 1, 'snapshot.result failure event must be emitted')
    const [event] = captured
    assertOk(event, 'snapshot.result failure event must be captured')
    strictEqual(event.schema, 'vscode.telemetry.v1')
    strictEqual(event.event, 'snapshot.result')
    strictEqual(event.evaluation_ms, 322)
    deepStrictEqual(event.payload, {
      status: 'failure',
      detail: {
        duration_ms: 322,
        retry_count: 3,
        retryable: true,
        error_code: 'disk-full',
        error_message: 'disk is full',
        lag_seconds: 12
      },
      snapshot: {
        bytes: 4096,
        retained_bytes: 8191,
        generation: 12,
        last_success_at: '2024-01-02T00:00:00.000Z'
      }
    })
  })

  test('publishSnapshotResult は snapshot なし failure payload を Collector へ送信する', () => {
    const captured: Day8CollectorSnapshotResultEvent[] = []
    const scope = globalThis as { Day8Collector?: Day8Collector }
    const previousCollector = scope.Day8Collector
    scope.Day8Collector = {
      publish(event) {
        captured.push(event as Day8CollectorSnapshotResultEvent)
      }
    } as Day8Collector

    try {
      const overrides = {
        reqId: '00000000-0000-4000-8000-000000000005',
        correlationId: '00000000-0000-4000-8000-000000000006',
        ts: '2024-01-03T00:00:00.000Z'
      } as const

      publishSnapshotResult({
        phase: 'A-2',
        status: 'failure',
        detail: {
          duration_ms: -42,
          retry_count: -1,
          retryable: false,
          error_code: '   ',
          error_message: '   ',
          lag_seconds: Number.NaN
        },
        overrides
      })
    } finally {
      scope.Day8Collector = previousCollector
    }

    strictEqual(captured.length, 1, 'snapshot.result failure event without snapshot must be emitted')
    const [event] = captured
    assertOk(event, 'snapshot.result failure event without snapshot must be captured')
    strictEqual(event.schema, 'vscode.telemetry.v1')
    strictEqual(event.event, 'snapshot.result')
    strictEqual(event.evaluation_ms, 0)
    deepStrictEqual(event.payload, {
      status: 'failure',
      detail: {
        duration_ms: 0,
        retry_count: 0,
        retryable: false,
        error_code: 'unknown',
        error_message: 'unknown'
      }
    })
  })

  test('flag_resolution telemetry は evaluation_ms を必須にし Phase ガード指標へ渡す', () => {
    const spec = findTelemetrySpec('flag_resolution')
    assertOk(spec, 'flag_resolution telemetry spec is missing')
    const telemetrySpec = spec

    const requiredFields = [
      'feature',
      'component',
      'kind',
      'source',
      'evaluation_ms',
      'payload.flag',
      'payload.variant',
      'payload.source',
      'payload.phase',
      'payload.evaluation_ms',
      'payload.precision',
      'payload.errors',
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
      'precision',
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
        precision: null,
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
    assertOk(UUID_REGEX.test(event.reqId), 'flag_resolution reqId must be uuid')
    assertOk(UUID_REGEX.test(event.correlationId), 'flag_resolution correlationId must be uuid')
    assertOk(UUID_REGEX.test(event.workspace_id), 'flag_resolution workspace_id must be uuid')
    strictEqual(
      event.correlationId,
      event.reqId,
      'flag_resolution correlationId must match reqId'
    )
    assertOk(
      Array.isArray(event.payload.errors),
      'flag_resolution payload must include errors array'
    )
    deepStrictEqual(event.payload.errors, [])
    deepStrictEqual(event.feature, 'config.flags')
    deepStrictEqual(event.component, 'flags')
    deepStrictEqual(event.kind, 'flag_resolution')
    strictEqual(event.source, 'app.autosave')
    strictEqual(event.evaluation_ms, 42)
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

  test('flag_resolution 失敗時は Incident タグと相関 ID を伴う error telemetry を publish する', () => {
    const captured: Day8CollectorErrorEvent[] = []
    const scope = globalThis as { Day8Collector?: Day8Collector }
    const previousCollector = scope.Day8Collector
    scope.Day8Collector = {
      publish(event) {
        if (event.event === 'error') {
          captured.push(event as Day8CollectorErrorEvent)
        }
      }
    } as Day8Collector

    try {
      const payload: FlagResolutionEventPayload = {
        flag: 'plugins.enable',
        variant: 'disabled',
        source: 'env',
        phase: 'phase-a0',
        evaluation_ms: 17,
        errors: [
          {
            code: 'invalid-boolean',
            flag: 'plugins.enable',
            raw: 'maybe',
            message: 'flag parse failed',
            retryable: false,
            source: 'env',
            phase: 'phase-a0'
          }
        ],
        precision: null,
        threshold: null,
        status: 'failure',
        detail: { retryable: false, default_used: true }
      }

      publishFlagResolution('app.flags', 'snapshot', [payload], 33)
    } finally {
      scope.Day8Collector = previousCollector
    }

    assertOk(captured.length > 0, 'error telemetry must be captured when flag resolution fails')
    const [event] = captured
    assertOk(event, 'error telemetry event must be captured')
    assertOk(UUID_REGEX.test(event.reqId), 'error telemetry reqId must be uuid')
    assertOk(UUID_REGEX.test(event.correlationId), 'error telemetry correlationId must be uuid')
    strictEqual(event.correlationId, event.reqId, 'error telemetry correlationId must match reqId')
    assertOk(Array.isArray(event.payload.tags), 'error telemetry must define tags array')
    const tagSet = new Set(event.payload.tags)
    const expectedTags = [
      `component:${event.component}`,
      'feature:config.flags',
      'phase:A-0',
      'flag:plugins.enable',
      'status:failure',
      'source:env',
      'errors:1',
      `correlation:${event.correlationId}`
    ]
    for (const tag of expectedTags) {
      assertOk(tagSet.has(tag), `error telemetry must include ${tag}`)
    }

    deepStrictEqual(event.kind, 'error')
    deepStrictEqual(event.feature, 'config.flags')
    deepStrictEqual(event.component, 'flags')
    strictEqual(event.source, 'app.flags')
    strictEqual(event.evaluation_ms, 33)

    const detail = event.payload.detail
    deepStrictEqual(detail.error_code, 'flag_resolution.invalid-boolean')
    deepStrictEqual(detail.retryable, false)
    deepStrictEqual(detail.message, 'flag parse failed')
  })

  test('publishFlagResolution は overrides reqId/correlationId を UUID に正規化する', () => {
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
        precision: null,
        threshold: null,
        status: 'success',
        detail: { retryable: false, default_used: false }
      }
      publishFlagResolution('app.autosave', 'bootstrap', [payload], 42, {
        reqId: 'not-a-uuid',
        correlationId: 'also-not-a-uuid'
      })
    } finally {
      scope.Day8Collector = previousCollector
    }

    assertOk(captured.length > 0, 'flag_resolution telemetry must be published when overrides provided')
    const [event] = captured
    assertOk(event, 'flag_resolution event must be captured when overrides provided')
    assertOk(UUID_REGEX.test(event.reqId), 'flag_resolution reqId overrides must be normalized to uuid')
    assertOk(UUID_REGEX.test(event.correlationId), 'flag_resolution correlationId overrides must be normalized to uuid')
    assertOk(UUID_REGEX.test(event.workspace_id), 'flag_resolution workspace_id overrides must be normalized to uuid')
    strictEqual(event.correlationId, event.reqId, 'flag_resolution correlationId overrides must match reqId when normalized')
    strictEqual(
      event.reqId === 'not-a-uuid',
      false,
      'flag_resolution reqId override must not leak invalid value'
    )
    strictEqual(
      event.correlationId === 'also-not-a-uuid',
      false,
      'flag_resolution correlationId override must not leak invalid value'
    )
  })

  test('publishFlagResolution は phase-a2/b1 を Collector 契約フェーズへ変換する', () => {
    const captured: Day8CollectorFlagResolutionEvent[] = []
    const scope = globalThis as { Day8Collector?: Day8Collector }
    const previousCollector = scope.Day8Collector
    scope.Day8Collector = {
      publish(event) {
        captured.push(event as Day8CollectorFlagResolutionEvent)
      }
    } as Day8Collector

    try {
      const phaseA2Payload: FlagResolutionEventPayload = {
        flag: 'autosave.enabled',
        variant: 'true',
        source: 'env',
        phase: 'phase-a2',
        evaluation_ms: 5,
        errors: [],
        precision: null,
        threshold: null,
        status: 'success',
        detail: { retryable: false, default_used: false }
      }
      const phaseB1Payload: FlagResolutionEventPayload = {
        flag: 'plugins.enable',
        variant: 'false',
        source: 'default',
        phase: 'phase-b1',
        evaluation_ms: 7,
        errors: [],
        precision: null,
        threshold: null,
        status: 'success',
        detail: { retryable: false, default_used: false }
      }
      publishFlagResolution('app.flags', 'bootstrap', [phaseA2Payload, phaseB1Payload], 11)
    } finally {
      scope.Day8Collector = previousCollector
    }

    assertOk(captured.length >= 2, 'flag_resolution telemetry must capture all payloads')
    const [phaseA2Event, phaseB1Event] = captured
    assertOk(phaseA2Event, 'phase-a2 telemetry must be captured')
    deepStrictEqual(phaseA2Event.payload.flag, 'autosave.enabled')
    deepStrictEqual(phaseA2Event.payload.phase, 'A-2')

    assertOk(phaseB1Event, 'phase-b1 telemetry must be captured')
    deepStrictEqual(phaseB1Event.payload.flag, 'plugins.enable')
    deepStrictEqual(phaseB1Event.payload.phase, 'B-1')
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
      'precision',
      'threshold',
      'status',
      'detail',
      'errors'
    ])

    assertOk(payloadSchema.properties, 'flag_resolution payload schema must define properties')
    const precisionSchema = resolveSchemaRef(payloadSchema.properties.precision)
    assertOk(precisionSchema, 'flag_resolution payload schema must define precision')
    assertOk(
      precisionSchema.enum,
      'flag_resolution payload precision must enumerate merge precision variants'
    )
    deepStrictEqual(precisionSchema.enum, [...MERGE_PRECISION_VARIANTS, null])
    strictEqual(
      precisionSchema.description,
      'Merge precision variant when available; null for non-merge flags.'
    )

    const sourceSchema = payloadSchema.properties.source
    assertOk(sourceSchema, 'flag_resolution payload schema must define source')
    assertOk(sourceSchema.enum, 'flag_resolution source must define enum')
    deepStrictEqual(sourceSchema.enum, Array.from(FLAG_RESOLUTION_SOURCE_VARIANTS))

    const errorsSchema = payloadSchema.properties.errors
    assertOk(errorsSchema, 'flag_resolution payload schema must define errors array')
    assertOk(errorsSchema.type === 'array', 'flag_resolution payload errors must be an array')
    assertFlagValidationErrorSchema(errorsSchema.items)

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
      precision: null,
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
    strictEqual(event.payload.precision, null)
    deepStrictEqual(event.payload.detail, {
      retryable: false,
      default_used: true
    })
  })

  test('publishFlagResolution は Collector 封筒フィールドを契約既定値で埋める', () => {
    const retryPolicy = COLLECT_METRICS_CONTRACT.telemetry.retryPolicy
    const payload: FlagResolutionEventPayload = {
      flag: 'autosave.enabled',
      variant: 'true',
      source: 'env',
      phase: 'phase-a0',
      evaluation_ms: 5,
      errors: [],
      precision: null,
      threshold: null,
      status: 'success',
      detail: { retryable: false, default_used: false }
    }

    const scope = globalThis as { Day8Collector?: Day8Collector }
    const captured: Day8CollectorFlagResolutionEvent[] = []
    const previousCollector = scope.Day8Collector
    scope.Day8Collector = {
      publish(event) {
        captured.push(event as Day8CollectorFlagResolutionEvent)
      }
    } as Day8Collector

    try {
      publishFlagResolution('app.autosave', 'bootstrap', [payload], 7)
    } finally {
      scope.Day8Collector = previousCollector
    }

    strictEqual(captured.length, 1)
    const event = captured[0]

    strictEqual(event.type, 'telemetry.event')
    strictEqual(event.apiVersion, 1)
    assertOk(event.reqId.length > 0)
    assertOk(event.correlationId.length > 0)
    assertOk(event.workspace_id.length > 0)
    assertOk(UUID_REGEX.test(event.workspace_id))
    assertOk(!Number.isNaN(Date.parse(event.ts)))
    strictEqual(event.phase, 'A-0')
    strictEqual(event.feature, 'config.flags')
    strictEqual(event.component, 'flags')
    strictEqual(event.kind, 'flag_resolution')
    strictEqual(event.source, 'app.autosave')
    strictEqual(event.evaluation_ms, 7)
    strictEqual(event.attempt, 1)
    strictEqual(event.maxAttempts, retryPolicy.maxAttempts)
    deepStrictEqual(event.backoffMs, retryPolicy.backoffMs)
    strictEqual(event.reqId, event.correlationId)
  })

  test('publishFlagResolution は CONIMG_WORKSPACE_ID を優先して使用する', () => {
    const workspaceId = '11111111-2222-4111-8111-aaaaaaaaaaaa'
    const payload: FlagResolutionEventPayload = {
      flag: 'autosave.enabled',
      variant: 'true',
      source: 'env',
      phase: 'phase-a0',
      evaluation_ms: 5,
      errors: [],
      precision: null,
      threshold: null,
      status: 'success',
      detail: { retryable: false, default_used: false }
    }

    const scope = globalThis as { Day8Collector?: Day8Collector }
    const captured: Day8CollectorFlagResolutionEvent[] = []
    const previousCollector = scope.Day8Collector
    scope.Day8Collector = {
      publish(event) {
        captured.push(event as Day8CollectorFlagResolutionEvent)
      }
    } as Day8Collector

    const previousEnv = process.env.CONIMG_WORKSPACE_ID
    process.env.CONIMG_WORKSPACE_ID = workspaceId
    resetWorkspaceIdCacheForTests()

    try {
      publishFlagResolution('app.autosave', 'bootstrap', [payload], 7)
    } finally {
      if (previousEnv === undefined) {
        delete process.env.CONIMG_WORKSPACE_ID
      } else {
        process.env.CONIMG_WORKSPACE_ID = previousEnv
      }
      resetWorkspaceIdCacheForTests()
      scope.Day8Collector = previousCollector
    }

    assertOk(captured.length > 0, 'flag_resolution telemetry must be published when workspace id env is set')
    const [event] = captured
    assertOk(event, 'flag_resolution event must be captured when workspace id env is set')
    strictEqual(event.workspace_id, workspaceId)
    strictEqual(event.payload.precision, null)
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

  test('collectFlagResolutionPayloads は precision を payload.precision に設定する', () => {
    const snapshot: FlagSnapshot = {
      autosave: {
        value: true,
        source: 'env',
        errors: [],
        enabled: true
      },
      plugins: {
        value: false,
        source: 'localStorage',
        errors: [],
        enabled: false
      },
      merge: {
        value: 'beta',
        source: 'workspace',
        errors: [],
        precision: 'beta',
        threshold: 0.65
      },
      updatedAt: new Date(0).toISOString()
    }

    const payloads = collectFlagResolutionPayloads(snapshot, [], 11)
    const autosavePayload = payloads.find(
      (payload) => payload.flag === 'autosave.enabled'
    )
    assertOk(autosavePayload, 'autosave flag payload must exist')
    strictEqual(autosavePayload.precision, null)

    const mergePayload = payloads.find(
      (payload) => payload.flag === 'merge.precision'
    )
    assertOk(mergePayload, 'merge flag payload must exist')
    strictEqual(mergePayload.precision, 'beta')
  })

  test('collectFlagResolutionPayloads は phase-a2/b1 を JSONL 契約フェーズへ伝搬する', () => {
    const thenClause = findConditional(
      (entry) => entry.if?.properties?.event?.const === 'flag_resolution'
    )
    const payloadSchema = assertPayloadSchema(thenClause, [
      'flag',
      'variant',
      'source',
      'phase',
      'evaluation_ms',
      'precision',
      'threshold',
      'status',
      'detail',
      'errors'
    ])
    assertOk(payloadSchema.properties, 'flag_resolution payload schema must define properties')
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

    const definitions = FEATURE_FLAG_DEFINITIONS as Record<
      FeatureFlagName,
      { phase: FlagResolutionEventPayload['phase'] }
    >
    const pluginsPhase = definitions['plugins.enable'].phase
    const mergePhase = definitions['merge.precision'].phase
    definitions['plugins.enable'].phase = 'phase-a2'
    definitions['merge.precision'].phase = 'phase-b1'

    const snapshot: FlagSnapshot = {
      autosave: {
        value: true,
        source: 'env',
        errors: [],
        enabled: true
      },
      plugins: {
        value: false,
        source: 'default',
        errors: [],
        enabled: false
      },
      merge: {
        value: 'legacy',
        source: 'workspace',
        errors: [],
        precision: 'legacy',
        threshold: 0.8
      },
      updatedAt: new Date(0).toISOString()
    }

    try {
      const payloads = collectFlagResolutionPayloads(snapshot, [], 3)
      const scope = globalThis as { Day8Collector?: Day8Collector }
      const captured: Day8CollectorFlagResolutionEvent[] = []
      const previousCollector = scope.Day8Collector
      scope.Day8Collector = {
        publish(event) {
          captured.push(event as Day8CollectorFlagResolutionEvent)
        }
      } as Day8Collector

      try {
        publishFlagResolution('app.flags', 'snapshot', payloads, 3)
      } finally {
        scope.Day8Collector = previousCollector
      }

      const phases = captured.map((event) => event.payload.phase)
      assertOk(phases.includes('A-2'), 'phase-a2 must map to A-2 contract phase')
      assertOk(phases.includes('B-1'), 'phase-b1 must map to B-1 contract phase')
      for (const phase of phases) {
        assertOk(
          allowedPhaseEnum.includes(phase),
          `collector payload phase ${phase} must satisfy schema enum`
        )
      }
    } finally {
      definitions['plugins.enable'].phase = pluginsPhase
      definitions['merge.precision'].phase = mergePhase
    }
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
      'guard',
      'detail',
      'performance'
    ])

    assertOk(payloadSchema.properties, 'status.autosave payload schema must define properties')

    const stateSchema = resolveSchemaRef(payloadSchema.properties.state)
    assertOk(stateSchema, 'status.autosave payload schema must define state')
    assertOk(stateSchema.type === 'string', 'status.autosave payload state must be string')
    assertOk(stateSchema.enum, 'status.autosave payload state must define enum')
    deepStrictEqual(
      Array.from(stateSchema.enum).sort(),
      ['disabled', 'dirty', 'saving', 'saved', 'error', 'backoff'].sort()
    )

    const guardSchema = payloadSchema.properties.guard
    assertOk(guardSchema, 'status.autosave payload schema must define guard')
    assertOk(guardSchema.required, 'status.autosave guard must define required fields')
    deepStrictEqual(guardSchema.required, ['current', 'rollbackTo'])

    const detailSchema = payloadSchema.properties.detail
    assertOk(detailSchema, 'status.autosave payload schema must define detail')
    const resolvedDetail = resolveSchemaRef(detailSchema)
    assertOk(resolvedDetail, 'status.autosave payload detail schema must resolve')
    assertOk(resolvedDetail.type === 'object', 'status.autosave payload detail must be object')
    assertOk(
      resolvedDetail.additionalProperties === false,
      'status.autosave payload detail must forbid additional properties'
    )
    assertOk(resolvedDetail.required, 'status.autosave payload detail must define required fields')
    deepStrictEqual(resolvedDetail.required, ['retry_count'])
    assertOk(resolvedDetail.properties, 'status.autosave payload detail must define retry_count property')
    const retryCountSchema = resolveSchemaRef(resolvedDetail.properties.retry_count)
    assertOk(
      retryCountSchema && retryCountSchema.type === 'integer',
      'status.autosave payload detail.retry_count must be integer'
    )
    assertOk(
      'minimum' in retryCountSchema && retryCountSchema.minimum === 0,
      'status.autosave payload detail.retry_count must enforce non-negative values'
    )

    const performanceSchema = payloadSchema.properties.performance
    assertOk(performanceSchema, 'status.autosave payload schema must define performance')
    const resolvedPerformance = resolveSchemaRef(performanceSchema)
    assertOk(resolvedPerformance, 'status.autosave payload performance schema must resolve')
    assertOk(
      resolvedPerformance.type === 'object',
      'status.autosave payload performance must be object'
    )
    assertOk(
      resolvedPerformance.additionalProperties === false,
      'status.autosave payload performance must forbid additional properties'
    )
    assertOk(
      resolvedPerformance.required,
      'status.autosave payload performance must define required fields'
    )
    deepStrictEqual(resolvedPerformance.required, ['flush_latency_ms'])
    assertOk(
      resolvedPerformance.properties,
      'status.autosave payload performance must define flush_latency_ms'
    )
    const flushLatencySchema = resolveSchemaRef(resolvedPerformance.properties.flush_latency_ms)
    assertOk(
      flushLatencySchema && flushLatencySchema.type === 'number',
      'status.autosave payload performance.flush_latency_ms must be number'
    )
    assertOk(
      'minimum' in flushLatencySchema && flushLatencySchema.minimum === 0,
      'status.autosave payload performance.flush_latency_ms must enforce non-negative values'
    )
  })

  test('telemetry schema の merge.result payload が Collector 要件を固定する', () => {
    const thenClause = findConditional(
      (entry) => entry.if?.properties?.event?.const === 'merge.result'
    )
    const payloadSchema = assertPayloadSchema(thenClause, [
      'status',
      'precision',
      'processing_ms',
      'conflict_segments'
    ])

    assertOk(payloadSchema.properties, 'merge.result payload schema must define properties')
    deepStrictEqual(payloadSchema.additionalProperties, false)

    const statusSchema = resolveSchemaRef(payloadSchema.properties.status)
    assertOk(statusSchema, 'merge.result payload schema must define status')
    deepStrictEqual(statusSchema.enum, ['success', 'conflict', 'error'])

    const precisionSchema = resolveSchemaRef(payloadSchema.properties.precision)
    assertOk(precisionSchema, 'merge.result payload schema must define precision')
    deepStrictEqual(precisionSchema.enum, Array.from(MERGE_PRECISION_VARIANTS))

    const processingSchema = resolveSchemaRef(payloadSchema.properties.processing_ms)
    assertOk(processingSchema, 'merge.result payload must define processing_ms schema')
    deepStrictEqual(processingSchema, { type: 'number', minimum: 0 })

    const conflictSchema = resolveSchemaRef(payloadSchema.properties.conflict_segments)
    assertOk(conflictSchema, 'merge.result payload must define conflict_segments schema')
    deepStrictEqual(conflictSchema, { type: 'integer', minimum: 0 })

    const errorSchema = resolveSchemaRef(payloadSchema.properties.error)
    assertOk(errorSchema, 'merge.result payload schema must define error object')
    deepStrictEqual(errorSchema.type, 'object')
    deepStrictEqual(errorSchema.additionalProperties, false)
    assertOk(errorSchema.required, 'merge.result error schema must define required fields')
    deepStrictEqual(errorSchema.required, ['code', 'message', 'retryable'])
    assertOk(errorSchema.properties, 'merge.result error schema must define properties')
    deepStrictEqual(resolveSchemaRef(errorSchema.properties.code), { type: 'string', minLength: 1 })
    deepStrictEqual(resolveSchemaRef(errorSchema.properties.message), {
      type: 'string',
      minLength: 1
    })
    deepStrictEqual(resolveSchemaRef(errorSchema.properties.retryable), { type: 'boolean' })
  })

  test('merge.result telemetry は 成功率と処理時間を Collector JSONL に固定する', () => {
    const spec = findTelemetrySpec('merge.result')
    assertOk(spec, 'merge.result telemetry spec is missing')

    deepStrictEqual(spec.jsonlFields, [
      'payload.status',
      'payload.precision',
      'payload.processing_ms',
      'payload.conflict_segments',
      'payload.error.code',
      'payload.error.message',
      'payload.error.retryable'
    ])
    strictEqual(spec.retryable, true, 'merge.result telemetry must be retryable in Collector contract')
    strictEqual(spec.pipelineStage, 'collector')
    assertOk(spec.guardrail, 'merge.result telemetry must define guardrail')
    deepStrictEqual(spec.guardrail.metric, 'merge_auto_success_rate')
    assertOk(
      spec.description.includes('merge_processing_p95'),
      'merge.result telemetry description must mention merge_processing_p95 metric for processing aggregation'
    )
  })

  test('merge.result telemetry guardrail は merge_processing_p95 をガード指標に含める', () => {
    const spec = findTelemetrySpec('merge.result')
    assertOk(spec, 'merge.result telemetry spec is missing for guard indicators')

    const guardrail = spec.guardrail
    assertOk(guardrail, 'merge.result telemetry guardrail must be defined for guard indicators')
    assertOk(Array.isArray(guardrail.guardIndicators), 'guardIndicators must be defined as array')
    assertOk(
      guardrail.guardIndicators.includes('merge_processing_p95'),
      'merge.result guardIndicators must include merge_processing_p95'
    )
  })

  test('collect-metrics 契約は merge_processing_p95 指標を Phase B ガードで監視する', () => {
    const { inputRecord, phaseGates, telemetry } = COLLECT_METRICS_CONTRACT

    strictEqual(
      typeof inputRecord.merge_processing_p95,
      'number',
      'input record must define merge_processing_p95 metric'
    )

    const phaseBGuardrails = phaseGates
      .filter((phase) => phase.phase === 'B-0' || phase.phase === 'B-1')
      .flatMap((phase) => phase.guardrails)

    assertOk(
      phaseBGuardrails.some((guard) => guard.metric === 'merge_processing_p95'),
      'Phase B guardrails must monitor merge_processing_p95 threshold'
    )

    const mergeResultSpec = telemetry.events.find((event) => event.event === 'merge.result')
    assertOk(mergeResultSpec, 'merge.result telemetry spec must exist for merge_processing_p95 aggregation')
    assertOk(
      mergeResultSpec.jsonlFields.includes('payload.processing_ms'),
      'merge.result telemetry must expose processing_ms for merge_processing_p95 aggregation'
    )
  })

  test('publishMergeResult は merge.result イベントを Collector 契約通りに送信する', () => {
    const captured: Day8CollectorMergeResultEvent[] = []
    const scope = globalThis as { Day8Collector?: Day8Collector }
    const previousCollector = scope.Day8Collector
    scope.Day8Collector = {
      publish(event) {
        captured.push(event as Day8CollectorMergeResultEvent)
      }
    } as Day8Collector

    const successOverrides = {
      reqId: '00000000-0000-4000-8000-000000000101',
      correlationId: '00000000-0000-4000-8000-000000000101',
      workspace_id: '00000000-0000-4000-8000-000000000201',
      ts: '2024-01-02T03:04:05.678Z'
    } as const
    const errorOverrides = {
      reqId: '00000000-0000-4000-8000-000000000301',
      correlationId: '00000000-0000-4000-8000-000000000302',
      workspace_id: '00000000-0000-4000-8000-000000000303',
      ts: '2024-01-02T04:05:06.789Z'
    } as const

    try {
      publishMergeResult({
        precision: 'beta',
        processingMs: 123.6,
        conflictSegments: 0,
        status: 'success',
        overrides: successOverrides
      })

      publishMergeResult({
        precision: 'legacy',
        processingMs: -5,
        conflictSegments: -3,
        status: 'error',
        overrides: errorOverrides,
        error: {}
      })
    } finally {
      scope.Day8Collector = previousCollector
    }

    strictEqual(captured.length, 2, 'merge.result telemetry must be published twice')
    const [successEvent, errorEvent] = captured

    assertOk(successEvent, 'merge.result success event must be captured')
    strictEqual(successEvent.event, 'merge.result')
    strictEqual(successEvent.feature, 'autosave-diff-merge')
    strictEqual(successEvent.component, 'merge')
    strictEqual(successEvent.kind, 'merge')
    strictEqual(successEvent.source, 'app.merge')
    strictEqual(successEvent.phase, 'B-0')
    strictEqual(successEvent.reqId, successOverrides.reqId)
    strictEqual(successEvent.correlationId, successOverrides.correlationId)
    strictEqual(successEvent.workspace_id, successOverrides.workspace_id)
    strictEqual(successEvent.evaluation_ms, 124)
    deepStrictEqual(successEvent.payload, {
      status: 'success',
      precision: 'beta',
      processing_ms: 124,
      conflict_segments: 0
    })

    assertOk(errorEvent, 'merge.result error event must be captured')
    strictEqual(errorEvent.event, 'merge.result')
    strictEqual(errorEvent.feature, 'autosave-diff-merge')
    strictEqual(errorEvent.component, 'merge')
    strictEqual(errorEvent.kind, 'merge')
    strictEqual(errorEvent.source, 'app.merge')
    strictEqual(errorEvent.phase, 'A-2')
    strictEqual(errorEvent.reqId, errorOverrides.reqId)
    strictEqual(errorEvent.correlationId, errorOverrides.correlationId)
    strictEqual(errorEvent.workspace_id, errorOverrides.workspace_id)
    strictEqual(errorEvent.evaluation_ms, 0)
    deepStrictEqual(errorEvent.payload, {
      status: 'error',
      precision: 'legacy',
      processing_ms: 0,
      conflict_segments: 0,
      error: {
        code: 'unknown',
        message: 'unknown',
        retryable: false
      }
    })
  })

  test('merge.result telemetry は merge.trace と guardrail/digest 項目が重複しない', () => {
    const resultSpec = findTelemetrySpec('merge.result')
    assertOk(resultSpec, 'merge.result telemetry spec is missing')
    const traceSpec = findTelemetrySpec('merge.trace')
    assertOk(traceSpec, 'merge.trace telemetry spec is missing')

    for (const field of resultSpec.jsonlFields) {
      assertOk(!field.startsWith('payload.guardrail'), 'merge.result must not expose guardrail fields')
      strictEqual(field === 'payload.digest', false, 'merge.result must not expose digest field')
    }

    assertOk(
      traceSpec.jsonlFields.includes('payload.guardrail.metric'),
      'merge.trace must retain guardrail.metric field'
    )
    assertOk(traceSpec.jsonlFields.includes('payload.digest'), 'merge.trace must retain digest field')
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
  test('export.result telemetry は status/detail/artifacts.bytes を Reporter JSONL に固定する', () => {
    const spec = findTelemetrySpec('export.result')
    assertOk(spec, 'export.result telemetry spec is missing')

    deepStrictEqual(spec.jsonlFields, [
      'payload.status',
      'payload.runId',
      'payload.matchRate',
      'payload.formats',
      'payload.duration_ms',
      'payload.detail.duration_ms',
      'payload.summary.export_latency_p95',
      'payload.summary.export_success_rate',
      'payload.artifacts[].format',
      'payload.artifacts[].name',
      'payload.artifacts[].status',
      'payload.artifacts[].normalizedPath',
      'payload.artifacts[].uri',
      'payload.artifacts[].durationMs',
      'payload.artifacts[].bytes',
      'payload.error.code',
      'payload.error.message',
      'payload.error.retryable',
      'payload.entries[].format',
      'payload.entries[].name',
      'payload.entries[].status',
      'payload.entries[].diff',
      'payload.next_backoff_ms',
    ])

    const thenClause = findConditional(
      (entry) => entry.if?.properties?.event?.const === 'export.result',
    )

    const payloadSchema = assertPayloadSchema(thenClause, [
      'status',
      'runId',
      'matchRate',
      'formats',
      'duration_ms',
      'detail',
      'artifacts',
    ])

    assertOk(payloadSchema.properties, 'export.result payload schema must define properties')
    const statusSchema = resolveSchemaRef(payloadSchema.properties.status)
    assertOk(statusSchema, 'export.result payload must define status schema')
    assertOk(statusSchema?.enum, 'export.result status must enumerate outcomes')
    deepStrictEqual(statusSchema.enum, ['success', 'failure'])
    const durationSchemaTop = resolveSchemaRef(payloadSchema.properties.duration_ms)
    assertOk(durationSchemaTop, 'export.result payload must define duration_ms schema')
    deepStrictEqual(durationSchemaTop, { type: 'number', minimum: 0 })
    const artifactsSchema = resolveSchemaRef(payloadSchema.properties.artifacts)
    assertOk(artifactsSchema, 'export.result payload must define artifacts schema')
    deepStrictEqual(artifactsSchema.type, 'array')
    const artifactsItems = resolveSchemaRef(artifactsSchema.items)
    assertOk(artifactsItems, 'export.result payload artifacts must define item schema')
    deepStrictEqual(artifactsItems.type, 'object')
    deepStrictEqual(artifactsItems.additionalProperties, false)
    assertOk(
      artifactsItems.required,
      'export.result payload artifact schema must define required fields',
    )
    deepStrictEqual(
      Array.from(artifactsItems.required),
      [
        'format',
        'name',
        'status',
        'uri',
        'normalizedPath',
        'durationMs',
        'bytes',
      ],
    )
    assertOk(artifactsItems.properties, 'export.result payload artifact schema must define properties')
    const bytesSchema = resolveSchemaRef(artifactsItems.properties.bytes)
    assertOk(bytesSchema, 'export.result payload artifact must define bytes schema')
    deepStrictEqual(bytesSchema, { type: ['number', 'null'], minimum: 0 })

    const detailSchema = resolveSchemaRef(payloadSchema.properties.detail)
    assertOk(detailSchema, 'export.result payload must define detail schema')
    deepStrictEqual(detailSchema.type, 'object')
    deepStrictEqual(detailSchema.additionalProperties, false)
    assertOk(detailSchema.required, 'export.result payload detail must define required fields')
    deepStrictEqual(detailSchema.required, ['duration_ms'])
    assertOk(detailSchema.properties, 'export.result payload detail must define properties')
    const durationSchema = resolveSchemaRef(detailSchema.properties.duration_ms)
    assertOk(durationSchema, 'export.result payload detail must define duration_ms schema')
    deepStrictEqual(durationSchema, { type: 'number', minimum: 0 })

    const nextBackoffSchema = resolveSchemaRef(payloadSchema.properties.next_backoff_ms)
    assertOk(nextBackoffSchema, 'export.result payload must define next_backoff_ms schema')
    deepStrictEqual(nextBackoffSchema, { type: ['number', 'null'], minimum: 0 })

    const payloadConditionals = payloadSchema.allOf
    assertOk(
      Array.isArray(payloadConditionals) && payloadConditionals.length >= 2,
      'export.result payload must define success/failure conditionals',
    )

    const successConditional = payloadConditionals.find(
      (entry) => entry.if?.properties?.status?.const === 'success',
    )
    assertOk(successConditional, 'export.result payload must define success conditional')
    const successThen = successConditional.then
    assertOk(successThen, 'export.result success conditional must define then clause')
    assertOk(
      successThen.required?.includes('artifacts'),
      'export.result success payload must require artifacts array',
    )

    const failureConditional = payloadConditionals.find(
      (entry) => entry.if?.properties?.status?.const === 'failure',
    )
    assertOk(failureConditional, 'export.result payload must define failure conditional')
    const failureThen = failureConditional.then
    assertOk(failureThen, 'export.result failure conditional must define then clause')
    assertOk(failureThen.required, 'export.result failure payload must define required fields')
    deepStrictEqual(
      Array.from(failureThen.required).sort(),
      ['error', 'entries', 'next_backoff_ms'].sort(),
    )
    assertOk(failureThen.properties, 'export.result failure payload must define properties')
    const failureErrorSchema = resolveSchemaRef(failureThen.properties.error)
    assertOk(failureErrorSchema, 'export.result failure payload must define error schema')
    deepStrictEqual(failureErrorSchema.type, 'object')
    assertOk(
      failureErrorSchema.required,
      'export.result failure error schema must define required fields',
    )
    deepStrictEqual(failureErrorSchema.required, ['code', 'message', 'retryable'])
  })

  test('export.result telemetry は export_latency_p95 ガードで latency を監視する', () => {
    const spec = findTelemetrySpec('export.result')
    assertOk(spec, 'export.result telemetry spec is missing')
    assertOk(spec.guardrail, 'export.result telemetry must define guardrail for export latency')
    strictEqual(
      spec.guardrail.metric,
      'export_latency_p95',
      'export.result telemetry must guard export_latency_p95',
    )
    strictEqual(
      spec.guardrail.rollbackTo,
      'A-2',
      'export.result telemetry must rollback export rollout to A-2 on latency breaches',
    )
    assertOk(
      spec.description.includes('export_latency_p95'),
      'export.result telemetry description must document export_latency_p95 guardrail',
    )
    assertOk(
      spec.jsonlFields.includes('payload.duration_ms'),
      'export.result telemetry must emit payload.duration_ms for latency aggregation',
    )
  })

  test('collect-metrics 契約は export_latency_p95 指標を全経路で露出する', () => {
    const { inputRecord, notifications, phaseGates, telemetry } = COLLECT_METRICS_CONTRACT

    strictEqual(
      typeof inputRecord.export_latency_p95,
      'number',
      'input record must define export_latency_p95 metric',
    )

    assertOk(
      notifications.some((notification) => notification.metric === 'export_latency_p95'),
      'notifications must monitor export_latency_p95 breaches',
    )

    assertOk(
      phaseGates.flatMap((phase) => phase.guardrails).some((guard) => guard.metric === 'export_latency_p95'),
      'phase gates must guard export_latency_p95 transitions',
    )

    const exportResult = telemetry.events.find((event) => event.event === 'export.result')
    assertOk(exportResult, 'export.result telemetry spec must exist')
    assertOk(
      exportResult.jsonlFields.includes('payload.summary.export_latency_p95'),
      'export.result telemetry must expose summary.export_latency_p95',
    )
    assertOk(
      exportResult.jsonlFields.includes('payload.summary.export_success_rate'),
      'export.result telemetry must expose summary.export_success_rate',
    )
  })

  test('collect-metrics 契約は ui_saved_rate 欠落を RED で検知し status.autosave guardrail を固定する', () => {
    const { inputRecord, notifications, phaseGates, telemetry } = COLLECT_METRICS_CONTRACT

    assertOk('ui_saved_rate' in inputRecord, 'input record must define ui_saved_rate metric')
    strictEqual(
      typeof inputRecord.ui_saved_rate,
      'number',
      'input record must expose ui_saved_rate as numeric metric',
    )

    const uiSavedNotifications = notifications.filter((notification) => notification.metric === 'ui_saved_rate')
    assertOk(uiSavedNotifications.length >= 1, 'notifications must monitor ui_saved_rate breaches')
    deepStrictEqual(
      Array.from(new Set(uiSavedNotifications.map((notification) => notification.channelType))).sort(),
      ['pagerduty', 'slack'],
      'ui_saved_rate notifications must include slack and pagerduty channels',
    )

    const phaseAGuardsByPhase = phaseGates
      .filter((phase) => phase.phase === 'A-1' || phase.phase === 'A-2')
      .map((phase) => ({
        phase: phase.phase,
        guardrails: phase.guardrails.filter(
          (guard) => guard.metric === 'ui_saved_rate' && guard.comparator === 'gte',
        ),
      }))
    deepStrictEqual(
      phaseAGuardsByPhase.map(({ phase }) => phase).sort(),
      ['A-1', 'A-2'],
      'Phase gates must define Phase A guardrails for ui_saved_rate',
    )
    phaseAGuardsByPhase.forEach(({ phase, guardrails }) => {
      assertOk(guardrails.length >= 1, `Phase ${phase} must guard ui_saved_rate >= threshold`)
    })

    const statusAutosaveSpec = findTelemetrySpec('status.autosave')
    assertOk(statusAutosaveSpec, 'status.autosave telemetry spec must exist')
    assertOk(
      statusAutosaveSpec.description.includes('ui_saved_rate'),
      'status.autosave telemetry description must document ui_saved_rate guardrail',
    )
    strictEqual(
      statusAutosaveSpec.guardrail?.metric,
      'ui_saved_rate',
      'status.autosave telemetry must guard ui_saved_rate breaches',
    )
    strictEqual(
      statusAutosaveSpec.guardrail?.rollbackTo,
      'A-0',
      'status.autosave telemetry must rollback to Phase A-0 on ui_saved_rate breaches',
    )
    assertOk(
      telemetry.events.some((event) => event.event === 'status.autosave' && event.guardrail?.metric === 'ui_saved_rate'),
      'telemetry events must explicitly guard ui_saved_rate for status.autosave',
    )
  })

  test('export guardrail の違反ウィンドウが telemetry.retryPolicy と同期している', () => {
    const exportGuard = COLLECT_METRICS_CONTRACT.phaseGates
      .flatMap((phase) => phase.guardrails)
      .find((guard) => guard.metric === 'export_latency_p95')

    assertOk(exportGuard, 'phase gates must define guardrail for export_latency_p95')

    strictEqual(
      COLLECT_METRICS_CONTRACT.telemetry.retryPolicy.flushWindowMinutes,
      exportGuard.violationWindowMinutes,
      'telemetry retry policy window must align with export guardrail window',
    )
  })
  test('export.result の単一イベント契約に統合し export.started を廃止する', () => {
    const started = findTelemetrySpec('export.started')
    strictEqual(
      started,
      undefined,
      'export.started telemetry spec must be removed from the Collector contract',
    )
  })
  test('export.result payload は artifacts.bytes に実計測したバイト数を設定する', () => {
    const runId = 'run-telemetry'
    const durationMs = 42
    const packageArtifacts = {
      'storyboard.json': JSON.stringify({ title: 'Demo Storyboard', version: 1 }, null, 2),
      'export-info.json': JSON.stringify({ formats: ['markdown', 'csv', 'jsonl'] }, null, 2),
    }
    const actualOutputs: NormalizedOutputs = {
      markdown: '# Demo Storyboard',
      csv: 'id,text\n1,Hello',
      jsonl: '{"id":1,"text":"Hello"}',
      package: packageArtifacts,
    }
    const goldenArtifacts = {
      markdown: actualOutputs.markdown,
      csv: actualOutputs.csv,
      jsonl: actualOutputs.jsonl,
      package: packageArtifacts,
    } satisfies GoldenArtifacts

    const comparison = compareNormalizedOutputs(actualOutputs, goldenArtifacts)
    assertOk(comparison.ok, 'export.result payload expects golden comparison to pass')

    const telemetry = createTelemetryEvent(comparison, runId, { duration_ms: durationMs })
    assertOk(telemetry, 'createTelemetryEvent must return export.result when comparison passes')
    strictEqual(telemetry.event, 'export.result')

    const payload = telemetry.payload as {
      readonly status?: string
      readonly duration_ms?: number
      readonly detail?: { readonly duration_ms: number }
      readonly artifacts?: ReadonlyArray<{
        readonly format: string
        readonly name: string | null
        readonly status: string
        readonly uri: string | null
        readonly normalizedPath: string | null
        readonly durationMs: number | null
        readonly bytes: number | null
      }>
      readonly error?: unknown
    }
    assertOk(payload.artifacts, 'export.result payload must include artifacts')

    const encoder = new TextEncoder()
    const measure = (value: string) => encoder.encode(`${value}\n`).byteLength

    const expectedArtifacts = [
      {
        format: 'markdown',
        name: null,
        status: 'matched',
        uri: null,
        normalizedPath: `runs/${runId}/export/markdown/storyboard.md`,
        durationMs: null,
        bytes: measure(actualOutputs.markdown),
      },
      {
        format: 'csv',
        name: null,
        status: 'matched',
        uri: null,
        normalizedPath: `runs/${runId}/export/csv/storyboard.csv`,
        durationMs: null,
        bytes: measure(actualOutputs.csv),
      },
      {
        format: 'jsonl',
        name: null,
        status: 'matched',
        uri: null,
        normalizedPath: `runs/${runId}/export/jsonl/storyboard.jsonl`,
        durationMs: null,
        bytes: measure(actualOutputs.jsonl),
      },
      {
        format: 'package',
        name: 'storyboard.json',
        status: 'matched',
        uri: null,
        normalizedPath: `runs/${runId}/export/package/storyboard.json`,
        durationMs: null,
        bytes: measure(packageArtifacts['storyboard.json']),
      },
      {
        format: 'package',
        name: 'export-info.json',
        status: 'matched',
        uri: null,
        normalizedPath: `runs/${runId}/export/package/export-info.json`,
        durationMs: null,
        bytes: measure(packageArtifacts['export-info.json']),
      },
    ]

    const actualArtifacts = payload.artifacts.map((artifact) => ({
      format: artifact.format,
      name: artifact.name,
      status: artifact.status,
      uri: artifact.uri,
      normalizedPath: artifact.normalizedPath,
      durationMs: artifact.durationMs,
      bytes: artifact.bytes,
    }))

    deepStrictEqual(actualArtifacts, expectedArtifacts)
    strictEqual(payload.status, 'success')
    strictEqual(payload.duration_ms, durationMs)
    assertOk(payload.detail, 'export.result payload must include detail')
    deepStrictEqual(payload.detail, { duration_ms: durationMs })
    strictEqual(payload.error, undefined)
  })
  test('export.result failure payload は error/entries/backoff を Collector へ送信する', () => {
    const runId = 'run-telemetry-failure'
    const durationMs = 120.4
    const actualOutputs: NormalizedOutputs = {
      markdown: '# Demo Storyboard',
      csv: 'id,text\n1,Hello',
      jsonl: '{"id":1,"text":"Hello"}',
      package: {
        'storyboard.json': JSON.stringify({ title: 'Demo Storyboard', version: 1 }, null, 2),
      },
    }
    const goldenArtifacts = {
      markdown: '# Demo Storyboard',
      csv: 'id,text\n1,Bonjour',
      jsonl: '{"id":1,"text":"Hello"}',
      package: {},
    } satisfies GoldenArtifacts

    const comparison = compareNormalizedOutputs(actualOutputs, goldenArtifacts)
    assertOk(!comparison.ok, 'export.result failure payload expects golden comparison to fail')

    const telemetry = createTelemetryEvent(comparison, runId, { duration_ms: durationMs })
    assertOk(telemetry, 'createTelemetryEvent must return export.result when comparison fails')
    strictEqual(telemetry.event, 'export.result')

    const payload = telemetry.payload as {
      readonly status?: string
      readonly duration_ms?: number
      readonly detail?: { readonly duration_ms: number }
      readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean }
      readonly artifacts?: ReadonlyArray<{ readonly bytes: number | null }>
      readonly entries?: ReadonlyArray<{ readonly format: string; readonly status: string; readonly diff: string | null }>
      readonly next_backoff_ms?: number | null
    }

    strictEqual(payload.status, 'failure')
    strictEqual(payload.duration_ms, Math.round(durationMs))
    assertOk(payload.detail, 'export.result failure payload must include detail')
    deepStrictEqual(payload.detail, { duration_ms: Math.round(durationMs) })
    deepStrictEqual(payload.error, {
      code: 'golden.comparison_failed',
      message: 'Golden comparison failed',
      retryable: false,
    })
    assertOk(payload.entries && payload.entries.length >= 1, 'export.result failure payload must include diff entries')
    const csvEntry = payload.entries.find((entry) => entry.format === 'csv')
    assertOk(csvEntry, 'export.result failure payload must include csv diff entry')
    strictEqual(csvEntry.status, 'diff')
    assertOk(typeof csvEntry.diff === 'string' || csvEntry.diff === null)
    assertOk(payload.artifacts, 'export.result failure payload must include artifacts')
    for (const artifact of payload.artifacts) {
      assertOk('bytes' in artifact, 'export.result failure artifact must expose bytes')
    }
    assertOk(typeof payload.next_backoff_ms === 'number', 'export.result failure payload must include numeric backoff')
  })
  test('error telemetry は retryable/detail.error_code/tags を Collector JSONL へ固定する', () => {
    const spec = findTelemetrySpec('error')
    assertOk(spec, 'error telemetry spec is missing')

    deepStrictEqual(spec.jsonlFields, [
      'feature',
      'component',
      'kind',
      'source',
      'payload.detail.error_code',
      'payload.detail.retryable',
      'payload.tags[]',
    ])

    const thenClause = findConditional(
      (entry) => entry.if?.properties?.event?.const === 'error'
    )

    const payloadSchema = assertPayloadSchema(thenClause, ['detail', 'tags'])
    deepStrictEqual(payloadSchema.type, 'object')
    deepStrictEqual(payloadSchema.additionalProperties, false)

    const kindSchema = resolveSchemaRef(thenClause.properties?.kind)
    assertOk(kindSchema, 'error telemetry must define kind constraint')
    deepStrictEqual(kindSchema, { type: 'string', const: 'error' })

    const componentSchema = resolveSchemaRef(thenClause.properties?.component)
    assertOk(componentSchema, 'error telemetry must constrain component')
    deepStrictEqual(componentSchema?.enum, [
      'autosave',
      'merge',
      'flags',
      'export',
    ])

    const detailSchema = resolveSchemaRef(payloadSchema.properties?.detail)
    assertOk(detailSchema, 'error telemetry must define detail schema')
    deepStrictEqual(detailSchema.type, 'object')
    deepStrictEqual(detailSchema.additionalProperties, false)
    assertOk(detailSchema.required, 'error detail must define required fields')
    deepStrictEqual(detailSchema.required, ['error_code', 'retryable'])
    assertOk(detailSchema.properties, 'error detail must define properties')

    const errorCodeSchema = resolveSchemaRef(detailSchema.properties.error_code)
    assertOk(errorCodeSchema, 'error detail must define error_code schema')
    deepStrictEqual(errorCodeSchema, { type: 'string', minLength: 1 })

    const retryableSchema = resolveSchemaRef(detailSchema.properties.retryable)
    assertOk(retryableSchema, 'error detail must define retryable schema')
    deepStrictEqual(retryableSchema, { type: 'boolean' })

    const messageSchema = resolveSchemaRef(detailSchema.properties.message)
    if (messageSchema) {
      deepStrictEqual(messageSchema, { type: 'string', minLength: 1 })
    }

    const tagsSchema = resolveSchemaRef(payloadSchema.properties?.tags)
    assertOk(tagsSchema, 'error telemetry must define tags schema')
    deepStrictEqual(tagsSchema.type, 'array')
    deepStrictEqual(tagsSchema.minItems, 1)
    const tagItemsSchema = resolveSchemaRef(tagsSchema.items)
    assertOk(tagItemsSchema, 'error telemetry must define tags item schema')
    deepStrictEqual(tagItemsSchema, { type: 'string', minLength: 1 })
  })
  test('export.result failure と plugins.failed telemetry は retry backoff を Collector 契約で固定する', () => {
    const exportResult = findTelemetrySpec('export.result')
    assertOk(exportResult, 'export.result telemetry spec is missing')

    deepStrictEqual(exportResult.jsonlFields, [
      'payload.status',
      'payload.runId',
      'payload.matchRate',
      'payload.formats',
      'payload.duration_ms',
      'payload.detail.duration_ms',
      'payload.summary.export_latency_p95',
      'payload.summary.export_success_rate',
      'payload.artifacts[].format',
      'payload.artifacts[].name',
      'payload.artifacts[].status',
      'payload.artifacts[].normalizedPath',
      'payload.artifacts[].uri',
      'payload.artifacts[].durationMs',
      'payload.artifacts[].bytes',
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
      (entry) => entry.if?.properties?.event?.const === 'export.result'
    )
    const exportPayloadSchema = assertPayloadSchema(exportThen, [
      'status',
      'runId',
      'matchRate',
      'formats',
      'duration_ms',
      'detail',
      'artifacts',
    ])

    assertOk(
      exportPayloadSchema.properties,
      'export.result payload schema must define properties'
    )
    deepStrictEqual(exportPayloadSchema.type, 'object')
    deepStrictEqual(exportPayloadSchema.additionalProperties, false)

    const payloadConditionals = exportPayloadSchema.allOf
    assertOk(Array.isArray(payloadConditionals), 'export.result payload must define conditionals')
    const failureConditional = payloadConditionals?.find(
      (entry) => entry.if?.properties?.status?.const === 'failure'
    )
    assertOk(failureConditional, 'export.result payload must define failure conditional')
    const failureThen = failureConditional.then
    assertOk(failureThen, 'export.result failure conditional must define then clause')
    assertOk(failureThen.required, 'export.result failure conditional must require fields')
    deepStrictEqual(
      Array.from(failureThen.required).sort(),
      ['error', 'entries', 'next_backoff_ms'].sort(),
    )
    assertOk(failureThen.properties, 'export.result failure conditional must define properties')
    const failureBackoffSchema = resolveSchemaRef(failureThen.properties.next_backoff_ms)
    assertOk(failureBackoffSchema, 'export.result failure payload must define next_backoff_ms schema')
    deepStrictEqual(failureBackoffSchema, { type: 'number', minimum: 0 })
    const failureEntriesSchema = resolveSchemaRef(failureThen.properties.entries)
    assertOk(failureEntriesSchema, 'export.result failure payload must define entries schema')
    deepStrictEqual(failureEntriesSchema.type, 'array')
    const failureEntryItems = resolveSchemaRef(failureEntriesSchema.items)
    assertOk(failureEntryItems, 'export.result failure payload entries must define item schema')
    deepStrictEqual(failureEntryItems.type, 'object')
    assertOk(failureEntryItems.required, 'export.result failure payload entry must define required fields')
    deepStrictEqual(
      Array.from(failureEntryItems.required).sort(),
      ['format', 'status'].sort(),
    )

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
