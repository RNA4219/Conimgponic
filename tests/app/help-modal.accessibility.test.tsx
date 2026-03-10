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

  // Find button directly in dialog children
  const dialogChildren = React.Children.toArray(dialogElement.props.children)
  const closeButton = dialogChildren.find((child): child is React.ReactElement => {
    return React.isValidElement(child) && child.type === 'button'
  })

  assert.ok(closeButton, 'HelpModal must include a close button')
  assert.ok(closeButton?.props['aria-label'], 'Close button must provide an aria-label')
})
