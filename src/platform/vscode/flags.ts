import type { AutoSavePhaseGuardSnapshot } from '../../lib/autosave.js';
import type { FlagSnapshot, WorkspaceConfiguration } from '../../config/index.js';
import { resolveAutoSaveBootstrapPlan } from '../../config/index.js';

export interface ResolveWorkspaceFlagsOptions {
  readonly workspace: WorkspaceConfiguration | null;
  readonly clock: () => Date;
}

export interface AutoSaveBootstrapPayload {
  readonly guard: AutoSavePhaseGuardSnapshot;
  readonly flags: FlagSnapshot;
}

export const resolveWorkspaceBootstrapPayload = ({
  workspace,
  clock
}: ResolveWorkspaceFlagsOptions): AutoSaveBootstrapPayload => {
  const plan = resolveAutoSaveBootstrapPlan({ workspace, clock });
  return {
    guard: plan.guard,
    flags: plan.snapshot
  };
};

export const resolveWorkspaceFlags = (
  options: ResolveWorkspaceFlagsOptions
): FlagSnapshot => resolveWorkspaceBootstrapPayload(options).flags;

export const deriveAutoSavePhaseGuard = (
  snapshot: FlagSnapshot
): AutoSavePhaseGuardSnapshot => ({
  featureFlag: {
    value: snapshot.autosave.enabled,
    source: snapshot.autosave.source
  },
  optionsDisabled: !snapshot.autosave.enabled
});

export const createAutoSaveBootstrapPayload = (
  snapshot: FlagSnapshot,
  guard?: AutoSavePhaseGuardSnapshot
): AutoSaveBootstrapPayload => ({
  guard: guard ?? deriveAutoSavePhaseGuard(snapshot),
  flags: snapshot
});
