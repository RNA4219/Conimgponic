import { describe, it, expect } from 'vitest';
import { togglePrecision, makeHeartbeatCounter } from '../src/components/mergeDockUtils';

describe('MergeDock Utilities', () => {
  it('should toggle precision modes correctly', () => {
    expect(togglePrecision('standard')).toBe('high');
    expect(togglePrecision('high')).toBe('standard');
  });

  it('should increment heartbeat counter', () => {
    const counter = makeHeartbeatCounter();
    expect(counter()).toBe(1);
    expect(counter()).toBe(2);
    expect(counter()).toBe(3);
  });
});
