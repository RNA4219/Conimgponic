export type PluginErrorCode =
  | 'E_PLUGIN_MANIFEST_INVALID'
  | 'E_PLUGIN_INCOMPATIBLE'
  | 'E_PLUGIN_PERMISSION_MISMATCH'
  | 'E_PLUGIN_DEPENDENCY_MISMATCH'
  | 'E_PLUGIN_HOOK_REGISTER_FAILED'
  | 'E_PLUGIN_PHASE_BLOCKED';
export type ReloadStage = 'manifest:validate' | 'compat:check' | 'permissions:gate' | 'dependencies:cache' | 'hooks:register';
export interface PluginManifest { readonly id: string; readonly name: string; readonly version: string; readonly engines: { readonly vscode: string }; readonly 'conimg-api': string; readonly entry?: string; readonly permissions?: readonly string[]; readonly hooks?: readonly string[]; readonly dependencies?: { readonly npm?: Readonly<Record<string, string>>; readonly workspace?: readonly string[] }; readonly capabilities?: Readonly<Record<string, boolean>>; readonly telemetry?: { readonly tags?: readonly string[] }; }
export interface ReloadContext { readonly pluginId: string; readonly bridgeVersion: string; readonly supportedConimgApi: readonly string[]; readonly grantedPermissions: readonly string[]; readonly pendingPermissions?: readonly string[]; readonly deniedPermissions?: readonly string[]; readonly cachedDependencies?: { readonly npm?: Readonly<Record<string, string>>; readonly workspace?: readonly string[] }; readonly resolvableDependencies?: { readonly npm?: Readonly<Record<string, string>>; readonly workspace?: readonly string[] }; }
export interface PluginReloadRequest { readonly type: 'plugins.reload'; readonly requestId: string; readonly attempt: number; readonly manifestHash: string; readonly manifest: PluginManifest; }
export interface PluginReloadComplete { readonly type: 'plugins.reload-complete'; readonly requestId: string; readonly runtimeId: string; readonly snapshotVersion: string; }
export interface PluginReloadError { readonly type: 'plugins.reload-error'; readonly requestId: string; readonly code: PluginErrorCode; readonly retryable: boolean; readonly notifyUser: boolean; readonly message: string; }
export type PluginReloadResponse = PluginReloadComplete | PluginReloadError;
export interface PluginBridgeLog { readonly type: 'log'; readonly scope: 'extension:plugin-bridge'; readonly level: 'info' | 'warn' | 'error'; readonly pluginId: string; readonly message: string; readonly event: 'stage-start' | 'stage-complete' | 'stage-failed' | 'rollback-executed' | 'reload-complete'; readonly stage?: ReloadStage; readonly retryable?: boolean; readonly notifyUser: boolean; readonly tags: Record<string, string>; }
export interface ReloadStageResult { readonly stage: ReloadStage; readonly status: 'ok' | 'failed'; readonly detail: string; readonly code?: PluginErrorCode; readonly retryable?: boolean; readonly notifyUser?: boolean; }
export interface ReloadOutcome { readonly stages: readonly ReloadStageResult[]; readonly logs: readonly PluginBridgeLog[]; readonly response: PluginReloadResponse; }
export function evaluateReload(request: PluginReloadRequest, context: ReloadContext): ReloadOutcome {
  const stages: ReloadStageResult[] = []; const logs: PluginBridgeLog[] = []; const baseTags: BaseLogTags = {
    channel: 'extension:plugin-bridge', flow: 'plugins.reload', pluginId: context.pluginId, requestId: request.requestId
  }; const manifest = request.manifest;
  const stageDefs: readonly StageDefinition[] = [
    { stage: 'manifest:validate', retryable: false, rollback: false, exec: () => validateManifest(manifest) },
    { stage: 'compat:check', retryable: false, rollback: false, exec: () => checkCompatibility(manifest, context) },
    { stage: 'permissions:gate', retryable: false, rollback: true, exec: () => gatePermissions(manifest, context) },
    { stage: 'dependencies:cache', retryable: true, rollback: true, exec: () => checkDependencies(manifest, context) },
    { stage: 'hooks:register', retryable: true, rollback: true, exec: () => registerHooks(manifest) }
  ];
  let successes = 0;
  for (const def of stageDefs) {
    logStage(logs, baseTags, def.stage, 'info', 'stage-start', `${def.stage} started`, 'start', false);
    const result = def.exec();
    if (isStageFailure(result)) {
      stages.push({ stage: def.stage, status: 'failed', detail: result.detail, code: result.code, retryable: def.retryable, notifyUser: result.notifyUser });
      logStage(logs, baseTags, def.stage, 'error', 'stage-failed', result.detail, 'failed', result.notifyUser, { retryable: def.retryable, code: result.code });
      if (def.rollback && successes > 0) {
        logRollback(logs, baseTags, def.stage, def.retryable, result.notifyUser);
      }
      return { stages, logs, response: { type: 'plugins.reload-error', requestId: request.requestId, code: result.code, retryable: def.retryable, notifyUser: result.notifyUser, message: result.detail } };
    }
    stages.push({ stage: def.stage, status: 'ok', detail: result.detail });
    logStage(logs, baseTags, def.stage, 'info', 'stage-complete', result.detail, 'complete', false);
    successes += 1;
  }
  logs.push({
    type: 'log', scope: 'extension:plugin-bridge', level: 'info', pluginId: context.pluginId, message: 'reload completed',
    event: 'reload-complete', notifyUser: false, tags: { ...baseTags, event: 'reload-complete', outcome: 'applied' }
  });
  const response: PluginReloadComplete = { type: 'plugins.reload-complete', requestId: request.requestId, runtimeId: `${context.pluginId}@${manifest.version}`, snapshotVersion: `${manifest.version}+${request.attempt}` };
  return { stages, logs, response };
}
type StageDefinition = { readonly stage: ReloadStage; readonly retryable: boolean; readonly rollback: boolean; readonly exec: () => StageExecutionResult; };
type StageSuccessResult = { readonly ok: true; readonly detail: string };
type StageFailureResult = { readonly ok: false; readonly detail: string; readonly code: PluginErrorCode; readonly notifyUser: boolean };
type StageExecutionResult = StageSuccessResult | StageFailureResult;
const ALLOWED_HOOKS = new Set(['onCompile', 'onExport', 'onMerge', 'commands', 'widgets']);
function validateManifest(manifest: PluginManifest): StageExecutionResult {
  if (!/^[@a-z0-9_.-]+$/i.test(manifest.id)) return { ok: false, detail: 'manifest validation failed: invalid id', code: 'E_PLUGIN_MANIFEST_INVALID', notifyUser: false };
  if (!manifest.name || manifest.name.length > 32) return { ok: false, detail: 'manifest validation failed: invalid name', code: 'E_PLUGIN_MANIFEST_INVALID', notifyUser: false };
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) return { ok: false, detail: 'manifest validation failed: invalid version', code: 'E_PLUGIN_MANIFEST_INVALID', notifyUser: false };
  if (!manifest['conimg-api'] || !/^\d+(\.x)?$/.test(manifest['conimg-api'])) return { ok: false, detail: 'manifest validation failed: invalid conimg-api', code: 'E_PLUGIN_MANIFEST_INVALID', notifyUser: false };
  if (manifest.permissions && manifest.permissions.some((perm) => typeof perm !== 'string' || perm.length === 0)) {
    return { ok: false, detail: 'manifest validation failed: invalid permissions', code: 'E_PLUGIN_MANIFEST_INVALID', notifyUser: false };
  }
  if (manifest.hooks && manifest.hooks.some((hook) => typeof hook !== 'string' || hook.length === 0)) {
    return { ok: false, detail: 'manifest validation failed: invalid hooks', code: 'E_PLUGIN_MANIFEST_INVALID', notifyUser: false };
  }
  const deps = manifest.dependencies;
  if (deps) {
    if (deps.npm && Object.values(deps.npm).some((version) => typeof version !== 'string' || version.length === 0)) {
      return { ok: false, detail: 'manifest validation failed: invalid npm dependencies', code: 'E_PLUGIN_MANIFEST_INVALID', notifyUser: false };
    }
    if (deps.workspace && deps.workspace.some((workspace) => typeof workspace !== 'string' || workspace.length === 0)) {
      return { ok: false, detail: 'manifest validation failed: invalid workspace dependencies', code: 'E_PLUGIN_MANIFEST_INVALID', notifyUser: false };
    }
  }
  if (manifest.capabilities && (typeof manifest.capabilities !== 'object' || manifest.capabilities === null)) {
    return { ok: false, detail: 'manifest validation failed: invalid capabilities', code: 'E_PLUGIN_MANIFEST_INVALID', notifyUser: false };
  }
  if (manifest.telemetry) {
    if (typeof manifest.telemetry !== 'object' || manifest.telemetry === null) {
      return { ok: false, detail: 'manifest validation failed: invalid telemetry', code: 'E_PLUGIN_MANIFEST_INVALID', notifyUser: false };
    }
    if (manifest.telemetry.tags && manifest.telemetry.tags.some((tag) => typeof tag !== 'string' || tag.length === 0)) {
      return { ok: false, detail: 'manifest validation failed: invalid telemetry tags', code: 'E_PLUGIN_MANIFEST_INVALID', notifyUser: false };
    }
  }
  return { ok: true, detail: 'manifest validated' };
}
function checkCompatibility(manifest: PluginManifest, context: ReloadContext): StageExecutionResult {
  if (parseMajor(manifest.engines.vscode) !== parseMajor(context.bridgeVersion)) {
    return { ok: false, detail: 'bridge incompatible: vscode engine mismatch', code: 'E_PLUGIN_INCOMPATIBLE', notifyUser: false };
  }
  const requestedMajor = manifest['conimg-api'].split('.')[0];
  const supportedMajors = new Set(context.supportedConimgApi.map((value) => value.split('.')[0]));
  if (!supportedMajors.has(requestedMajor)) {
    return { ok: false, detail: `bridge incompatible: unsupported conimg-api ${manifest['conimg-api']}`, code: 'E_PLUGIN_INCOMPATIBLE', notifyUser: false };
  }
  return { ok: true, detail: 'compatibility accepted' };
}
function gatePermissions(manifest: PluginManifest, context: ReloadContext): StageExecutionResult {
  const requested = new Set(manifest.permissions ?? []); if (requested.size === 0) return { ok: true, detail: 'permissions unchanged' };
  const granted = new Set(context.grantedPermissions); const denied = new Set(context.deniedPermissions ?? []); const pending = new Set(context.pendingPermissions ?? []);
  const missing = Array.from(requested).filter((perm) => !granted.has(perm)); if (missing.length === 0) return { ok: true, detail: 'permissions granted' };
  const deniedHit = missing.find((perm) => denied.has(perm)); if (deniedHit) return { ok: false, detail: `permission denied: ${deniedHit}`, code: 'E_PLUGIN_PERMISSION_MISMATCH', notifyUser: true };
  const pendingHit = missing.find((perm) => pending.has(perm)) ?? missing[0]; return { ok: false, detail: `permission pending: ${pendingHit}`, code: 'E_PLUGIN_PERMISSION_MISMATCH', notifyUser: true };
}
function checkDependencies(manifest: PluginManifest, context: ReloadContext): StageExecutionResult {
  const manifestDeps = manifest.dependencies ?? {}; const manifestNpm = manifestDeps.npm ?? {}; const manifestWorkspace = manifestDeps.workspace ?? [];
  const cached = context.cachedDependencies ?? {}; const resolvable = context.resolvableDependencies ?? {};
  for (const [name, version] of Object.entries(manifestNpm)) { const cachedVersion = cached.npm?.[name]; const resolvableVersion = resolvable.npm?.[name]; if (cachedVersion === version || resolvableVersion === version) continue; return { ok: false, detail: `dependency mismatch: npm:${name}@${version}`, code: 'E_PLUGIN_DEPENDENCY_MISMATCH', notifyUser: false }; }
  const cachedWorkspace = new Set(cached.workspace ?? []); const resolvableWorkspace = new Set(resolvable.workspace ?? []);
  for (const workspace of manifestWorkspace) { if (cachedWorkspace.has(workspace) || resolvableWorkspace.has(workspace)) continue; return { ok: false, detail: `dependency mismatch: workspace:${workspace}`, code: 'E_PLUGIN_DEPENDENCY_MISMATCH', notifyUser: false }; }
  return { ok: true, detail: 'dependencies synchronized' };
}
function registerHooks(manifest: PluginManifest): StageExecutionResult {
  for (const hook of manifest.hooks ?? []) if (!ALLOWED_HOOKS.has(hook)) return { ok: false, detail: `hook registration failed: ${hook}`, code: 'E_PLUGIN_HOOK_REGISTER_FAILED', notifyUser: false };
  return { ok: true, detail: 'hooks registered' };
}
function logStage(
  logs: PluginBridgeLog[], baseTags: BaseLogTags, stage: ReloadStage, level: PluginBridgeLog['level'],
  event: Exclude<PluginBridgeLog['event'], 'reload-complete' | 'rollback-executed'>, message: string,
  outcome: 'start' | 'complete' | 'failed', notifyUser: boolean, meta?: { readonly retryable?: boolean; readonly code?: PluginErrorCode }
): void {
  logs.push({
    type: 'log', scope: 'extension:plugin-bridge', level, pluginId: baseTags.pluginId, message, event, stage,
    retryable: meta?.retryable, notifyUser,
    tags: {
      ...baseTags,
      stage,
      event,
      outcome,
      ...(meta?.code ? { code: meta.code } : {}),
      ...(meta?.retryable !== undefined ? { retryable: String(meta.retryable) } : {})
    }
  });
}
function logRollback(logs: PluginBridgeLog[], baseTags: BaseLogTags, stage: ReloadStage, retryable: boolean, notifyUser: boolean): void {
  logs.push({
    type: 'log', scope: 'extension:plugin-bridge', level: 'warn', pluginId: baseTags.pluginId,
    message: `rollback executed after ${stage} failure`, event: 'rollback-executed', stage, retryable, notifyUser,
    tags: { ...baseTags, stage, event: 'rollback-executed', outcome: 'rollback', retryable: String(retryable) }
  });
}
type BaseLogTags = { readonly channel: 'extension:plugin-bridge'; readonly flow: 'plugins.reload'; readonly pluginId: string; readonly requestId: string };
function parseMajor(version: string): number | null { const match = version.match(/^(\d+)\./); return match ? Number.parseInt(match[1], 10) : null; }
function isStageFailure(result: StageExecutionResult): result is StageFailureResult { return result.ok === false; }
