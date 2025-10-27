import type {
  MergeEngine,
  MergeInput,
  MergePrecision,
  MergeProfileOverrides,
  MergeResult,
  MergeEventHub,
  MergeDecisionListener,
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
  const createEventHub = (): { hub: MergeEventHub; dispose: () => void } => {
    const listeners = new Set<MergeDecisionListener>()
    const cleanup = new Set<() => void>()
    const hub: MergeEventHub = {
      publish(event) {
        listeners.forEach((listener) => listener(event))
      },
      subscribe(listener) {
        listeners.add(listener)
        const unsubscribe = () => {
          if (listeners.delete(listener)) {
            cleanup.delete(unsubscribe)
          }
        }
        cleanup.add(unsubscribe)
        return unsubscribe
      },
    }
    const dispose = () => {
      for (const unsubscribe of [...cleanup]) {
        unsubscribe()
      }
      cleanup.clear()
      listeners.clear()
    }
    return { hub, dispose }
  }
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
      const { hub, dispose } = createEventHub()
      try {
        const result = engine.merge3(mergeInput, { profile, events: hub })
        return {
          type: 'merge.result',
          apiVersion: message.apiVersion,
          reqId: message.reqId,
          ok: true,
          result,
          trace: result.trace,
        }
      } finally {
        dispose()
      }
    },
  }
}
