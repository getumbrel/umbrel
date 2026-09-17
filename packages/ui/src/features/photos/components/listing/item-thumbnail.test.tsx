// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {ItemThumbnail, renditionOnScreen, thumbSizeForTile} from './item-thumbnail'
import {ThumbnailQueue} from './thumbnail-queue'

vi.mock('@/modules/auth/http-url-authorizer', () => ({
	useSharedAuthorizedHttpUrl: (url: string | undefined) => url,
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
	// jsdom has no img.decode; the component awaits it before dropping the
	// coarse layer of an upgrade
	HTMLImageElement.prototype.decode = () => Promise.resolve()
})

afterEach(() => {
	act(() => root.unmount())
	host.remove()
})

const render = (ui: Parameters<Root['render']>[0]) => act(() => root.render(ui))
const imgs = () => [...host.querySelectorAll('img')]
const load = (img: HTMLImageElement) => act(() => void img.dispatchEvent(new Event('load')))

describe('thumbSizeForTile', () => {
	test('the 192 the canvas shares while its short edge covers the tile, the 512 above', () => {
		expect(thumbSizeForTile(48)).toBe(192)
		expect(thumbSizeForTile(128)).toBe(192)
		expect(thumbSizeForTile(192)).toBe(192)
		expect(thumbSizeForTile(193)).toBe(512)
		expect(thumbSizeForTile(800)).toBe(512)
	})
})

describe('renditionOnScreen', () => {
	// jsdom has no CSS.escape; these ids need none
	beforeEach(() => vi.stubGlobal('CSS', {escape: (value: string) => value}))
	afterEach(() => vi.unstubAllGlobals())

	const tile = (size: 192 | 512) => (
		<div data-item-id='a'>
			<ItemThumbnail item={{id: 'a', tint: 0x336699}} size={size} />
		</div>
	)

	test('nothing for an item with no tile, or a tile still waiting on its pixels', () => {
		expect(renditionOnScreen('a')).toBeUndefined()
		render(tile(192))
		expect(renditionOnScreen('a')).toBeUndefined()
	})

	test('the rendition that is painted, through an upgrade and past a step down', async () => {
		render(tile(192))
		load(imgs()[0]!)
		expect(renditionOnScreen('a')).toBe(192)
		// Upgrading: the 192 is still what is on screen until the 512 lands
		render(tile(512))
		expect(renditionOnScreen('a')).toBe(192)
		load(imgs()[1]!)
		expect(renditionOnScreen('a')).toBe(512)
		await act(async () => {})
		// A step down is ignored, so the 512 is still what the tile shows
		render(tile(192))
		expect(renditionOnScreen('a')).toBe(512)
	})
})

describe('ItemThumbnail', () => {
	test('fades the photograph in over the tint once it loads', () => {
		render(<ItemThumbnail item={{id: 'a', tint: 0x336699}} size={512} />)
		const img = imgs()[0]!
		expect(img.src).toContain('s=512')
		expect(img.className).toContain('opacity-0')
		load(img)
		expect(img.className).toContain('opacity-100')
		expect(img.className).toContain('transition-opacity')
	})

	test('a load inside the warm window is shown at once, without the fade', () => {
		render(<ItemThumbnail item={{id: 'a', tint: 0x336699}} size={192} warmUntil={performance.now() + 60_000} />)
		const img = imgs()[0]!
		load(img)
		expect(img.className).toContain('opacity-100')
		expect(img.className).not.toContain('transition-opacity')
	})

	test('a load after the warm window has passed fades as usual', () => {
		render(<ItemThumbnail item={{id: 'a', tint: 0x336699}} size={192} warmUntil={performance.now() - 1} />)
		const img = imgs()[0]!
		load(img)
		expect(img.className).toContain('transition-opacity')
	})

	test('an upgrade keeps the loaded rendition beneath until the finer one arrives', async () => {
		render(<ItemThumbnail item={{id: 'a', tint: 0x336699}} size={192} />)
		const first = imgs()[0]!
		load(first)
		render(<ItemThumbnail item={{id: 'a', tint: 0x336699}} size={512} />)
		expect(imgs()).toHaveLength(2)
		const [coarse, fine] = imgs() as [HTMLImageElement, HTMLImageElement]
		// The very element that was fine a render ago: same node, same pixels
		expect(coarse).toBe(first)
		expect(coarse.src).toContain('s=192')
		expect(coarse.className).not.toContain('opacity-0')
		expect(fine.src).toContain('s=512')
		expect(fine.className).toContain('opacity-0')
		load(fine)
		// A sharpening is instant…
		expect(fine.className).toContain('opacity-100')
		expect(fine.className).not.toContain('transition-opacity')
		// … and once the finer pixels have decoded, the coarse layer goes
		await act(async () => {})
		expect(imgs()).toHaveLength(1)
		expect(imgs()[0]).toBe(fine)
	})

	test('an upgrade before anything loaded simply moves to the finer rendition', () => {
		render(<ItemThumbnail item={{id: 'a', tint: 0x336699}} size={192} />)
		render(<ItemThumbnail item={{id: 'a', tint: 0x336699}} size={512} />)
		expect(imgs()).toHaveLength(1)
		expect(imgs()[0]!.src).toContain('s=512')
	})

	test('a step down is ignored: the finer pixels already here cover it', () => {
		render(<ItemThumbnail item={{id: 'a', tint: 0x336699}} size={512} />)
		const img = imgs()[0]!
		load(img)
		render(<ItemThumbnail item={{id: 'a', tint: 0x336699}} size={192} />)
		expect(imgs()).toHaveLength(1)
		expect(imgs()[0]!.src).toContain('s=512')
	})

	test('the grid gates its src and clears an unfinished request when the tile leaves', async () => {
		const queue = new ThumbnailQueue({capacity: 1})
		const blocker = queue.enqueue(
			() => 0,
			() => {},
		)
		await act(async () => {})

		render(<ItemThumbnail item={{id: 'a', tint: 0x336699}} size={512} requestQueue={queue} requestIndex={1} />)
		await act(async () => {})
		expect(imgs()[0]!.hasAttribute('src')).toBe(false)

		act(() => blocker.settle())
		const img = imgs()[0]!
		expect(img.src).toContain('s=512')

		render(null)
		expect(img.hasAttribute('src')).toBe(false)
	})

	test('a warm canvas handoff bypasses the grid queue', async () => {
		const queue = new ThumbnailQueue({capacity: 1})
		const blocker = queue.enqueue(
			() => 0,
			() => {},
		)
		await act(async () => {})

		render(
			<ItemThumbnail
				item={{id: 'a', tint: 0x336699}}
				size={192}
				warmUntil={performance.now() + 60_000}
				requestQueue={queue}
				requestIndex={1}
			/>,
		)

		expect(imgs()[0]!.src).toContain('s=192')
		blocker.release()
	})
})
