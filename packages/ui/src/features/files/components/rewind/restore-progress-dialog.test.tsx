// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {RestoreProgressDialog} from './restore-progress-dialog'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
vi.mock('@/providers/global-files', () => ({useGlobalFiles: () => ({operations: []})}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

describe('RestoreProgressDialog', () => {
	let container: HTMLDivElement
	let root: Root
	const onDismiss = vi.fn()

	beforeEach(() => {
		onDismiss.mockClear()
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		)
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(async () => {
		await act(async () => root.unmount())
		container.remove()
		vi.unstubAllGlobals()
	})

	const mount = async (phase: 'running' | 'success' | 'error') => {
		await act(async () => root.render(<RestoreProgressDialog open phase={phase} onDismiss={onDismiss} />))
		await act(async () => {})
	}
	const close = () => document.querySelector<HTMLElement>('[data-close-surface]')
	const escape = () =>
		act(async () => {
			document.activeElement?.dispatchEvent(
				new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}),
			)
		})

	test('a running restore has no way out: it can’t be cancelled', async () => {
		await mount('running')
		expect(close()).toBeNull()
		await escape()
		expect(onDismiss).not.toHaveBeenCalled()
	})

	test('a failed restore stays up with a close, so the message can be read', async () => {
		await mount('error')
		await act(async () => close()!.click())
		expect(onDismiss).toHaveBeenCalledTimes(1)
	})

	test('a failed restore dismisses on Escape too', async () => {
		await mount('error')
		await escape()
		expect(onDismiss).toHaveBeenCalledTimes(1)
	})

	test('a finished restore closes itself', async () => {
		await mount('success')
		expect(close()).toBeNull()
		await escape()
		expect(onDismiss).not.toHaveBeenCalled()
	})
})
