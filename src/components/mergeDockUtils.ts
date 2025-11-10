export type PrecisionMode = 'standard'|'high';

export function togglePrecision(mode: PrecisionMode): PrecisionMode {
  return mode === 'standard' ? 'high' : 'standard';
}

export function makeHeartbeatCounter() {
  let count = 0;
  return () => ++count;
}
