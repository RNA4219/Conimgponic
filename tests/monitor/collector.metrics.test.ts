import { describe, it, expect } from 'node:test';
import { TelemetryJsonlRecordBase, TelemetryEventName, RolloutPhase, MetricsKey } from '../../scripts/monitor/collect-metrics';

describe('TelemetryJsonlRecordBase', () => {
  it('should validate the basic structure of a telemetry record', () => {
    const record: TelemetryJsonlRecordBase = {
      schema: 'vscode.telemetry.v1',
      event: 'status.autosave',
      apiVersion: 1,
      reqId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
      ts: '2025-01-18T00:00:00Z',
      correlationId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
      workspace_id: 'fedcba98-7654-3210-fedc-ba9876543210',
      phase: 'A-0',
      attempt: 1,
      maxAttempts: 3,
      backoffMs: [100, 200, 400],
      payload: {
        state: 'saved',
        debounce_ms: 500,
        latency_ms: 100,
        attempt: 1,
        phase_step: 'idle',
        guard: {
          current: 'A-0',
          rollbackTo: 'A-0',
        },
        detail: {
          retry_count: 0,
        },
        performance: {
          flush_latency_ms: 50,
        },
      },
    };

    expect(record.schema).toBe('vscode.telemetry.v1');
    expect(record.event).toBe('status.autosave');
    expect(record.apiVersion).toBe(1);
    expect(typeof record.reqId).toBe('string');
    expect(typeof record.ts).toBe('string');
    expect(typeof record.correlationId).toBe('string');
    expect(typeof record.workspace_id).toBe('string');
    expect(['A-0', 'A-1', 'A-2', 'B-0', 'B-1', 'C-0']).toContain(record.phase);
    expect(typeof record.attempt).toBe('number');
    expect(typeof record.maxAttempts).toBe('number');
    expect(Array.isArray(record.backoffMs)).toBe(true);
    expect(typeof record.payload).toBe('object');
  });

  it('should validate the autosave.schedule.requested event payload', () => {
    const record: TelemetryJsonlRecordBase = {
      schema: 'vscode.telemetry.v1',
      event: 'autosave.schedule.requested',
      apiVersion: 1,
      reqId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
      ts: '2025-01-18T00:00:00Z',
      correlationId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
      workspace_id: 'fedcba98-7654-3210-fedc-ba9876543210',
      phase: 'A-0',
      attempt: 1,
      maxAttempts: 3,
      backoffMs: [100, 200, 400],
      payload: {
        reason: 'user-action',
        delay_ms: 1000,
      },
    };

    expect(record.event).toBe('autosave.schedule.requested');
    expect(record.payload).toHaveProperty('reason');
    expect(record.payload).toHaveProperty('delay_ms');
    expect(['user-action', 'file-change', 'idle']).toContain(record.payload.reason);
    expect(typeof record.payload.delay_ms).toBe('number');
  });

  it('should validate the autosave.write.completed event payload', () => {
    const record: TelemetryJsonlRecordBase = {
      schema: 'vscode.telemetry.v1',
      event: 'autosave.write.completed',
      apiVersion: 1,
      reqId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
      ts: '2025-01-18T00:00:00Z',
      correlationId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
      workspace_id: 'fedcba98-7654-3210-fedc-ba9876543210',
      phase: 'A-0',
      attempt: 1,
      maxAttempts: 3,
      backoffMs: [100, 200, 400],
      payload: {
        duration_ms: 250,
        bytes_written: 1024,
        file_count: 1,
      },
    };

    expect(record.event).toBe('autosave.write.completed');
    expect(record.payload).toHaveProperty('duration_ms');
    expect(record.payload).toHaveProperty('bytes_written');
    expect(record.payload).toHaveProperty('file_count');
    expect(typeof record.payload.duration_ms).toBe('number');
    expect(typeof record.payload.bytes_written).toBe('number');
    expect(typeof record.payload.file_count).toBe('number');
  });

  it('should validate the autosave.write.failed event payload', () => {
    const record: TelemetryJsonlRecordBase = {
      schema: 'vscode.telemetry.v1',
      event: 'autosave.write.failed',
      apiVersion: 1,
      reqId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
      ts: '2025-01-18T00:00:00Z',
      correlationId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
      workspace_id: 'fedcba98-7654-3210-fedc-ba9876543210',
      phase: 'A-0',
      attempt: 1,
      maxAttempts: 3,
      backoffMs: [100, 200, 400],
      payload: {
        duration_ms: 250,
        error_code: 'EACCES',
        message: 'Permission denied',
        retryable: true,
      },
    };

    expect(record.event).toBe('autosave.write.failed');
    expect(record.payload).toHaveProperty('duration_ms');
    expect(record.payload).toHaveProperty('error_code');
    expect(record.payload).toHaveProperty('message');
    expect(record.payload).toHaveProperty('retryable');
    expect(typeof record.payload.duration_ms).toBe('number');
    expect(typeof record.payload.error_code).toBe('string');
    expect(typeof record.payload.message).toBe('string');
    expect(typeof record.payload.retryable).toBe('boolean');
  });

  it('should validate the merge.precision.suggested event payload', () => {
    const record: TelemetryJsonlRecordBase = {
      schema: 'vscode.telemetry.v1',
      event: 'merge.precision.suggested',
      apiVersion: 1,
      reqId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
      ts: '2025-01-18T00:00:00Z',
      correlationId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
      workspace_id: 'fedcba98-7654-3210-fedc-ba9876543210',
      phase: 'A-0',
      attempt: 1,
      maxAttempts: 3,
      backoffMs: [100, 200, 400],
      payload: {
        precision: 'beta',
        reason: 'heuristic-match',
      },
    };

    expect(record.event).toBe('merge.precision.suggested');
    expect(record.payload).toHaveProperty('precision');
    expect(record.payload).toHaveProperty('reason');
    expect(['legacy', 'beta', 'stable']).toContain(record.payload.precision);
    expect(['heuristic-match', 'user-override', 'default']).toContain(record.payload.reason);
  });

  it('should validate the merge.precision.blocked event payload', () => {
    const record: TelemetryJsonlRecordBase = {
      schema: 'vscode.telemetry.v1',
      event: 'merge.precision.blocked',
      apiVersion: 1,
      reqId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
      ts: '2025-01-18T00:00:00Z',
      correlationId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
      workspace_id: 'fedcba98-7654-3210-fedc-ba9876543210',
      phase: 'A-0',
      attempt: 1,
      maxAttempts: 3,
      backoffMs: [100, 200, 400],
      payload: {
        precision: 'stable',
        reason: 'slo-breach',
        metric: 'merge_auto_success_rate',
        threshold: 0.8,
        observed_value: 0.75,
      },
    };

    expect(record.event).toBe('merge.precision.blocked');
    expect(record.payload).toHaveProperty('precision');
    expect(record.payload).toHaveProperty('reason');
    expect(record.payload).toHaveProperty('metric');
    expect(record.payload).toHaveProperty('threshold');
    expect(record.payload).toHaveProperty('observed_value');
    expect(['legacy', 'beta', 'stable']).toContain(record.payload.precision);
    expect(['slo-breach', 'config-override']).toContain(record.payload.reason);
    expect(['autosave_p95', 'ui_saved_rate', 'restore_success_rate', 'merge_auto_success_rate', 'merge_processing_p95', 'export_latency_p95', 'export_success_rate']).toContain(record.payload.metric);
    expect(typeof record.payload.threshold).toBe('number');
    expect(typeof record.payload.observed_value).toBe('number');
  });
});
