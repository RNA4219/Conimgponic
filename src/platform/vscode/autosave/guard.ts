import type { AutoSaveEnvelopePhase, AutoSavePhaseGuardSnapshot } from '../../../lib/autosave.js';

import { resolveCollectorPhase } from '../../../lib/autosave/collector-phase.js';

export const resolveSnapshotTelemetryPhase = (
  guard: AutoSavePhaseGuardSnapshot,
  requestedPhase: AutoSaveEnvelopePhase
): AutoSaveEnvelopePhase => {
  if (guard.featureFlag.source === 'localStorage' && guard.featureFlag.value) {
    return resolveCollectorPhase(guard);
  }
  return requestedPhase;
};
