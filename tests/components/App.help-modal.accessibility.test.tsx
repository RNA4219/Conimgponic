import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { KeyboardEvent } from 'react'

describe('HelpModal accessibility', () => {
  it('exposes keyboard activation for overlay dismissal', async () => {
    const module = (await import('../../src/App.tsx')) as {
      readonly HelpModal?: (props: { readonly onClose: () => void }) => {
        readonly props: {
          readonly role?: string
          readonly tabIndex?: number
          readonly onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
          readonly onClick?: (event: unknown) => void
        }
      }
    }

    const { HelpModal } = module

    assert.equal(typeof HelpModal, 'function', 'HelpModal export is required for accessibility checks')

    if (!HelpModal) {
      return
    }

    let closed = 0
    let prevented = 0
    const element = HelpModal({
      onClose: () => {
        closed += 1
      }
    })

    assert.equal(element.props.role, 'button')
    assert.equal(element.props.tabIndex, 0)
    assert.equal(typeof element.props.onKeyDown, 'function')

    element.props.onKeyDown?.({
      key: 'Enter',
      preventDefault: () => {
        prevented += 1
      }
    } as unknown as KeyboardEvent<HTMLDivElement>)

    assert.equal(closed, 1)
    assert.equal(prevented, 1)
  })
})
