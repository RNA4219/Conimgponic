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
import { MergeError, PRECISION_THRESHOLD_CLAMP, attachAutoSaveLockEvents } from '../../../lib/merge'
import { publishMergeResult } from '../../../telemetry/day8Collector.js'

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
    const autoSaveLeaseStages = new Map<string, 'acquired' | 'released'>()
    const hub: MergeEventHub = {
      publish(event) {
        if (event.type === 'merge:autosave:lock') {
          const previousStage = autoSaveLeaseStages.get(event.lease.leaseId)
          if (previousStage === event.stage) {
            return
          }
          autoSaveLeaseStages.set(event.lease.leaseId, event.stage)
        }
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
      autoSaveLeaseStages.clear()
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
      let resolvedPrecision: MergePrecision | undefined
      const resolvePrecisionSafe = (): MergePrecision => {
        if (resolvedPrecision !== undefined) {
          return resolvedPrecision
        }
        let computedPrecision: MergePrecision
        try {
          computedPrecision = engine.resolveProfile(profile).precision
        } catch {
          computedPrecision = profile.precision ?? precision
        }
        resolvedPrecision = computedPrecision
        return computedPrecision
      }
      const { hub, dispose } = createEventHub()
      const detachAutoSaveLock = attachAutoSaveLockEvents(hub)
      const startedAt = Date.now()
      try {
        const result = engine.merge3(mergeInput, { profile, events: hub })
        publishMergeResult({
          precision: resolvePrecisionSafe(),
          processingMs: result.stats.processingMillis,
          conflictSegments: result.stats.conflictDecisions,
          status: result.stats.conflictDecisions === 0 ? 'success' : 'conflict',
          overrides: { reqId: message.reqId, correlationId: message.reqId },
          source: 'app.merge'
        })
        return {
          type: 'merge.result',
          apiVersion: message.apiVersion,
          reqId: message.reqId,
          ok: true,
          result,
          trace: result.trace,
        }
      } catch (error) {
        const processingMs = Math.max(0, Math.round(Date.now() - startedAt))
        const mergeError = error instanceof MergeError ? error : undefined
        publishMergeResult({
          precision: resolvePrecisionSafe(),
          processingMs,
          conflictSegments: 0,
          status: 'error',
          overrides: { reqId: message.reqId, correlationId: message.reqId },
          source: 'app.merge',
          error: {
            code: mergeError?.code ?? 'unknown',
            message:
              mergeError?.message ??
              (error instanceof Error && typeof error.message === 'string'
                ? error.message
                : 'unknown'),
            retryable: mergeError?.retryable ?? false,
          },
        })
        throw error
      } finally {
        detachAutoSaveLock?.()
        dispose()
      }
    },
  }
}
