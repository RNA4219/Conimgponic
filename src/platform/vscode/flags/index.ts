import type { FlagSnapshot, WorkspaceConfiguration } from '../../../config/index.js'
import { resolveFlags } from '../../../config/index.js'
import type { AutoSavePhaseGuardSnapshot } from '../../../lib/autosave'

export interface ResolveWorkspaceFlagsOptions {
  readonly workspace: WorkspaceConfiguration | null
  readonly clock: () => Date
}

export const resolveWorkspaceFlags = ({
  workspace,
  clock
}: ResolveWorkspaceFlagsOptions): FlagSnapshot =>
  resolveFlags({ workspace, clock })

export const deriveAutoSavePhaseGuard = (
  snapshot: FlagSnapshot
): AutoSavePhaseGuardSnapshot => ({
  featureFlag: {
    value: snapshot.autosave.enabled,
    source: snapshot.autosave.source
  },
  optionsDisabled: !snapshot.autosave.enabled
})
