// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect, test, vi} from 'vitest'

import {useBreakpoint} from './tw'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

test('the breakpoint follows the window, read once per resize however many ask', async () => {
	let width = 1440
	const read = vi.fn(() => width)
	Object.defineProperty(window, 'innerWidth', {configurable: true, get: read})
	const seen: string[][] = [[], []]
	const Probe = ({index}: {index: number}) => {
		seen[index].push(useBreakpoint())
		return null
	}
	const root = createRoot(document.createElement('div'))
	await act(async () =>
		root.render(
			<>
				<Probe index={0} />
				<Probe index={1} />
			</>,
		),
	)
	expect(seen).toEqual([['2xl'], ['2xl']])

	const resize = async (to: number) => {
		width = to
		read.mockClear()
		await act(async () => void window.dispatchEvent(new Event('resize')))
	}
	// Each name starts at its width, and anything narrower than the narrowest is still that
	for (const [to, name] of [
		[1399, 'xl'],
		[1280, 'xl'],
		[1279, 'lg'],
		[1024, 'lg'],
		[1023, 'md'],
		[768, 'md'],
		[767, 'sm'],
		[320, 'sm'],
	] as const) {
		await resize(to)
		expect(seen[0].at(-1)).toBe(name)
		expect(seen[1].at(-1)).toBe(name)
		expect(read).toHaveBeenCalledTimes(1)
	}
	// A resize within a breakpoint renders nothing
	const renders = seen[0].length
	await resize(400)
	expect(seen[0]).toHaveLength(renders)
	// Rendering again, with the window as it is, reads nothing
	read.mockClear()
	await act(async () =>
		root.render(
			<>
				<Probe index={0} />
				<Probe index={1} />
				<span />
			</>,
		),
	)
	expect(read).not.toHaveBeenCalled()
	await act(async () => root.unmount())
})
