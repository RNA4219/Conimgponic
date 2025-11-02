import type {
  FlagResolutionEventPayload,
  ResolveOptions,
} from '../../../config/index.js';

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

export type PluginManifestDependencies = Partial<PluginDependencySnapshot> | undefined;

export interface PluginManifest {
  readonly id: string;
  readonly version: string;
  readonly engines: { readonly vscode: string };
  readonly 'conimg-api': string;
  readonly permissions?: readonly string[];
  readonly dependencies?: PluginManifestDependencies;
  readonly hooks?: readonly string[];
}

export type NormalizedPluginManifest = PluginManifest & {
  readonly permissions: readonly string[];
  readonly hooks: readonly string[];
};

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

export type PluginReloadResponse =
  | PluginReloadCompleteResponse
  | PluginReloadErrorResponse;

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

export interface PluginCollectorFlagResolutionEvent {
  readonly kind: 'telemetry';
  readonly feature: 'config.flags';
  readonly event: 'flag_resolution';
  readonly source: 'vscode.plugins';
  readonly phase: 'bootstrap';
  readonly evaluation_ms: number;
  readonly payload: FlagResolutionEventPayload;
  readonly ts: string;
}

export type PluginCollectorEvent =
  | PluginBridgeLogMessage
  | PluginCollectorFlagResolutionEvent;

export interface PluginCollector {
  publish(message: PluginCollectorEvent): void;
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

export interface PluginBridgeBootstrapOptions {
  readonly resolveOptions?: ResolveOptions;
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

export interface PluginDependencyDiff {
  readonly npm: {
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly changed: readonly string[];
  };
  readonly workspace: {
    readonly added: readonly string[];
    readonly removed: readonly string[];
  };
}
