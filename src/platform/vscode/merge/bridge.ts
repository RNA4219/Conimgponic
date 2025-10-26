import type {
  MergeEngine,
  MergeInput,
  MergePrecision,
  MergeProfileOverrides,
  MergeResult,
  MergeTrace,
} from '../../../lib/merge'
import { PRECISION_THRESHOLD_CLAMP } from '../../../lib/merge'

export interface MergeBridgeDependencies {
  readonly engine: MergeEngine
  readonly resolvePrecision: () => MergePrecision
  readonly readThreshold: () => number | undefined
}

export interface MergeRequestPayload extends MergeInput {
  readonly threshold?: number
}

export interface MergeRequestMessage {
  readonly type: 'merge.request'
  readonly apiVersion: number
  readonly reqId: string
  readonly payload: MergeRequestPayload
}

export interface MergeResultMessage {
  readonly type: 'merge.result'
  readonly apiVersion: number
  readonly reqId: string
  readonly ok: boolean
  readonly result?: MergeResult
  readonly trace?: MergeTrace
  readonly error?: { readonly code: string; readonly message: string }
}

export interface MergeBridge {
  readonly handleMergeRequest: (message: MergeRequestMessage) => Promise<MergeResultMessage>
}

const sanitizeThreshold = (
  precision: MergePrecision,
  value: number | undefined,
): number | undefined => {
  if (typeof value !== 'number') {
    return undefined
  }
  if (!Number.isFinite(value)) {
    return undefined
  }
  if (value <= 0) {
    return undefined
  }
  const clampBounds = PRECISION_THRESHOLD_CLAMP[precision]
  let sanitized = value
  if (sanitized < clampBounds.min) {
    sanitized = clampBounds.min
  }
  if (clampBounds.max !== undefined && sanitized > clampBounds.max) {
    sanitized = clampBounds.max
  }
  if (sanitized >= 1) {
    sanitized = clampBounds.max ?? 0.99
  }
  return sanitized
}

export const createVsCodeMergeBridge = (dependencies: MergeBridgeDependencies): MergeBridge => {
  const { engine, resolvePrecision, readThreshold } = dependencies
  return {
    async handleMergeRequest(message) {
      const precision = resolvePrecision()
      const { threshold: requestThreshold, ...rest } = message.payload
      const sanitizedRequest = sanitizeThreshold(precision, requestThreshold)
      const sanitizedFallback =
        sanitizedRequest === undefined
          ? sanitizeThreshold(precision, readThreshold())
          : undefined
      const effectiveThreshold = sanitizedRequest ?? sanitizedFallback
      const profile: MergeProfileOverrides =
        effectiveThreshold !== undefined
          ? { precision, threshold: effectiveThreshold }
          : { precision }
      const mergeInput = rest as MergeInput
      const result = engine.merge3(mergeInput, { profile })
      return {
        type: 'merge.result',
        apiVersion: message.apiVersion,
        reqId: message.reqId,
        ok: true,
        result,
        trace: result.trace,
      }
    },
  }
}
