import type { ProjectLockLease } from '../locks';
import { projectLockEvents } from '../locks';

import type { MergeDecisionEvent, MergeEventHub } from './types';

interface Day8CollectorLike {
  publish(event: Record<string, unknown>): void;
}

const AUTO_SAVE_LOCK_ATTACHED = Symbol('merge.autosave.lock.attached');
const LAST_COLLECTOR_STAGES = new Map<string, 'acquired' | 'released'>();

const resolveDay8Collector = (): Day8CollectorLike | undefined => {
  const scope = globalThis as { Day8Collector?: unknown };
  const candidate = scope.Day8Collector as { publish?: unknown } | undefined;
  return candidate && typeof candidate.publish === 'function'
    ? (candidate as Day8CollectorLike)
    : undefined;
};

const publishAutoSaveLockCollectorEvent = (
  stage: 'acquired' | 'released',
  lease: ProjectLockLease,
): void => {
  const previousStage = LAST_COLLECTOR_STAGES.get(lease.leaseId);
  if (previousStage === stage) {
    return;
  }
  LAST_COLLECTOR_STAGES.set(lease.leaseId, stage);
  if (stage === 'released') {
    queueMicrotask(() => {
      if (LAST_COLLECTOR_STAGES.get(lease.leaseId) === 'released') {
        LAST_COLLECTOR_STAGES.delete(lease.leaseId);
      }
    });
  }
  const collector = resolveDay8Collector();
  if (!collector) return;
  collector.publish({
    feature: 'merge.autosave',
    event: 'autosave.lock',
    stage,
    lease: {
      id: lease.leaseId,
      owner: lease.ownerId,
      strategy: lease.strategy,
      via_fallback: lease.viaFallback,
      resource: lease.resource,
    },
  });
};

export const attachAutoSaveLockEvents = (
  events?: MergeEventHub,
): (() => void) | undefined => {
  if (!events && !resolveDay8Collector()) {
    return undefined;
  }
  const autoSaveAwareEvents = events as (MergeEventHub & {
    [AUTO_SAVE_LOCK_ATTACHED]?: boolean;
  }) | undefined;
  if (autoSaveAwareEvents?.[AUTO_SAVE_LOCK_ATTACHED]) {
    return undefined;
  }
  if (autoSaveAwareEvents) {
    autoSaveAwareEvents[AUTO_SAVE_LOCK_ATTACHED] = true;
  }
  const leases = new Map<string, ProjectLockLease>();
  const publish = (stage: 'acquired' | 'released', lease: ProjectLockLease): void => {
    events?.publish({ type: 'merge:autosave:lock', stage, lease } satisfies MergeDecisionEvent);
    publishAutoSaveLockCollectorEvent(stage, lease);
  };
  const unsubscribe = projectLockEvents.subscribe((event) => {
    if (event.type === 'lock:acquired') {
      leases.set(event.lease.leaseId, event.lease);
      publish('acquired', event.lease);
      return;
    }
    if (event.type === 'lock:released') {
      const lease = leases.get(event.leaseId);
      if (lease) {
        leases.delete(event.leaseId);
        publish('released', lease);
      }
    }
  });
  return () => {
    leases.clear();
    unsubscribe();
    if (autoSaveAwareEvents) {
      delete autoSaveAwareEvents[AUTO_SAVE_LOCK_ATTACHED];
    }
  };
};

