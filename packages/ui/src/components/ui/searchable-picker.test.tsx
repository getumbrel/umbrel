// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {OnboardingAction, OnboardingFooter} from '@/routes/onboarding/onboarding-footer'

import {Dialog, DialogDescription, DialogScrollableContent, DialogTitle} from './dialog'
import {SearchablePicker} from './searchable-picker'

const {setLanguage} = vi.hoisted(() => ({setLanguage: vi.fn()}))
vi.mock('@/hooks/use-language', () => ({useLanguage: () => ['en', setLanguage]}))

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const items = [
	{value: 'en', label: 'English'},
	{value: 'de', label: 'Deutsch', keywords: ['German']},
	{value: 'fr', label: 'Français', keywords: ['French']},
]

describe('searchable picker', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>
	let onSelect = vi.fn<(value: string) => void>()
	beforeEach(() => {
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		)
		Element.prototype.scrollIntoView = vi.fn()
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
		onSelect = vi.fn()
	})
	afterEach(async () => {
		await act(async () => root.unmount())
		container.remove()
		vi.unstubAllGlobals()
	})
	const input = () => document.querySelector<HTMLInputElement>('[role="combobox"]')!
	const active = () => document.getElementById(input().getAttribute('aria-activedescendant')!)
	const key = async (key: string, extra: KeyboardEventInit = {}) => {
		await act(async () =>
			input().dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true, ...extra})),
		)
	}
	const search = async (text: string) => {
		await act(async () => {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), text)
			input().dispatchEvent(new Event('input', {bubbles: true}))
		})
	}
	const render = async (props: Partial<React.ComponentProps<typeof SearchablePicker>> = {}) => {
		await act(async () =>
			root.render(
				<SearchablePicker items={items} value='en' onSelect={onSelect} placeholder='Search languages' {...props}>
					<button>Choose language</button>
				</SearchablePicker>,
			),
		)
		await act(async () => container.querySelector('button')!.click())
	}

	test('keeps focus in search, distinguishes the saved choice, and selects with arrows and Enter', async () => {
		await render()
		expect(document.activeElement).toBe(input())
		expect(active()?.textContent).toContain('English')
		await key('ArrowDown')
		expect(active()?.textContent).toContain('Deutsch')
		expect(document.querySelector('[aria-selected="true"]')?.textContent).toContain('English')
		await key('Enter')
		expect(onSelect).toHaveBeenCalledWith('de')
		expect(input()).toBeNull()
		// Radix restores focus on the next task after unmounting the popover.
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
		expect(document.activeElement).toBe(container.querySelector('button'))
	})

	test('searches language aliases, clears without losing focus, and resets after dismissal', async () => {
		await render()
		await search('German')
		expect(document.querySelectorAll('[role="option"]')).toHaveLength(1)
		expect(active()?.textContent).toContain('Deutsch')
		await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="cmdk.clear-search"]')!.click())
		expect(input().value).toBe('')
		expect(document.activeElement).toBe(input())
		await search('French')
		await key('Escape')
		await act(async () => container.querySelector('button')!.click())
		expect(input().value).toBe('')
		expect(document.querySelectorAll('[role="option"]')).toHaveLength(3)
	})

	test('Enter and arrow keys do nothing when a search has no results', async () => {
		await render()
		await search('xyzzy')
		await key('ArrowDown')
		await key('ArrowUp')
		await key('Enter')
		expect(onSelect).not.toHaveBeenCalled()
		expect(input()).not.toBeNull()
		expect(input().hasAttribute('aria-activedescendant')).toBe(false)
		expect(document.querySelector('[role="status"]')?.textContent).toBe('no-results-found')
	})

	test('does not select or dismiss while an IME is composing', async () => {
		await render()
		await key('Enter', {isComposing: true})
		await key('Escape', {isComposing: true})
		expect(onSelect).not.toHaveBeenCalled()
		expect(input()).not.toBeNull()
	})

	test('shows a distinct empty collection message and a loading state', async () => {
		await render({items: [], emptyLabel: 'No apps installed'})
		expect(document.querySelector('[role="status"]')?.textContent).toBe('No apps installed')
		await key('Enter')
		expect(onSelect).not.toHaveBeenCalled()
		await key('Escape')
		await render({items: [], loading: true})
		expect(document.querySelector('[role="status"]')?.textContent).toBe('loading')
	})

	test('clicking an option does not reopen a clickable parent row', async () => {
		const onParentClick = vi.fn()
		await act(async () =>
			root.render(
				<div onClick={onParentClick}>
					<SearchablePicker items={items} onSelect={onSelect} placeholder='Search'>
						<button>Choose</button>
					</SearchablePicker>
				</div>,
			),
		)
		await act(async () => container.querySelector('button')!.click())
		await act(async () => document.querySelector<HTMLElement>('[role="option"]')!.click())
		expect(onSelect).toHaveBeenCalledWith('en')
		expect(onParentClick).not.toHaveBeenCalled()
		expect(input()).toBeNull()
	})

	test('allows wheel and touch scrolling in a modal picker, then restores the parent scroll boundary', async () => {
		const onDialogOpenChange = vi.fn()
		await act(async () =>
			root.render(
				<Dialog open onOpenChange={onDialogOpenChange}>
					<DialogScrollableContent>
						<DialogTitle>Users</DialogTitle>
						<DialogDescription>Add app access</DialogDescription>
						<div data-testid='dialog-scroller'>
							<SearchablePicker items={items} onSelect={onSelect} placeholder='Search apps'>
								<button>Add app</button>
							</SearchablePicker>
						</div>
					</DialogScrollableContent>
				</Dialog>,
			),
		)
		const parentScroller = document.querySelector<HTMLElement>('[data-testid="dialog-scroller"]')!
		await act(async () => parentScroller.querySelector('button')!.click())
		const list = document.querySelector<HTMLElement>('[role="listbox"]')!
		// JSDOM has no layout. Give the real scroll-lock code a scrollable viewport.
		for (const element of [list, parentScroller]) {
			element.style.overflowY = 'auto'
			Object.defineProperties(element, {clientHeight: {value: 200}, scrollHeight: {value: 1200}})
		}
		const wheel = (target: HTMLElement) => {
			const event = new WheelEvent('wheel', {deltaY: 100, bubbles: true, cancelable: true})
			target.dispatchEvent(event)
			return event
		}
		expect(wheel(list).defaultPrevented).toBe(false)
		expect(wheel(document.body).defaultPrevented).toBe(true)

		const touch = (type: string, clientY: number) => {
			const point = {clientX: 100, clientY}
			const event = new Event(type, {bubbles: true, cancelable: true})
			Object.assign(event, {touches: [point], changedTouches: [point]})
			list.dispatchEvent(event)
			return event
		}
		touch('touchstart', 200)
		expect(touch('touchmove', 100).defaultPrevented).toBe(false)
		touch('touchend', 100)

		await key('Escape')
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
		expect(input()).toBeNull()
		expect(onDialogOpenChange).not.toHaveBeenCalled()
		expect(document.activeElement).toBe(parentScroller.querySelector('button'))
		expect(wheel(parentScroller).defaultPrevented).toBe(false)
		expect(wheel(document.body).defaultPrevented).toBe(true)
	})

	test('the custom onboarding trigger opens the language picker and selects a language', async () => {
		await act(async () =>
			root.render(
				<MemoryRouter future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
					<OnboardingFooter action={OnboardingAction.CREATE_ACCOUNT} />
				</MemoryRouter>,
			),
		)
		const trigger = [...container.querySelectorAll('button')].find((button) => button.textContent === 'English')!
		await act(async () => trigger.click())
		expect(input()).not.toBeNull()
		await search('German')
		await key('Enter')
		expect(setLanguage).toHaveBeenCalledWith('de')
	})
})
