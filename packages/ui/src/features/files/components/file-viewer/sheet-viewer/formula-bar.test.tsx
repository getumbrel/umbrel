// @vitest-environment jsdom
import {TooltipProvider} from '@radix-ui/react-tooltip'
import {act, type ComponentProps} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, expect, test, vi} from 'vitest'

import {FormulaBar} from './formula-bar'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
afterEach(() => {
	act(() => root?.unmount())
	root = undefined
	document.body.replaceChildren()
})

function mount(value: string, props: Partial<ComponentProps<typeof FormulaBar>> = {}) {
	const container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
	act(() =>
		root!.render(
			<TooltipProvider>
				<FormulaBar
					reference='A10'
					value={value}
					editable
					inputRef={{current: null}}
					onType={() => {}}
					onCommit={() => {}}
					onGo={() => true}
					onExplain={() => {}}
					{...props}
				/>
			</TooltipProvider>,
		),
	)
	return {field: container.querySelector('textarea')!, mark: () => container.querySelector('.lucide-chevron-down')}
}

test('a value of several lines shows its first, marked, and all of them while it has the keyboard', () => {
	const {field, mark} = mount('Line one\nLine two\nLine three')
	// Exactly one line high, so the second's top doesn't show under the first
	expect(field.className).toContain('h-[18px]')
	expect(field.className).toContain('py-0')
	expect(mark()).not.toBeNull()
	act(() => field.focus())
	// Three lines and their padding
	expect(field.style.height).toBe('72px')
	expect(mark()).toBeNull()
	act(() => field.blur())
	expect(field.style.height).toBe('')
})

test('one line stays as it is', () => {
	const {field, mark} = mount('=SUM(B5:B6)')
	expect(mark()).toBeNull()
	act(() => field.focus())
	expect(field.style.height).toBe('')
})

test('a locked cell’s lock says why when it’s pressed, as a tap can’t open its tooltip', () => {
	const explained: string[] = []
	mount('1', {editable: false, lockedReason: 'Locked', onExplain: (reason) => explained.push(reason)})
	const lock = document.querySelector<HTMLButtonElement>('button[aria-label="Locked"]')!
	act(() => lock.click())
	expect(explained).toEqual(['Locked'])
})
