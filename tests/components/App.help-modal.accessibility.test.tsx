import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'

import type { KeyboardEvent } from 'react'

describe('HelpModal accessibility', () => {
  it('exposes keyboard activation for dialog dismissal', async () => {
    const module = (await import('../../src/App.tsx')) as {
      readonly HelpModal?: (props: { readonly onClose: () => void }) => React.ReactElement
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

    assert.equal(element.props.role, 'presentation')
    assert.equal(typeof element.props.onClick, 'function')

    const dialogElement = React.Children.toArray(element.props.children).find((child): child is React.ReactElement => {
      return React.isValidElement(child) && child.props.role === 'dialog'
    })

    assert.ok(dialogElement, 'HelpModal must render a dialog element')
    assert.equal(dialogElement.props['aria-modal'], 'true')
    assert.equal(typeof dialogElement.props['aria-labelledby'], 'string')
    assert.equal(dialogElement.props.tabIndex, -1)
    assert.equal(typeof dialogElement.props.onKeyDown, 'function')

    const headingElement = React.Children.toArray(dialogElement.props.children).find((child): child is React.ReactElement => {
      return React.isValidElement(child) && child.type === 'h3'
    })

    assert.ok(headingElement, 'HelpModal dialog must include a heading for labelling')
    assert.equal(dialogElement.props['aria-labelledby'], headingElement?.props.id)

    const closeButton = React.Children.toArray(dialogElement.props.children).find((child): child is React.ReactElement => {
      return React.isValidElement(child) && child.type === 'button'
    })

    assert.ok(closeButton, 'HelpModal dialog must include a close button')
    assert.equal(closeButton?.props.type, 'button')
    assert.equal(typeof closeButton?.props['aria-label'], 'string')
    assert.equal(closeButton?.props.autoFocus, true)
    assert.equal(typeof closeButton?.props.onClick, 'function')

    dialogElement.props.onKeyDown?.({
      key: 'Escape',
      preventDefault: () => {
        prevented += 1
      },
      stopPropagation: () => {
        prevented += 1
      }
    } as unknown as KeyboardEvent<HTMLDivElement>)

    assert.equal(closed, 1)
    assert.equal(prevented, 2)
  })
})
