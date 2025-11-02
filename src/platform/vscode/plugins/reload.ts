import {
  collectFlagResolutionPayloads,
  resolvePluginBridgeBootstrapPlan,
} from '../../../config/index.js';

import {
  EMPTY_DEPENDENCIES,
  clonePluginDependencySnapshot,
  diffPluginDependencies,
  formatPluginDependencyDiff,
  normalizePluginDependencies,
  pluginDependencyDiffHasChanges,
} from './dependency.js';
import {
  normalizePluginManifest,
  validatePluginManifest,
} from './manifest.js';
import {
  PluginReloadErrorCode,
  type NormalizedPluginManifest,
  type PluginBridge,
  type PluginBridgeBootstrapOptions,
  type PluginBridgeConfig,
  type PluginBridgeLogEvent,
  type PluginBridgeLogMessage,
  type PluginCollectorFlagResolutionEvent,
  type PluginReloadError,
  type PluginReloadRequest,
  type PluginReloadResult,
  type PluginReloadStageName,
  type PluginReloadStageStatus,
  type PluginRuntimeSnapshot,
} from './types.js';

type StageSpec = {
  readonly name: PluginReloadStageName;
  readonly retryable: boolean;
};

type StageOutcome = { ok: true } | { ok: false; error: PluginReloadError };

type StageContext = {
  readonly request: PluginReloadRequest;
  readonly config: PluginBridgeConfig;
  readonly manifest: NormalizedPluginManifest;
  readonly previous?: PluginRuntimeSnapshot;
  readonly next: PluginRuntimeSnapshot;
};

const STAGES: readonly StageSpec[] = [
  { name: 'manifest-validation', retryable: false },
  { name: 'compatibility-check', retryable: false },
  { name: 'permission-gate', retryable: false },
  { name: 'dependency-cache', retryable: true },
  { name: 'hook-registration', retryable: true },
];

const ALLOWED_PLUGIN_HOOKS = new Set<NormalizedPluginManifest['hooks'][number]>([
  'onCompile',
  'onExport',
  'onMerge',
  'commands',
  'widgets',
]);

export function bootstrapPluginBridge(
  options: PluginBridgeBootstrapOptions,
): PluginBridge | undefined {
  const plan = resolvePluginBridgeBootstrapPlan(options.resolveOptions);
  const payloads = collectFlagResolutionPayloads(
    plan.snapshot,
    plan.errors,
    plan.evaluationMs,
  );
  for (const payload of payloads) {
    const telemetryEvent: PluginCollectorFlagResolutionEvent = {
      kind: 'telemetry',
      feature: 'config.flags',
      event: 'flag_resolution',
      source: 'vscode.plugins',
      phase: 'bootstrap',
      evaluation_ms: plan.evaluationMs,
      payload,
      ts: new Date().toISOString(),
    };
    options.collector.publish(telemetryEvent);
  }
  return maybeCreatePluginBridge({
    enableFlag: plan.enableFlag,
    platformVersion: options.platformVersion,
    conimgApiVersion: options.conimgApiVersion,
    collector: options.collector,
    phaseGuard: options.phaseGuard,
    state: options.state,
  });
}

export function maybeCreatePluginBridge(
  config: PluginBridgeConfig,
): PluginBridge | undefined {
  if (!config.enableFlag) {
    return undefined;
  }
  return createPluginBridge(config);
}

function createPluginBridge(config: PluginBridgeConfig): PluginBridge {
  const emittedLogs: PluginBridgeLogMessage[] = [];

  const publish = (message: PluginBridgeLogMessage): void => {
    emittedLogs.push(message);
    config.collector.publish(message);
  };

  const snapshot = (
    pluginId: string,
  ): PluginRuntimeSnapshot | undefined => {
    const manifest = config.state.manifests.get(pluginId);
    if (!manifest) {
      return undefined;
    }
    const storedDependencies = config.state.dependencies.get(pluginId);
    return {
      manifest,
      permissions: config.state.permissions.get(pluginId) ?? [],
      dependencies: storedDependencies
        ? clonePluginDependencySnapshot(storedDependencies)
        : clonePluginDependencySnapshot(EMPTY_DEPENDENCIES),
      hooksRegistered: config.state.hooks.has(pluginId),
    };
  };

  const reload = async (
    request: PluginReloadRequest,
  ): Promise<PluginReloadResult> => {
    if (!config.phaseGuard.ensureReloadAllowed('plugins:reload')) {
      const error = buildError(
        'manifest-validation',
        PluginReloadErrorCode.PhaseGuardBlocked,
        'Reload blocked by phase guard.',
        false,
        true,
      );
      publish(createStageFailureLog(request.pluginId, 'manifest-validation', error));
      return {
        response: { kind: 'reload-error', pluginId: request.pluginId, error },
        stages: [
          { name: 'manifest-validation', status: 'failed', retryable: false, error },
          { name: 'compatibility-check', status: 'pending', retryable: false },
          { name: 'permission-gate', status: 'pending', retryable: false },
          { name: 'dependency-cache', status: 'pending', retryable: true },
          { name: 'hook-registration', status: 'pending', retryable: true },
        ],
      };
    }

    const previous = snapshot(request.pluginId);
    const manifest = normalizePluginManifest(request.manifest);
    const next: PluginRuntimeSnapshot = previous
      ? {
          manifest: previous.manifest,
          permissions: [...previous.permissions],
          dependencies: clonePluginDependencySnapshot(previous.dependencies),
          hooksRegistered: previous.hooksRegistered,
        }
      : {
          manifest,
          permissions: [...request.grantedPermissions],
          dependencies: clonePluginDependencySnapshot(request.dependencySnapshot),
          hooksRegistered: false,
        };

    const statuses: PluginReloadStageStatus[] = STAGES.map((spec) => ({
      name: spec.name,
      status: 'pending',
      retryable: spec.retryable,
    }));

    const completed: StageSpec[] = [];

    for (const [index, spec] of STAGES.entries()) {
      const context: StageContext = {
        request,
        config,
        manifest,
        previous,
        next,
      };
      publish(
        createStageLogMessage(
          request.pluginId,
          'info',
          'stage-start',
          spec.name,
          false,
          stageStartDetail(spec, context),
        ),
      );
      const outcome = runStage(spec, context);
      if (!outcome.ok) {
        statuses[index] = {
          name: spec.name,
          status: 'failed',
          retryable: spec.retryable,
          error: outcome.error,
        };
        publish(createStageFailureLog(request.pluginId, spec.name, outcome.error));
        const failingRollback = rollbackStage(spec, context);
        if (failingRollback) {
          publish(failingRollback);
        }
        for (const completedSpec of completed.slice().reverse()) {
          const rollbackLog = rollbackStage(completedSpec, context);
          if (rollbackLog) {
            publish(rollbackLog);
          }
        }
        return {
          response: { kind: 'reload-error', pluginId: request.pluginId, error: outcome.error },
          stages: statuses,
        };
      }
      applyStage(spec, context);
      statuses[index] = {
        name: spec.name,
        status: 'success',
        retryable: spec.retryable,
      };
      publish(
        createStageLogMessage(
          request.pluginId,
          'info',
          'stage-complete',
          spec.name,
          false,
          stageCompleteDetail(spec, context),
        ),
      );
      completed.push(spec);
    }

    next.manifest = manifest;
    commitSnapshot(config, request.pluginId, next);

    publish(createStageLogMessage(request.pluginId, 'info', 'reload-complete'));

    return {
      response: {
        kind: 'reload-complete',
        pluginId: request.pluginId,
        manifestVersion: request.manifest.version,
      },
      stages: statuses,
    };
  };

  const getPluginState = (
    pluginId: string,
  ): PluginRuntimeSnapshot | undefined => snapshot(pluginId);
  const getCollectorMessages = (): readonly PluginBridgeLogMessage[] =>
    [...emittedLogs];

  return { reload, getPluginState, getCollectorMessages };
}

function runStage(spec: StageSpec, context: StageContext): StageOutcome {
  const { request, config, manifest } = context;
  switch (spec.name) {
    case 'manifest-validation': {
      const error = validatePluginManifest(request.manifest, manifest);
      return error ? { ok: false, error } : { ok: true };
    }
    case 'compatibility-check': {
      if (!isConimgApiCompatible(manifest['conimg-api'], config.conimgApiVersion)) {
        return {
          ok: false,
          error: buildError(
            spec.name,
            PluginReloadErrorCode.IncompatiblePlatform,
            `Plugin requires conimg-api ${manifest['conimg-api']} but host supports ${config.conimgApiVersion}.`,
            false,
            true,
          ),
        };
      }
      return { ok: true };
    }
    case 'permission-gate': {
      const required = new Set(manifest.permissions);
      const granted = new Set(request.grantedPermissions);
      const missing: string[] = [];
      for (const permission of required) {
        if (!granted.has(permission)) {
          missing.push(permission);
        }
      }
      return missing.length === 0
        ? { ok: true }
        : {
            ok: false,
            error: buildError(
              spec.name,
              PluginReloadErrorCode.PermissionMismatch,
              `Missing permissions: ${missing.join(', ')}`,
              false,
              true,
            ),
          };
    }
    case 'dependency-cache': {
      const manifestDependencies = normalizePluginDependencies(manifest.dependencies);
      const differences = diffPluginDependencies(
        manifestDependencies,
        request.dependencySnapshot,
      );
      if (!pluginDependencyDiffHasChanges(differences)) {
        return { ok: true };
      }
      const formatted = formatPluginDependencyDiff(differences);
      const message =
        formatted.length > 0
          ? `Dependency mismatch detected: ${formatted.join(', ')}`
          : 'Dependency mismatch detected.';
      return {
        ok: false,
        error: buildError(
          spec.name,
          PluginReloadErrorCode.DependencyMismatch,
          message,
          true,
          false,
          { diff: differences },
        ),
      };
    }
    case 'hook-registration': {
      if (manifest.hooks.length === 0) {
        return { ok: true };
      }
      const invalidHooks = manifest.hooks.filter(
        (hook) => !ALLOWED_PLUGIN_HOOKS.has(hook),
      );
      if (invalidHooks.length > 0) {
        return {
          ok: false,
          error: buildError(
            spec.name,
            PluginReloadErrorCode.HookRegistrationFailed,
            `Unsupported hooks declared: ${invalidHooks.join(', ')}`,
            true,
            false,
            { invalidHooks },
          ),
        };
      }
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

function applyStage(spec: StageSpec, context: StageContext): void {
  const { request, next, manifest } = context;
  switch (spec.name) {
    case 'permission-gate':
      next.permissions = [...request.grantedPermissions];
      break;
    case 'dependency-cache':
      next.dependencies = clonePluginDependencySnapshot(
        request.dependencySnapshot,
      );
      break;
    case 'hook-registration':
      next.hooksRegistered = manifest.hooks.length > 0;
      break;
    default:
      break;
  }
}

function rollbackStage(
  spec: StageSpec,
  context: StageContext,
): PluginBridgeLogMessage | undefined {
  const { request, previous, next } = context;
  switch (spec.name) {
    case 'permission-gate':
      next.permissions = previous?.permissions ?? [];
      return undefined;
    case 'dependency-cache':
      next.dependencies = previous
        ? clonePluginDependencySnapshot(previous.dependencies)
        : clonePluginDependencySnapshot(EMPTY_DEPENDENCIES);
      return createStageLogMessage(request.pluginId, 'warn', 'rollback-executed', spec.name);
    case 'hook-registration':
      next.hooksRegistered = previous?.hooksRegistered ?? false;
      return undefined;
    default:
      return undefined;
  }
}

function stageStartDetail(
  spec: StageSpec,
  context: StageContext,
): Record<string, unknown> | undefined {
  switch (spec.name) {
    case 'permission-gate':
      return {
        requiredPermissions: [...context.manifest.permissions],
        grantedPermissions: [...context.request.grantedPermissions],
      };
    case 'hook-registration':
      return {
        declaredHooks: [...context.manifest.hooks],
      };
    default:
      return undefined;
  }
}

function stageCompleteDetail(
  spec: StageSpec,
  context: StageContext,
): Record<string, unknown> | undefined {
  switch (spec.name) {
    case 'permission-gate':
      return {
        appliedPermissions: [...context.next.permissions],
      };
    case 'hook-registration':
      return {
        registeredHooks: [...context.manifest.hooks],
        hooksRegistered: context.next.hooksRegistered,
      };
    default:
      return undefined;
  }
}

function commitSnapshot(
  config: PluginBridgeConfig,
  pluginId: string,
  snapshot: PluginRuntimeSnapshot,
): void {
  config.state.manifests.set(pluginId, snapshot.manifest);
  config.state.permissions.set(pluginId, [...snapshot.permissions]);
  config.state.dependencies.set(
    pluginId,
    clonePluginDependencySnapshot(snapshot.dependencies),
  );
  if (snapshot.hooksRegistered) {
    config.state.hooks.add(pluginId);
  } else {
    config.state.hooks.delete(pluginId);
  }
}

function buildError(
  stage: PluginReloadStageName,
  code: PluginReloadErrorCode,
  message: string,
  retryable: boolean,
  notifyUser: boolean,
  detail?: Readonly<Record<string, unknown>>,
): PluginReloadError {
  return detail
    ? { stage, code, message, retryable, notifyUser, detail }
    : { stage, code, message, retryable, notifyUser };
}

function createStageLogMessage(
  pluginId: string,
  level: 'info' | 'warn' | 'error',
  event: PluginBridgeLogEvent,
  stage?: PluginReloadStageName,
  notifyUser = false,
  detail?: Record<string, unknown>,
): PluginBridgeLogMessage {
  return {
    kind: 'log',
    tag: 'extension:plugin-bridge',
    pluginId,
    level,
    event,
    stage,
    notifyUser,
    detail,
  };
}

export function createStageFailureLog(
  pluginId: string,
  stage: PluginReloadStageName,
  error: PluginReloadError,
): PluginBridgeLogMessage {
  const detail: Record<string, unknown> = {
    code: error.code,
    retryable: error.retryable,
    reason: error.message,
  };
  if (error.detail) {
    Object.assign(detail, error.detail);
  }
  const level: PluginBridgeLogMessage['level'] = error.retryable ? 'warn' : 'error';
  return createStageLogMessage(pluginId, level, 'stage-failed', stage, error.notifyUser, detail);
}

function extractMajor(version: string): number | undefined {
  const match = version.trim().match(/^(\d+)/);
  if (!match) {
    return undefined;
  }
  const major = Number.parseInt(match[1] ?? '', 10);
  return Number.isNaN(major) ? undefined : major;
}

function isConimgApiCompatible(
  requested: string,
  supported: string,
): boolean {
  const requestedMajor = extractMajor(requested);
  const supportedMajor = extractMajor(supported);
  if (
    requestedMajor === undefined ||
    supportedMajor === undefined ||
    requestedMajor !== supportedMajor
  ) {
    return false;
  }
  if (/\.?(x|\*)$/i.test(requested.trim())) {
    return true;
  }
  return compareSemver(supported, requested) >= 0;
}

function compareSemver(a: string, b: string): number {
  const parse = (value: string) =>
    value.split('.').map((part) => Number.parseInt(part, 10));
  const aParts = parse(a);
  const bParts = parse(b);
  const length = Math.max(aParts.length, bParts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (aParts[index] ?? 0) - (bParts[index] ?? 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }
  return 0;
}
