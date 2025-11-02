import {
  PluginReloadErrorCode,
  type NormalizedPluginManifest,
  type PluginManifest,
  type PluginReloadError,
  type PluginReloadStageName,
} from './types.js';

const MANIFEST_STAGE: PluginReloadStageName = 'manifest-validation';
const ID_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]{0,31}\/)?[a-z0-9][a-z0-9._-]{0,31}$/i;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const CONIMG_API_PATTERN = /^\d+(?:\.x)?$/i;

type ManifestValidationDetail = Record<string, unknown> | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function createManifestError(
  message: string,
  detail: ManifestValidationDetail,
): PluginReloadError {
  return detail
    ? {
        stage: MANIFEST_STAGE,
        code: PluginReloadErrorCode.ManifestInvalid,
        message,
        retryable: false,
        notifyUser: true,
        detail,
      }
    : {
        stage: MANIFEST_STAGE,
        code: PluginReloadErrorCode.ManifestInvalid,
        message,
        retryable: false,
        notifyUser: true,
      };
}

export function normalizePluginManifest(
  manifest: PluginManifest,
): NormalizedPluginManifest {
  const permissions = Array.isArray(manifest.permissions)
    ? manifest.permissions
    : [];
  const hooks = Array.isArray(manifest.hooks) ? manifest.hooks : [];
  return {
    ...manifest,
    permissions: [...permissions],
    hooks: [...hooks],
  };
}

export function validatePluginManifest(
  manifest: PluginManifest,
  normalized: NormalizedPluginManifest = normalizePluginManifest(manifest),
): PluginReloadError | undefined {
  const id = manifest.id;
  if (typeof id !== 'string' || id.trim() === '') {
    return createManifestError('Manifest is missing mandatory fields.', {
      field: 'id',
      issue: 'required',
    });
  }
  if (!ID_PATTERN.test(id.trim())) {
    return createManifestError(
      'Manifest validation failed: invalid plugin identifier.',
      {
        field: 'id',
        issue: 'invalid-format',
        value: id,
      },
    );
  }

  const version = manifest.version;
  if (typeof version !== 'string' || version.trim() === '') {
    return createManifestError('Manifest is missing mandatory fields.', {
      field: 'version',
      issue: 'required',
    });
  }
  if (!SEMVER_PATTERN.test(version.trim())) {
    return createManifestError(
      'Manifest validation failed: version must follow semver (major.minor.patch).',
      {
        field: 'version',
        issue: 'invalid-semver',
        value: version,
      },
    );
  }

  const engines = manifest.engines;
  const vscodeEngine = engines?.vscode;
  if (!engines || typeof vscodeEngine !== 'string' || vscodeEngine.trim() === '') {
    return createManifestError('Manifest is missing mandatory fields.', {
      field: 'engines.vscode',
      issue: 'required',
    });
  }
  if (!SEMVER_PATTERN.test(vscodeEngine.trim())) {
    return createManifestError(
      'Manifest validation failed: engines.vscode must follow semver (major.minor.patch).',
      {
        field: 'engines.vscode',
        issue: 'invalid-semver',
        value: vscodeEngine,
      },
    );
  }

  const conimgApi = manifest['conimg-api'];
  if (typeof conimgApi !== 'string' || conimgApi.trim() === '') {
    return createManifestError('Manifest is missing mandatory fields.', {
      field: 'conimg-api',
      issue: 'required',
    });
  }
  if (!CONIMG_API_PATTERN.test(conimgApi.trim())) {
    return createManifestError(
      'Manifest validation failed: conimg-api must be like "1" or "1.x".',
      {
        field: 'conimg-api',
        issue: 'invalid-format',
        value: conimgApi,
      },
    );
  }

  const permissionsField = manifest.permissions;
  if (permissionsField !== undefined && !Array.isArray(permissionsField)) {
    return createManifestError(
      'Manifest validation failed: permissions must be an array of non-empty strings.',
      {
        field: 'permissions',
        issue: 'invalid-type',
        actual: describeType(permissionsField),
      },
    );
  }

  const invalidPermissionIndex = normalized.permissions.findIndex(
    (permission) => typeof permission !== 'string' || permission.trim() === '',
  );
  if (invalidPermissionIndex !== -1) {
    return createManifestError(
      'Manifest validation failed: permissions must be an array of non-empty strings.',
      {
        field: 'permissions',
        issue: 'invalid-element',
        index: invalidPermissionIndex,
        value: normalized.permissions[invalidPermissionIndex],
      },
    );
  }

  const dependenciesField = manifest.dependencies;
  if (dependenciesField !== undefined) {
    if (!isRecord(dependenciesField)) {
      return createManifestError(
        'Manifest validation failed: dependencies must be an object.',
        {
          field: 'dependencies',
          issue: 'invalid-type',
          actual: describeType(dependenciesField),
        },
      );
    }

    const workspaceField = dependenciesField.workspace;
    if (Array.isArray(workspaceField)) {
      const invalidWorkspaceIndex = workspaceField.findIndex(
        (entry) => typeof entry !== 'string' || entry.trim() === '',
      );
      if (invalidWorkspaceIndex !== -1) {
        return createManifestError(
          'Manifest validation failed: dependencies.workspace must be an array of non-empty strings.',
          {
            field: 'dependencies.workspace',
            issue: 'invalid-element',
            index: invalidWorkspaceIndex,
            value: workspaceField[invalidWorkspaceIndex],
          },
        );
      }
    } else if (workspaceField !== undefined) {
      return createManifestError(
        'Manifest validation failed: dependencies.workspace must be an array of non-empty strings.',
        {
          field: 'dependencies.workspace',
          issue: 'invalid-type',
          actual: describeType(workspaceField),
        },
      );
    }

    const npmField = dependenciesField.npm;
    if (isRecord(npmField)) {
      for (const [packageName, versionRange] of Object.entries(npmField)) {
        if (typeof versionRange !== 'string' || versionRange.trim() === '') {
          return createManifestError(
            'Manifest validation failed: dependencies.npm must be a record of string package versions.',
            {
              field: 'dependencies.npm',
              issue: 'invalid-value',
              package: packageName,
              value: versionRange,
            },
          );
        }
      }
    } else if (npmField !== undefined) {
      return createManifestError(
        'Manifest validation failed: dependencies.npm must be a record of string package versions.',
        {
          field: 'dependencies.npm',
          issue: 'invalid-type',
          actual: describeType(npmField),
        },
      );
    }
  }

  return undefined;
}
