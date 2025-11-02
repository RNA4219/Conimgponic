import {
  type PluginDependencyDiff,
  type PluginDependencySnapshot,
  type PluginManifestDependencies,
} from './types.js';

export const EMPTY_DEPENDENCIES: PluginDependencySnapshot = {
  npm: {},
  workspace: [],
};

export function normalizePluginDependencies(
  dependencies: PluginManifestDependencies,
): PluginDependencySnapshot {
  const npm: Record<string, string> = {};
  const workspace: string[] = [];

  if (dependencies && typeof dependencies === 'object') {
    const npmSource = (dependencies as { npm?: unknown }).npm;
    if (npmSource && typeof npmSource === 'object' && !Array.isArray(npmSource)) {
      for (const [packageName, version] of Object.entries(
        npmSource as Record<string, unknown>,
      )) {
        if (typeof version === 'string') {
          npm[packageName] = version;
        }
      }
    }

    const workspaceSource = (dependencies as { workspace?: unknown }).workspace;
    if (Array.isArray(workspaceSource)) {
      for (const entry of workspaceSource) {
        if (typeof entry === 'string') {
          workspace.push(entry);
        }
      }
    }
  }

  return { npm, workspace };
}

export function clonePluginDependencySnapshot(
  snapshot: PluginDependencySnapshot,
): PluginDependencySnapshot {
  return {
    npm: { ...snapshot.npm },
    workspace: [...snapshot.workspace],
  };
}

export function diffPluginDependencies(
  manifest: PluginDependencySnapshot,
  snapshot: PluginDependencySnapshot,
): PluginDependencyDiff {
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

export function pluginDependencyDiffHasChanges(
  diff: PluginDependencyDiff,
): boolean {
  return (
    diff.npm.added.length > 0 ||
    diff.npm.removed.length > 0 ||
    diff.npm.changed.length > 0 ||
    diff.workspace.added.length > 0 ||
    diff.workspace.removed.length > 0
  );
}

export function formatPluginDependencyDiff(
  diff: PluginDependencyDiff,
): string[] {
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
