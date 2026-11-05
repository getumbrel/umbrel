// @vitest-environment jsdom

import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import {Plus} from 'lucide-react'
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect, test, vi} from 'vitest'

import {PillButton, wakesPill} from '@/features/files/components/file-viewer/shell/zoom-pill'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key, i18n: {language: 'en'}})}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

test('a pill button shows its icon or what it holds instead, and a toggle says whether it is on', async () => {
	const container = document.createElement('div')
	const root = createRoot(container)
	await act(async () =>
		root.render(
			<TooltipPrimitive.Provider>
				<PillButton icon={Plus} label='Zoom In' />
				<PillButton label='Thick' active>
					<span>A</span>
				</PillButton>
				<PillButton icon={Plus} label='Draw' active={false} />
			</TooltipPrimitive.Provider>,
		),
	)
	const buttons = [...container.querySelectorAll('button')]
	expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual([null, 'true', 'false'])
	expect(buttons.map((button) => button.querySelector('svg') !== null)).toEqual([true, false, true])
	expect(buttons[1].textContent).toBe('A')
	await act(async () => root.unmount())
})

test('a finger anywhere brings a floating pill back; a mouse only near it, and only with no button down', () => {
	const pill = document.createElement('div')
	pill.getBoundingClientRect = () => ({top: 560}) as DOMRect
	const pointer = (pointerType: string, clientY: number, buttons = 0) =>
		({pointerType, clientY, buttons}) as PointerEvent
	expect([
		wakesPill(pointer('touch', 10), pill),
		wakesPill(pointer('mouse', 500), pill),
		wakesPill(pointer('mouse', 400), pill),
		wakesPill(pointer('mouse', 500, 1), pill),
		wakesPill(pointer('mouse', 500), null),
	]).toEqual([true, true, false, false, false])
})
