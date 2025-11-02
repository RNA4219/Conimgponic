import type {
  AutoSavePhaseGuardSnapshot,
  AutoSaveStatusState
} from '../../../lib/autosave.js';

import type {
  AutoSaveTelemetryEvent,
  AutoSaveTelemetryEventInput,
  AutoSaveTelemetryEventProperties,
  AutoSaveTelemetryLockStrategy
} from './collector.js';
import { encodeGuardTelemetry } from './collector.js';
import { statusPhaseForState } from './state.js';

export interface AutoSaveTelemetryContext {
  readonly before: AutoSaveStatusState;
  readonly after: AutoSaveStatusState;
  readonly guard: AutoSavePhaseGuardSnapshot;
  readonly lockStrategy?: AutoSaveTelemetryLockStrategy;
}

const normalizeDetail = (
  event: AutoSaveTelemetryEventInput,
  phaseAfter: AutoSaveTelemetryEventProperties['phaseAfter']
): AutoSaveTelemetryEventProperties['detail'] | undefined => {
  const rawProperties = event.properties ?? {};
  const providedDetail = rawProperties.detail;
  const detailFromProperties =
    typeof providedDetail === 'object' && providedDetail !== null
      ? { ...(providedDetail as Record<string, unknown>) }
      : undefined;
  const providedRetryCount =
    typeof (rawProperties as { retryCount?: unknown }).retryCount === 'number'
      ? (rawProperties as { retryCount: number }).retryCount
      : undefined;
  const detailRetry =
    detailFromProperties && typeof (detailFromProperties as { retry_count?: unknown }).retry_count === 'number'
      ? (detailFromProperties as { retry_count: number }).retry_count
      : undefined;
  const candidate =
    typeof detailRetry === 'number'
      ? detailRetry
      : typeof providedRetryCount === 'number'
        ? providedRetryCount
        : undefined;
  if (!detailFromProperties && (typeof candidate !== 'number' || Number.isNaN(candidate))) {
    return event.name === 'autosave.status'
      ? ({ phase: phaseAfter } as AutoSaveTelemetryEventProperties['detail'])
      : undefined;
  }
  const detailPayload: Record<string, unknown> = detailFromProperties ? { ...detailFromProperties } : {};
  if (typeof candidate === 'number' && !Number.isNaN(candidate)) {
    detailPayload.retry_count = Math.max(0, Math.trunc(candidate));
  }
  const withPhase = event.name === 'autosave.status'
    ? { ...detailPayload, phase: phaseAfter }
    : detailPayload;
  return Object.keys(withPhase).length > 0
    ? (withPhase as AutoSaveTelemetryEventProperties['detail'])
    : undefined;
};

export const formatTelemetryEvent = (
  event: AutoSaveTelemetryEventInput,
  context: AutoSaveTelemetryContext
): AutoSaveTelemetryEvent => {
  const rawProperties = event.properties ?? {};
  const phaseBefore = statusPhaseForState(context.before);
  const phaseAfter = statusPhaseForState(context.after);
  const guardTelemetry =
    event.name === 'autosave.status' || event.name === 'autosave.guard'
      ? encodeGuardTelemetry(context.guard)
      : undefined;
  const detail = normalizeDetail(event, phaseAfter);
  const phaseStep = event.name === 'autosave.status' ? statusPhaseForState(context.after) : undefined;
  const properties: AutoSaveTelemetryEventProperties = {
    ...rawProperties,
    ...(detail ? { detail } : {}),
    ...(guardTelemetry ? { guard: guardTelemetry } : {}),
    ...(phaseStep ? { phase_step: phaseStep } : {}),
    phaseBefore,
    phaseAfter,
    flagSource: context.guard.featureFlag.source,
    lockStrategy: context.lockStrategy ?? 'none'
  };
  return { ...event, properties };
};
