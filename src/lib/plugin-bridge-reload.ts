export type PluginErrorCode =
  | 'E_PLUGIN_MANIFEST_INVALID'
  | 'E_PLUGIN_INCOMPATIBLE'
  | 'E_PLUGIN_PERMISSION_MISMATCH'
  | 'E_PLUGIN_DEPENDENCY_MISMATCH'
  | 'E_PLUGIN_HOOK_REGISTER_FAILED';
export type ReloadStage = 'manifest:validate' | 'compat:check' | 'permissions:gate' | 'dependencies:cache' | 'hooks:register';
export interface PluginManifest { readonly id: string; readonly name: string; readonly version: string; readonly engines: { readonly vscode: string }; readonly 'conimg-api': string; readonly entry?: string; readonly permissions?: readonly string[]; readonly hooks?: readonly string[]; readonly dependencies?: { readonly npm?: Readonly<Record<string, string>>; readonly workspace?: readonly string[] }; }
export interface ReloadContext { readonly pluginId: string; readonly bridgeVersion: string; readonly supportedConimgApi: readonly string[]; readonly grantedPermissions: readonly string[]; readonly pendingPermissions?: readonly string[]; readonly deniedPermissions?: readonly string[]; readonly cachedDependencies?: { readonly npm?: Readonly<Record<string, string>>; readonly workspace?: readonly string[] }; readonly resolvableDependencies?: { readonly npm?: Readonly<Record<string, string>>; readonly workspace?: readonly string[] }; }
export interface PluginReloadRequest { readonly type: 'plugins.reload'; readonly requestId: string; readonly attempt: number; readonly manifestHash: string; readonly manifest: PluginManifest; }
export interface PluginReloadComplete { readonly type: 'plugins.reload-complete'; readonly requestId: string; readonly runtimeId: string; readonly snapshotVersion: string; }
export interface PluginReloadError { readonly type: 'plugins.reload-error'; readonly requestId: string; readonly code: PluginErrorCode; readonly retryable: boolean; readonly notifyUser: boolean; readonly message: string; }
export type PluginReloadResponse = PluginReloadComplete | PluginReloadError;
export interface PluginBridgeLog { readonly type: 'log'; readonly scope: 'extension:plugin-bridge'; readonly level: 'info' | 'warn' | 'error'; readonly pluginId: string; readonly message: string; readonly event: 'stage-start' | 'stage-complete' | 'stage-failed' | 'rollback-executed' | 'reload-complete'; readonly stage?: ReloadStage; readonly retryable?: boolean; readonly notifyUser: boolean; readonly tags: Record<string, string>; }
export interface ReloadStageResult { readonly stage: ReloadStage; readonly status: 'ok' | 'failed'; readonly detail: string; readonly code?: PluginErrorCode; readonly retryable?: boolean; readonly notifyUser?: boolean; }
export interface ReloadOutcome { readonly stages: readonly ReloadStageResult[]; readonly logs: readonly PluginBridgeLog[]; readonly response: PluginReloadResponse; }
export function evaluateReload(request: PluginReloadRequest, context: ReloadContext): ReloadOutcome {
  const stages: ReloadStageResult[] = []; const logs: PluginBridgeLog[] = []; const tags = { extension: 'plugin-bridge', plugin: context.pluginId, request: request.requestId }; const manifest = request.manifest;
  const stageDefs: readonly StageDefinition[] = [
    { stage: 'manifest:validate', retryable: false, rollback: false, exec: () => validateManifest(manifest) },
    { stage: 'compat:check', retryable: false, rollback: false, exec: () => checkCompatibility(manifest, context) },
    { stage: 'permissions:gate', retryable: false, rollback: true, exec: () => gatePermissions(manifest, context) },
    { stage: 'dependencies:cache', retryable: true, rollback: true, exec: () => checkDependencies(manifest, context) },
    { stage: 'hooks:register', retryable: true, rollback: true, exec: () => registerHooks(manifest) }
  ];
  let successes = 0;
  for (const def of stageDefs) {
    logStage(logs, context, tags, def.stage, 'info', 'stage-start', `${def.stage} started`, false);
    const result = def.exec();
    if (!result.ok) {
      stages.push({ stage: def.stage, status: 'failed', detail: result.detail, code: result.code, retryable: def.retryable, notifyUser: result.notifyUser });
      logStage(logs, context, tags, def.stage, 'error', 'stage-failed', result.detail, result.notifyUser, def.retryable, result.code);
      if (def.rollback && successes > 0) logs.push({ type: 'log', scope: 'extension:plugin-bridge', level: 'warn', pluginId: context.pluginId, message: `rollback executed after ${def.stage} failure`, event: 'rollback-executed', stage: def.stage, retryable: def.retryable, notifyUser: result.notifyUser, tags: { ...tags, stage: def.stage, event: 'rollback-executed' } });
      return { stages, logs, response: { type: 'plugins.reload-error', requestId: request.requestId, code: result.code, retryable: def.retryable, notifyUser: result.notifyUser, message: result.detail } };
    }
    stages.push({ stage: def.stage, status: 'ok', detail: result.detail });
    logStage(logs, context, tags, def.stage, 'info', 'stage-complete', result.detail, false);
    successes += 1;
  }
  logs.push({ type: 'log', scope: 'extension:plugin-bridge', level: 'info', pluginId: context.pluginId, message: 'reload completed', event: 'reload-complete', notifyUser: false, tags: { ...tags, result: 'applied' } });
  const response: PluginReloadComplete = { type: 'plugins.reload-complete', requestId: request.requestId, runtimeId: `${context.pluginId}@${manifest.version}`, snapshotVersion: `${manifest.version}+${request.attempt}` };
  return { stages, logs, response };
}
type StageDefinition = { readonly stage: ReloadStage; readonly retryable: boolean; readonly rollback: boolean; readonly exec: () => StageExecutionResult; };
type StageExecutionResult = { readonly ok: true; readonly detail: string } | { readonly ok: false; readonly detail: string; readonly code: PluginErrorCode; readonly notifyUser: boolean };
const ALLOWED_HOOKS = new Set(['onCompile', 'onExport', 'onMerge', 'commands', 'widgets']);
function validateManifest(manifest: PluginManifest): StageExecutionResult {
  if (!/^[@a-z0-9_.-]+$/i.test(manifest.id)) return { ok: false, detail: 'manifest validation failed: invalid id', code: 'E_PLUGIN_MANIFEST_INVALID', notifyUser: false };
  if (!manifest.name || manifest.name.length > 32) return { ok: false, detail: 'manifest validation failed: invalid name', code: 'E_PLUGIN_MANIFEST_INVALID', notifyUser: false };
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) return { ok: false, detail: 'manifest validation failed: invalid version', code: 'E_PLUGIN_MANIFEST_INVALID', notifyUser: false };
  if (!manifest['conimg-api']) return { ok: false, detail: 'manifest validation failed: missing conimg-api', code: 'E_PLUGIN_MANIFEST_INVALID', notifyUser: false };
  return { ok: true, detail: 'manifest validated' };
}
function checkCompatibility(manifest: PluginManifest, context: ReloadContext): StageExecutionResult {
  if (parseMajor(manifest.engines.vscode) !== parseMajor(context.bridgeVersion)) return { ok: false, detail: 'bridge incompatible: vscode engine mismatch', code: 'E_PLUGIN_INCOMPATIBLE', notifyUser: false };
  const apiMajor = manifest['conimg-api'].split('.')[0];
  if (!context.supportedConimgApi.includes(apiMajor)) return { ok: false, detail: `bridge incompatible: unsupported conimg-api ${manifest['conimg-api']}`, code: 'E_PLUGIN_INCOMPATIBLE', notifyUser: false };
  return { ok: true, detail: 'compatibility accepted' };
}
function gatePermissions(manifest: PluginManifest, context: ReloadContext): StageExecutionResult {
  const requested = new Set(manifest.permissions ?? []); if (requested.size === 0) return { ok: true, detail: 'permissions unchanged' };
  const granted = new Set(context.grantedPermissions); const denied = new Set(context.deniedPermissions ?? []); const pending = new Set(context.pendingPermissions ?? []);
  const missing = [...requested].filter((perm) => !granted.has(perm)); if (missing.length === 0) return { ok: true, detail: 'permissions granted' };
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
function logStage(logs: PluginBridgeLog[], context: ReloadContext, baseTags: Record<string, string>, stage: ReloadStage, level: PluginBridgeLog['level'], event: Exclude<PluginBridgeLog['event'], 'reload-complete'>, message: string, notifyUser: boolean, retryable?: boolean, code?: PluginErrorCode): void {
  logs.push({ type: 'log', scope: 'extension:plugin-bridge', level, pluginId: context.pluginId, message, event, stage, retryable, notifyUser, tags: { ...baseTags, stage, event, ...(code ? { code } : {}) } });
}
function parseMajor(version: string): number | null { const match = version.match(/^(\d+)\./); return match ? Number.parseInt(match[1], 10) : null; }
