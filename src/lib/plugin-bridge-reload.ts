export type PluginErrorCode = 'E_PLUGIN_MANIFEST_INVALID' | 'E_PLUGIN_VERSION_INCOMPATIBLE' | 'E_PLUGIN_PERMISSION_PENDING' | 'E_PLUGIN_PERMISSION_DENIED' | 'E_PLUGIN_DEP_RESOLVE';
export type ReloadStage = 'manifest:validate' | 'compat:check' | 'permissions:gate' | 'dependencies:cache' | 'hooks:register';
export interface PluginManifest { readonly id: string; readonly name: string; readonly version: string; readonly engines: { readonly vscode: string }; readonly permissions?: readonly string[]; readonly dependencies?: readonly string[]; }
export interface ReloadContext { readonly pluginId: string; readonly bridgeVersion: string; readonly grantedPermissions: readonly string[]; readonly pendingPermissions?: readonly string[]; readonly deniedPermissions?: readonly string[]; readonly cachedDependencies?: readonly string[]; readonly resolvableDependencies?: readonly string[]; }
export interface PluginReloadRequest { readonly type: 'plugins.reload'; readonly requestId: string; readonly attempt: number; readonly manifestHash: string; readonly manifest: PluginManifest; }
export interface PluginReloadComplete { readonly type: 'plugins.reload-complete'; readonly requestId: string; readonly runtimeId: string; readonly snapshotVersion: string; }
export interface PluginReloadError { readonly type: 'plugins.reload-error'; readonly requestId: string; readonly code: PluginErrorCode; readonly retryable: boolean; readonly message: string; }
export type PluginReloadResponse = PluginReloadComplete | PluginReloadError;
export interface PluginBridgeLog { readonly type: 'log'; readonly scope: 'extension:plugin-bridge'; readonly level: 'info' | 'warn' | 'error'; readonly pluginId: string; readonly message: string; readonly retryable?: boolean; readonly tags: Record<string, string>; }
export interface ReloadStageResult { readonly stage: ReloadStage; readonly status: 'ok' | 'failed'; readonly detail: string; readonly code?: PluginErrorCode; readonly retryable?: boolean; }
export interface ReloadOutcome { readonly stages: readonly ReloadStageResult[]; readonly logs: readonly PluginBridgeLog[]; readonly response: PluginReloadResponse; }
export function evaluateReload(request: PluginReloadRequest, context: ReloadContext): ReloadOutcome {
  const stages: ReloadStageResult[] = []; const logs: PluginBridgeLog[] = []; const tags = { extension: 'plugin-bridge', plugin: context.pluginId, request: request.requestId };
  const push = (stage: ReloadStage, status: ReloadStageResult['status'], detail: string, code?: PluginErrorCode, retryable?: boolean) => {
    stages.push({ stage, status, detail, code, retryable }); const level = status === 'failed' ? 'error' : 'info';
    logs.push({ type: 'log', scope: 'extension:plugin-bridge', level, pluginId: context.pluginId, message: detail, retryable, tags: { ...tags, stage, status } });
  };
  const buildError = (code: PluginErrorCode, retryable: boolean, message: string): ReloadOutcome => {
    logs.push({ type: 'log', scope: 'extension:plugin-bridge', level: 'error', pluginId: context.pluginId, message, retryable, tags: { ...tags, result: 'rollback' } });
    return { stages, logs, response: { type: 'plugins.reload-error', requestId: request.requestId, code, retryable, message } };
  };
  const { manifest } = request;
  if (!/^[@a-z0-9_.-]+$/i.test(manifest.id) || !manifest.name || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    push('manifest:validate', 'failed', 'manifest validation failed', 'E_PLUGIN_MANIFEST_INVALID', false); return buildError('E_PLUGIN_MANIFEST_INVALID', false, 'manifest validation failed');
  }
  push('manifest:validate', 'ok', 'manifest validated');
  if (parseMajor(manifest.engines.vscode) !== parseMajor(context.bridgeVersion)) {
    push('compat:check', 'failed', 'engine version incompatible', 'E_PLUGIN_VERSION_INCOMPATIBLE', false); return buildError('E_PLUGIN_VERSION_INCOMPATIBLE', false, 'engine version incompatible');
  }
  push('compat:check', 'ok', 'compatibility accepted');
  const permissions = new Set(manifest.permissions ?? []); const granted = new Set(context.grantedPermissions); const pending = new Set(context.pendingPermissions ?? []); const denied = new Set(context.deniedPermissions ?? []);
  const gated = [...permissions].filter((id) => !granted.has(id));
  if (gated.length > 0) {
    const deniedHit = gated.find((id) => denied.has(id)); const detail = deniedHit ? `permission denied: ${deniedHit}` : `permission pending: ${gated[0]}`;
    const code: PluginErrorCode = deniedHit ? 'E_PLUGIN_PERMISSION_DENIED' : 'E_PLUGIN_PERMISSION_PENDING'; push('permissions:gate', 'failed', detail, code, false); return buildError(code, false, detail);
  }
  push('permissions:gate', 'ok', 'permissions granted');
  const deps = manifest.dependencies ?? []; const cached = new Set(context.cachedDependencies ?? []); const resolvable = new Set(context.resolvableDependencies ?? []);
  const missing = deps.find((dep) => !cached.has(dep) && !resolvable.has(dep));
  if (missing) {
    const detail = `dependency unresolved: ${missing}`; push('dependencies:cache', 'failed', detail, 'E_PLUGIN_DEP_RESOLVE', true); return buildError('E_PLUGIN_DEP_RESOLVE', true, detail);
  }
  push('dependencies:cache', 'ok', 'dependencies cached'); push('hooks:register', 'ok', 'hooks registered');
  logs.push({ type: 'log', scope: 'extension:plugin-bridge', level: 'info', pluginId: context.pluginId, message: 'reload completed', tags: { ...tags, result: 'applied' } });
  const response: PluginReloadComplete = { type: 'plugins.reload-complete', requestId: request.requestId, runtimeId: `${context.pluginId}@${manifest.version}`, snapshotVersion: `${manifest.version}+${request.attempt}` };
  return { stages, logs, response };
}
function parseMajor(version: string): number | null { const match = version.match(/^(\d+)\./); return match ? Number.parseInt(match[1], 10) : null; }
