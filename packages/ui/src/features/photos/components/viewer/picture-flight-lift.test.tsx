// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {usePictureFlight, type LiftTile} from './picture-flight'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
})

afterEach(() => {
	act(() => root.unmount())
	host.remove()
})

// Reduced motion: jsdom has no Web Animations, and what is under test is when
// the tile is emptied and filled, not the flight
function Lightbox({
	open,
	id,
	measured,
	liftTile,
}: {
	open: boolean
	id?: string
	measured: boolean
	liftTile?: LiftTile
}) {
	const flight = usePictureFlight({open, id, reduceMotion: true, liftTile})
	return open && measured ? <div ref={flight.ref} /> : null
}

// What the tile was told, one entry per change: the grid ignores being told
// the same thing twice, and the hook may well say it twice
const told = (liftTile: ReturnType<typeof vi.fn>) =>
	liftTile.mock.calls
		.map(([id]) => id as string | undefined)
		.filter((id, index, all) => index === 0 || id !== all[index - 1])

const render = (props: Parameters<typeof Lightbox>[0]) => act(() => root.render(<Lightbox {...props} />))

describe('usePictureFlight lifting the tile', () => {
	test('the tile empties only once there is a picture to take its place', () => {
		const liftTile = vi.fn()
		render({open: true, id: 'a', measured: false, liftTile})
		expect(liftTile).not.toHaveBeenCalled()
		render({open: true, id: 'a', measured: true, liftTile})
		expect(told(liftTile)).toEqual(['a'])
	})

	test('it follows the item being looked at, and fills again when the lightbox leaves', () => {
		const liftTile = vi.fn()
		render({open: true, id: 'a', measured: true, liftTile})
		render({open: true, id: 'b', measured: true, liftTile})
		render({open: false, measured: true, liftTile})
		expect(told(liftTile)).toEqual(['a', 'b', undefined])
	})

	test('a grid that arrives after the lightbox (a deep link) is told what is up', () => {
		render({open: true, id: 'a', measured: true})
		const liftTile = vi.fn()
		render({open: true, id: 'a', measured: true, liftTile})
		expect(told(liftTile)).toEqual(['a'])
	})

	test('a lightbox torn down while open never leaves a tile empty', () => {
		const liftTile = vi.fn()
		render({open: true, id: 'a', measured: true, liftTile})
		act(() => root.render(null))
		expect(liftTile.mock.calls.at(-1)).toEqual([undefined])
	})
})
