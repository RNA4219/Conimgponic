import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAutoSaveBootstrapPlan, type ResolveOptions } from '../../src/config'
import { resolveMergeDockIntegration } from '../../src/App'

const WORKSPACE_FLAG_KEY = 'conimg.merge.threshold'

const createWorkspace = (precision: string) => ({
  get(key: string): unknown {
    if (key === WORKSPACE_FLAG_KEY || key === 'merge.threshold') {
      return precision
    }
    return undefined
  }
})

test('App passes merge precision workspace override to MergeDock flags', () => {
  const workspace = createWorkspace('beta')
  const options: ResolveOptions = { workspace }
  const plan = resolveAutoSaveBootstrapPlan(options)

  const integration = resolveMergeDockIntegration(plan, options)

  assert.equal(integration.flags.merge.precision, 'beta')
  assert.equal(integration.flags.merge.source, 'workspace')
  assert.equal(integration.mergeThreshold, plan.snapshot.merge.threshold)
  assert.equal(integration.workspace, workspace)
})
