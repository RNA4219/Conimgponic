import type { AutoSaveError } from '../../../lib/autosave.js';

const asDomException = (value: unknown): DOMException | undefined => {
  if (typeof DOMException === 'undefined') {
    return undefined;
  }
  return value instanceof DOMException ? (value as DOMException) : undefined;
};

export const createDisabledError = (): AutoSaveError => ({
  name: 'AutoSaveError',
  message: 'AutoSave is disabled by phase guard',
  code: 'disabled',
  retryable: false
});

export const isAutoSaveError = (value: unknown): value is AutoSaveError => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { name?: unknown; code?: unknown; retryable?: unknown };
  if (typeof candidate.code !== 'string' || typeof candidate.retryable !== 'boolean') {
    return false;
  }
  return candidate.name === 'AutoSaveError' || candidate.name === 'Error';
};

export const normalizeAtomicWriteError = (rawError: unknown): AutoSaveError => {
  if (isAutoSaveError(rawError)) {
    return rawError;
  }

  const domException = asDomException(rawError);
  if (domException) {
    const retryable = domException.name !== 'NotAllowedError';
    const context: Record<string, unknown> = {
      origin: 'bridge.atomicWrite',
      kind: 'dom-exception',
      name: domException.name
    };
    if (domException.message) {
      context.message = domException.message;
    }
    return {
      name: 'AutoSaveError',
      message: domException.message,
      code: 'write-failed',
      retryable,
      cause: domException,
      context
    };
  }

  const cause = rawError instanceof Error ? rawError : undefined;
  const message = cause?.message ?? String(rawError);
  const context: Record<string, unknown> = {
    origin: 'bridge.atomicWrite',
    kind: cause ? 'error' : 'unknown'
  };
  if (cause) {
    context.name = cause.name;
  } else if (rawError !== null && typeof rawError === 'object') {
    const constructorName = (rawError as { constructor?: { name?: string } }).constructor?.name;
    if (constructorName) {
      context.constructorName = constructorName;
    }
  } else {
    context.value = rawError;
  }

  return {
    name: 'AutoSaveError',
    message,
    code: 'write-failed',
    retryable: true,
    ...(cause ? { cause } : {}),
    context
  };
};
