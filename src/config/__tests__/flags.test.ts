import {
  FEATURE_FLAG_DEFINITIONS,
  FlagValidationError,
  resolveFeatureFlag,
  resolveFlags
} from '../flags'

type StorageStub = Pick<Storage, 'getItem'>

type TestCase = { readonly name: string; readonly run: () => void }

const cases: TestCase[] = []

function test(name: string, run: () => void) {
  cases.push({ name, run })
}

function assertEqual(actual: unknown, expected: unknown, message?: string) {
  if (actual !== expected) {
    throw new Error(
      message ?? `expected ${String(expected)} but received ${String(actual)}`
    )
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message?: string) {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    throw new Error(message ?? `expected ${expectedJson} but received ${actualJson}`)
  }
}

function createStorage(values: Record<string, string | undefined>): StorageStub {
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(values, key)
        ? values[key] ?? null
        : null
    }
  }
}

test('env has highest precedence for autosave.enabled', () => {
  const resolution = resolveFeatureFlag('autosave.enabled', {
    env: { [FEATURE_FLAG_DEFINITIONS['autosave.enabled'].envKey]: 'TRUE' }
  })

  assertEqual(resolution.value, true)
  assertEqual(resolution.source, 'env')
  assertDeepEqual(resolution.errors, [])
})

test('invalid env falls back to storage and records validation error', () => {
  const storage = createStorage({
    [FEATURE_FLAG_DEFINITIONS['autosave.enabled'].storageKey]: '0'
  })

  const resolution = resolveFeatureFlag('autosave.enabled', {
    env: { [FEATURE_FLAG_DEFINITIONS['autosave.enabled'].envKey]: 'MAYBE' },
    storage
  })

  assertEqual(resolution.value, false)
  assertEqual(resolution.source, 'localStorage')
  assertEqual(resolution.errors.length, 1)
  const [error] = resolution.errors as readonly FlagValidationError[]
  assertEqual(error.code, 'invalid-boolean')
  assertEqual(error.source, 'env')
})

test('merge precision aggregates errors and uses defaults when necessary', () => {
  const storage = createStorage({ 'flag:merge.precision': 'GAMMA' })
  const resolution = resolveFeatureFlag('merge.precision', {
    env: { [FEATURE_FLAG_DEFINITIONS['merge.precision'].envKey]: 'ALPHA' },
    storage
  })

  assertEqual(resolution.value, 'legacy')
  assertEqual(resolution.source, 'default')
  assertEqual(resolution.errors.length, 2)
  const codes = resolution.errors.map((error) => error.code)
  assertDeepEqual(codes, ['invalid-precision', 'invalid-precision'])
})

test('resolveFlags returns snapshot with injected clock timestamp', () => {
  const resolution = resolveFlags({
    env: {
      [FEATURE_FLAG_DEFINITIONS['autosave.enabled'].envKey]: 'true',
      [FEATURE_FLAG_DEFINITIONS['merge.precision'].envKey]: 'BETA'
    },
    clock: () => new Date('2024-01-02T03:04:05.000Z')
  })

  assertEqual(resolution.autosave.enabled, true)
  assertEqual(resolution.merge.precision, 'beta')
  assertEqual(resolution.updatedAt, '2024-01-02T03:04:05.000Z')
})

test('legacy storage keys are checked when modern key is absent', () => {
  const storage = createStorage({ 'flag:autoSave.enabled': '1' })
  const resolution = resolveFeatureFlag('autosave.enabled', { storage })

  assertEqual(resolution.value, true)
  assertEqual(resolution.source, 'localStorage')
})

for (const { name, run } of cases) {
  try {
    run()
    console.log(`✓ ${name}`)
  } catch (error) {
    console.error(`✗ ${name}`)
    throw error
  }
}
