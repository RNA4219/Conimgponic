import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'

interface HelpModalExport {
  readonly HelpModal?: (props: { readonly onClose: () => void }) => React.ReactElement
}

test('HelpModal はダイアログロールと閉じるボタンを提供する', async () => {
  const module = (await import('../../src/App.tsx')) as HelpModalExport

  assert.equal(typeof module.HelpModal, 'function', 'HelpModal export is required for accessibility checks')

  const { HelpModal } = module

  if (!HelpModal) {
    return
  }

  const element = HelpModal({
    onClose() {}
  })

  assert.equal(element.props.role, 'presentation', 'HelpModal overlay must be presentational')

  const dialogElement = React.Children.toArray(element.props.children).find((child): child is React.ReactElement => {
    return React.isValidElement(child) && child.props.role === 'dialog'
  })

  assert.ok(dialogElement, 'HelpModal must render a dialog element')
  assert.equal(dialogElement.props['aria-modal'], 'true')

  const closeButton = (function findButton(node: React.ReactNode): React.ReactElement | null {
    if (!React.isValidElement(node)) {
      return null
    }
    if (node.type === 'button') {
      return node
    }
    return React.Children.toArray(node.props.children).reduce<React.ReactElement | null>((found, child) => {
      return found ?? findButton(child)
    }, null)
  })(dialogElement.props.children)

  assert.ok(closeButton, 'HelpModal must include a close button')
  assert.ok(closeButton?.props['aria-label'], 'Close button must provide an aria-label')
})
