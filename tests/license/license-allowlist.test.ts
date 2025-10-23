import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const verifyModule = (await import('../../scripts/license/verify.js')) as typeof import('../../scripts/license/verify.js')
const { analyzeLicenses, DEFAULT_LICENSE_ALLOWLIST } = verifyModule

describe('license allowlist enforcement (RED)', () => {
  it('fails when a disallowed license appears in the dependency graph', () => {
    const result = analyzeLicenses(
      [
        { name: 'alpha', version: '1.0.0', license: 'MIT' },
        { name: 'beta', version: '2.0.0', license: 'GPL-3.0' },
      ],
      DEFAULT_LICENSE_ALLOWLIST,
    )

    assert.equal(result.ok, false)
    assert.equal(result.retryable, false)
    assert.deepEqual(result.disallowed.map((entry) => entry.license), ['GPL-3.0'])
  })

  it('passes when every dependency license is in the allowlist', () => {
    const result = analyzeLicenses(
      [
        { name: 'alpha', version: '1.0.0', license: 'MIT' },
        { name: 'beta', version: '2.0.0', license: 'BSD-3-Clause' },
        { name: 'gamma', version: '3.1.4', license: 'Apache-2.0' },
      ],
      DEFAULT_LICENSE_ALLOWLIST,
    )

    assert.equal(result.ok, true)
    assert.equal(result.retryable, false)
    assert.deepEqual(result.disallowed, [])
  })
})
