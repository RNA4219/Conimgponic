/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';

import { formatTelemetryEvent } from '../../../../src/platform/vscode/autosave/telemetry.js';

test.skip('formatTelemetryEvent decorates status telemetry with guard context', () => {
  const event = formatTelemetryEvent(
    {
      name: 'autosave.status',
      properties: {
        retryCount: 1,
        detail: { retry_count: 1 }
      }
    },
    {
      before: 'dirty',
      after: 'saving',
      guard: { featureFlag: { value: true, source: 'workspace' as const }, optionsDisabled: false },
      lockStrategy: 'web-lock'
    }
  );

  assert.equal(event.properties?.phaseBefore, 'debouncing');
  assert.equal(event.properties?.phaseAfter, 'awaiting-lock');
  assert.equal(event.properties?.guard?.current, 'B-0');
  assert.equal(event.properties?.lockStrategy, 'web-lock');
  assert.equal(event.properties?.detail?.phase, 'awaiting-lock');
});
