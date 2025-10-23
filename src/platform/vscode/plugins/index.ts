export type PluginReloadStageName =
  | 'manifest-validation'
  | 'compatibility-check'
  | 'permission-gate'
  | 'dependency-cache'
  | 'hook-registration';

export enum PluginReloadErrorCode {
  ManifestInvalid = 'E_PLUGIN_MANIFEST_INVALID',
  IncompatiblePlatform = 'E_PLUGIN_INCOMPATIBLE',
  PermissionMismatch = 'E_PLUGIN_PERMISSION_MISMATCH',
  DependencyMismatch = 'E_PLUGIN_DEPENDENCY_MISMATCH',
  PhaseGuardBlocked = 'E_PLUGIN_PHASE_BLOCKED',
  HookRegistrationFailed = 'E_PLUGIN_HOOK_REGISTER_FAILED',
}

export interface PluginDependencySnapshot {
  readonly npm: Readonly<Record<string, string>>;
  readonly workspace: readonly string[];
}

type PluginManifestDependencies = Partial<PluginDependencySnapshot> | undefined;

export interface PluginManifest {
  readonly id: string;
  readonly version: string;
  readonly engines: { readonly vscode: string };
  readonly 'conimg-api': string;
  readonly permissions: readonly string[];
  readonly dependencies?: PluginManifestDependencies;
  readonly hooks: readonly string[];
}

export interface PluginReloadRequest {
  readonly kind: 'plugins.reload';
  readonly pluginId: string;
  readonly manifest: PluginManifest;
  readonly grantedPermissions: readonly string[];
  readonly dependencySnapshot: PluginDependencySnapshot;
}

export interface PluginReloadCompleteResponse {
  readonly kind: 'reload-complete';
  readonly pluginId: string;
  readonly manifestVersion: string;
}

export interface PluginReloadError {
  readonly code: PluginReloadErrorCode;
  readonly stage: PluginReloadStageName;
  readonly message: string;
  readonly retryable: boolean;
  readonly notifyUser: boolean;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface PluginReloadErrorResponse {
  readonly kind: 'reload-error';
  readonly pluginId: string;
  readonly error: PluginReloadError;
}

export type PluginReloadResponse = PluginReloadCompleteResponse | PluginReloadErrorResponse;

export interface PluginReloadStageStatus {
  readonly name: PluginReloadStageName;
  readonly status: 'pending' | 'success' | 'failed';
  readonly retryable: boolean;
  readonly error?: PluginReloadError;
}

export interface PluginReloadResult {
  readonly response: PluginReloadResponse;
  readonly stages: readonly PluginReloadStageStatus[];
}

export type PluginBridgeLogEvent =
  | 'stage-start'
  | 'stage-complete'
  | 'stage-failed'
  | 'rollback-executed'
  | 'reload-complete';

export interface PluginBridgeLogMessage {
  readonly kind: 'log';
  readonly tag: 'extension:plugin-bridge';
  readonly pluginId: string;
  readonly level: 'info' | 'warn' | 'error';
  readonly event: PluginBridgeLogEvent;
  readonly stage?: PluginReloadStageName;
  readonly notifyUser: boolean;
  readonly detail?: Record<string, unknown>;
}

export interface PluginCollector {
  publish(message: PluginBridgeLogMessage): void;
}

export interface PluginPhaseGuard {
  ensureReloadAllowed(phase: 'plugins:reload'): boolean;
}

export interface PluginBridgeBackingState {
  readonly manifests: Map<string, PluginManifest>;
  readonly permissions: Map<string, readonly string[]>;
  readonly dependencies: Map<string, PluginDependencySnapshot>;
  readonly hooks: Set<string>;
}

export interface PluginRuntimeSnapshot {
  manifest: PluginManifest;
  permissions: readonly string[];
  dependencies: PluginDependencySnapshot;
  hooksRegistered: boolean;
}

export interface PluginBridgeConfig {
  readonly enableFlag: boolean;
  readonly platformVersion: string;
  readonly conimgApiVersion: string;
  readonly collector: PluginCollector;
  readonly phaseGuard: PluginPhaseGuard;
  readonly state: PluginBridgeBackingState;
}

export interface PluginBridge {
  reload(request: PluginReloadRequest): Promise<PluginReloadResult>;
  getPluginState(pluginId: string): PluginRuntimeSnapshot | undefined;
  getCollectorMessages(): readonly PluginBridgeLogMessage[];
}

type StageSpec = { readonly name: PluginReloadStageName; readonly retryable: boolean };
type StageOutcome = { ok: true } | { ok: false; error: PluginReloadError };

type StageContext = {
  readonly request: PluginReloadRequest;
  readonly config: PluginBridgeConfig;
  readonly previous?: PluginRuntimeSnapshot;
  readonly next: PluginRuntimeSnapshot;
};

const EMPTY_DEPENDENCIES: PluginDependencySnapshot = { npm: {}, workspace: [] };

function normalizeManifestDependencies(dependencies: PluginManifestDependencies): PluginDependencySnapshot {
  return {
    npm: { ...(dependencies?.npm ?? {}) },
    workspace: [...(dependencies?.workspace ?? [])],
  };
}

function cloneDependencySnapshot(snapshot: PluginDependencySnapshot): PluginDependencySnapshot {
  return { npm: { ...snapshot.npm }, workspace: [...snapshot.workspace] };
}

const STAGES: readonly StageSpec[] = [
  { name: 'manifest-validation', retryable: false },
  { name: 'compatibility-check', retryable: false },
  { name: 'permission-gate', retryable: false },
  { name: 'dependency-cache', retryable: true },
  { name: 'hook-registration', retryable: true },
];

const HOOK_ALLOWLIST = new Set<string>(['onCompile', 'onExport', 'onMerge', 'commands', 'widgets']);

export function maybeCreatePluginBridge(config: PluginBridgeConfig): PluginBridge | undefined {
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

  const snapshot = (pluginId: string): PluginRuntimeSnapshot | undefined => {
    const manifest = config.state.manifests.get(pluginId);
    if (!manifest) {
      return undefined;
    }
    const storedDependencies = config.state.dependencies.get(pluginId);
    return {
      manifest,
      permissions: config.state.permissions.get(pluginId) ?? [],
      dependencies: storedDependencies
        ? cloneDependencySnapshot(storedDependencies)
        : cloneDependencySnapshot(EMPTY_DEPENDENCIES),
      hooksRegistered: config.state.hooks.has(pluginId),
    };
  };

  const reload = async (request: PluginReloadRequest): Promise<PluginReloadResult> => {
    if (!config.phaseGuard.ensureReloadAllowed('plugins:reload')) {
      const error = buildError('manifest-validation', PluginReloadErrorCode.PhaseGuardBlocked, 'Reload blocked by phase guard.', false, true);
      publish(logFailure(request.pluginId, 'manifest-validation', error));
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
    const next: PluginRuntimeSnapshot = previous
      ? {
          manifest: previous.manifest,
          permissions: [...previous.permissions],
          dependencies: cloneDependencySnapshot(previous.dependencies),
          hooksRegistered: previous.hooksRegistered,
        }
      : {
          manifest: request.manifest,
          permissions: [...request.grantedPermissions],
          dependencies: cloneDependencySnapshot(request.dependencySnapshot),
          hooksRegistered: false,
        };

    const statuses: PluginReloadStageStatus[] = STAGES.map((spec) => ({
      name: spec.name,
      status: 'pending',
      retryable: spec.retryable,
    }));

    const completed: StageSpec[] = [];

    for (const [index, spec] of STAGES.entries()) {
      publish(logMessage(request.pluginId, 'info', 'stage-start', spec.name));
      const context: StageContext = { request, config, previous, next };
      const outcome = runStage(spec, context);
      if (!outcome.ok) {
        statuses[index] = { name: spec.name, status: 'failed', retryable: spec.retryable, error: outcome.error };
        publish(logFailure(request.pluginId, spec.name, outcome.error));
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
      statuses[index] = { name: spec.name, status: 'success', retryable: spec.retryable };
      publish(logMessage(request.pluginId, 'info', 'stage-complete', spec.name));
      completed.push(spec);
    }

    next.manifest = request.manifest;
    commitSnapshot(config, request.pluginId, next);

    publish(logMessage(request.pluginId, 'info', 'reload-complete'));

    return {
      response: { kind: 'reload-complete', pluginId: request.pluginId, manifestVersion: request.manifest.version },
      stages: statuses,
    };
  };

  const getPluginState = (pluginId: string): PluginRuntimeSnapshot | undefined => snapshot(pluginId);
  const getCollectorMessages = (): readonly PluginBridgeLogMessage[] => [...emittedLogs];

  return { reload, getPluginState, getCollectorMessages };
}

function runStage(spec: StageSpec, context: StageContext): StageOutcome {
  const { request, config } = context;
  switch (spec.name) {
    case 'manifest-validation': {
      const manifest = request.manifest;
      const engines = manifest.engines;
      const vscodeEngine = engines?.vscode;
      const conimgApi = manifest['conimg-api'];
      if (typeof manifest.id !== 'string' || manifest.id.trim() === '') {
        return {
          ok: false,
          error: buildError(spec.name, PluginReloadErrorCode.ManifestInvalid, 'Manifest is missing mandatory fields.', false, true),
        };
      }
      if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
        return {
          ok: false,
          error: buildError(spec.name, PluginReloadErrorCode.ManifestInvalid, 'Manifest is missing mandatory fields.', false, true),
        };
      }
      if (!engines || typeof vscodeEngine !== 'string' || vscodeEngine.trim() === '') {
        return {
          ok: false,
          error: buildError(spec.name, PluginReloadErrorCode.ManifestInvalid, 'Manifest is missing mandatory fields.', false, true),
        };
      }
      if (typeof conimgApi !== 'string' || conimgApi.trim() === '') {
        return {
          ok: false,
          error: buildError(spec.name, PluginReloadErrorCode.ManifestInvalid, 'Manifest is missing mandatory fields.', false, true),
        };
      }
      return { ok: true };
    }
    case 'compatibility-check': {
      const manifest = request.manifest;
      const engineMajor = extractMajor(manifest.engines.vscode);
      const hostMajor = extractMajor(config.platformVersion);
      if (engineMajor === undefined || hostMajor === undefined || engineMajor !== hostMajor) {
        return {
          ok: false,
          error: buildError(
            spec.name,
            PluginReloadErrorCode.IncompatiblePlatform,
            `Plugin requires VS Code engine ${manifest.engines.vscode} but host is ${config.platformVersion}.`,
            false,
            true,
          ),
        };
      }
      if (compareSemver(config.platformVersion, manifest.engines.vscode) < 0) {
        return {
          ok: false,
          error: buildError(
            spec.name,
            PluginReloadErrorCode.IncompatiblePlatform,
            `Plugin requires VS Code engine ${manifest.engines.vscode} but host is ${config.platformVersion}.`,
            false,
            true,
          ),
        };
      }
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
      const required = new Set(request.manifest.permissions);
      const granted = new Set(request.grantedPermissions);
      const missing: string[] = [];
      for (const permission of required) {
        if (!granted.has(permission)) {
          missing.push(permission);
        }
      }
      return missing.length === 0
        ? { ok: true }
        : { ok: false, error: buildError(spec.name, PluginReloadErrorCode.PermissionMismatch, `Missing permissions: ${missing.join(', ')}`, false, true) };
    }
    case 'dependency-cache': {
      const manifestDependencies = normalizeManifestDependencies(request.manifest.dependencies);
      const differences = diffDependencies(manifestDependencies, request.dependencySnapshot);
      if (!dependencyDiffHasChanges(differences)) {
        return { ok: true };
      }
      const formatted = formatDependencyDiff(differences);
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
      if (request.manifest.hooks.length === 0) {
        return {
          ok: false,
          error: buildError(
            spec.name,
            PluginReloadErrorCode.HookRegistrationFailed,
            'No hooks declared by plugin.',
            true,
            false,
          ),
        };
      }

      const invalidHooks = request.manifest.hooks.filter((hook) => !HOOK_ALLOWLIST.has(hook));
      if (invalidHooks.length > 0) {
        return {
          ok: false,
          error: buildError(
            spec.name,
            PluginReloadErrorCode.HookRegistrationFailed,
            `Unsupported hooks declared: ${invalidHooks.join(', ')}`,
            true,
            false,
            { invalidHooks: [...invalidHooks] },
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
  const { request, next } = context;
  switch (spec.name) {
    case 'permission-gate':
      next.permissions = [...request.grantedPermissions];
      break;
    case 'dependency-cache':
      next.dependencies = cloneDependencySnapshot(request.dependencySnapshot);
      break;
    case 'hook-registration':
      next.hooksRegistered = true;
      break;
    default:
      break;
  }
}

function rollbackStage(spec: StageSpec, context: StageContext): PluginBridgeLogMessage | undefined {
  const { request, previous, next } = context;
  switch (spec.name) {
    case 'permission-gate':
      next.permissions = previous?.permissions ?? [];
      return undefined;
    case 'dependency-cache':
      next.dependencies = previous
        ? cloneDependencySnapshot(previous.dependencies)
        : cloneDependencySnapshot(EMPTY_DEPENDENCIES);
      return logMessage(request.pluginId, 'warn', 'rollback-executed', spec.name);
    case 'hook-registration':
      next.hooksRegistered = previous?.hooksRegistered ?? false;
      return undefined;
    default:
      return undefined;
  }
}

function commitSnapshot(config: PluginBridgeConfig, pluginId: string, snapshot: PluginRuntimeSnapshot): void {
  config.state.manifests.set(pluginId, snapshot.manifest);
  config.state.permissions.set(pluginId, [...snapshot.permissions]);
  config.state.dependencies.set(pluginId, cloneDependencySnapshot(snapshot.dependencies));
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
  return detail ? { stage, code, message, retryable, notifyUser, detail } : { stage, code, message, retryable, notifyUser };
}

function logMessage(
  pluginId: string,
  level: 'info' | 'warn' | 'error',
  event: PluginBridgeLogEvent,
  stage?: PluginReloadStageName,
  notifyUser = false,
  detail?: Record<string, unknown>,
): PluginBridgeLogMessage {
  return { kind: 'log', tag: 'extension:plugin-bridge', pluginId, level, event, stage, notifyUser, detail };
}

function logFailure(pluginId: string, stage: PluginReloadStageName, error: PluginReloadError): PluginBridgeLogMessage {
  const detail: Record<string, unknown> = {
    code: error.code,
    retryable: error.retryable,
    reason: error.message,
  };
  if (error.detail) {
    Object.assign(detail, error.detail);
  }
  const level: PluginBridgeLogMessage['level'] = error.retryable ? 'warn' : 'error';
  return logMessage(pluginId, level, 'stage-failed', stage, error.notifyUser, detail);
}

type DependencyDiff = {
  readonly npm: { readonly added: readonly string[]; readonly removed: readonly string[]; readonly changed: readonly string[] };
  readonly workspace: { readonly added: readonly string[]; readonly removed: readonly string[] };
};

function diffDependencies(manifest: PluginDependencySnapshot, snapshot: PluginDependencySnapshot): DependencyDiff {
  const npmAdded: string[] = [];
  const npmRemoved: string[] = [];
  const npmChanged: string[] = [];

  for (const [id, version] of Object.entries(manifest.npm)) {
    const snapshotVersion = snapshot.npm[id];
    if (snapshotVersion === undefined) {
      npmAdded.push(id);
    } else if (snapshotVersion !== version) {
      npmChanged.push(id);
    }
  }

  for (const id of Object.keys(snapshot.npm)) {
    if (!(id in manifest.npm)) {
      npmRemoved.push(id);
    }
  }

  const workspaceAdded: string[] = [];
  const workspaceRemoved: string[] = [];
  const manifestWorkspace = new Set(manifest.workspace);
  const snapshotWorkspace = new Set(snapshot.workspace);
  for (const path of manifestWorkspace) {
    if (!snapshotWorkspace.has(path)) {
      workspaceAdded.push(path);
    }
  }
  for (const path of snapshotWorkspace) {
    if (!manifestWorkspace.has(path)) {
      workspaceRemoved.push(path);
    }
  }

  return {
    npm: { added: npmAdded, removed: npmRemoved, changed: npmChanged },
    workspace: { added: workspaceAdded, removed: workspaceRemoved },
  };
}

function dependencyDiffHasChanges(diff: DependencyDiff): boolean {
  return (
    diff.npm.added.length > 0 ||
    diff.npm.removed.length > 0 ||
    diff.npm.changed.length > 0 ||
    diff.workspace.added.length > 0 ||
    diff.workspace.removed.length > 0
  );
}

function formatDependencyDiff(diff: DependencyDiff): string[] {
  const formatted: string[] = [];
  for (const id of diff.npm.added) {
    formatted.push(`npm:+${id}`);
  }
  for (const id of diff.npm.removed) {
    formatted.push(`npm:-${id}`);
  }
  for (const id of diff.npm.changed) {
    formatted.push(`npm:~${id}`);
  }
  for (const path of diff.workspace.added) {
    formatted.push(`workspace:+${path}`);
  }
  for (const path of diff.workspace.removed) {
    formatted.push(`workspace:-${path}`);
  }
  return formatted;
}

function extractMajor(version: string): number | undefined {
  const match = version.trim().match(/^(\d+)/);
  if (!match) {
    return undefined;
  }
  const major = Number.parseInt(match[1] ?? '', 10);
  return Number.isNaN(major) ? undefined : major;
}

function isConimgApiCompatible(requested: string, supported: string): boolean {
  const requestedMajor = extractMajor(requested);
  const supportedMajor = extractMajor(supported);
  if (requestedMajor === undefined || supportedMajor === undefined || requestedMajor !== supportedMajor) {
    return false;
  }
  if (/\.?(x|\*)$/i.test(requested.trim())) {
    return true;
  }
  return compareSemver(supported, requested) >= 0;
}

function compareSemver(a: string, b: string): number {
  const parse = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10));
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
