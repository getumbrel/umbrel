// @vitest-environment jsdom

import {afterEach, describe, expect, test, vi} from 'vitest'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

type Size = {width: number; height: number}
type List = {query: string; matches: boolean; listeners: Set<() => void>}

// A browser's side of it: the window CSS measures and the media queries asked
// of it, what documentElement.clientWidth and clientHeight say (which a
// browser may move a moment before or after the queries) and what
// window.innerWidth and innerHeight say (which a pinch changes, and nothing
// else here). It understands the queries Tailwind's screens and `low` in
// index.css are made of, in px, and nothing else: any other is not what CSS goes by.
const browser = (() => {
	let css: Size = {width: 1024, height: 768}
	let client: Size = css
	let lists: List[] = []
	let reads = 0
	const matches = (query: string) => {
		const minWidth = /^\(min-width: (\d+)px\)$/.exec(query)
		if (minWidth) return css.width >= Number(minWidth[1])
		const height = /^\(height < (\d+)px\)$/.exec(query)
		if (height) return css.height < Number(height[1])
		throw new Error(`Not a query CSS asks: ${query}`)
	}
	const matchMedia = ((query: string) => {
		const list: List = {query, matches: matches(query), listeners: new Set()}
		lists.push(list)
		return {
			media: query,
			get matches() {
				reads++
				return list.matches
			},
			addEventListener: (_: 'change', listener: () => void) => list.listeners.add(listener),
			removeEventListener: (_: 'change', listener: () => void) => list.listeners.delete(listener),
		}
	}) as unknown as typeof window.matchMedia
	const onScreen = ({width, height}: Size) => {
		Object.defineProperty(window, 'innerWidth', {configurable: true, value: width})
		Object.defineProperty(window, 'innerHeight', {configurable: true, value: height})
	}
	return {
		/** A window of this size, with nothing asked of it yet */
		open(width: number, height: number) {
			css = client = {width, height}
			lists = []
			window.matchMedia = matchMedia
			Object.defineProperty(window, 'visualViewport', {configurable: true, value: new EventTarget()})
			for (const [name, read] of [
				['clientWidth', () => client.width],
				['clientHeight', () => client.height],
			] as const) {
				Object.defineProperty(document.documentElement, name, {configurable: true, get: () => (reads++, read())})
			}
			onScreen(css)
		},
		/**
		 * The window CSS measures takes a size: every query it changes has
		 * changed, as a browser has them by the time the first is heard from.
		 * What each has to say about it is returned unsaid, in the order they were asked.
		 */
		flip(width: number, height: number) {
			css = {width, height}
			const changed = lists.filter((list) => list.matches !== matches(list.query))
			for (const list of changed) list.matches = !list.matches
			return changed.flatMap((list) => [...list.listeners])
		},
		/** clientWidth and clientHeight catch up with it (and innerWidth and innerHeight, unless pinched) */
		settle(pinched = false) {
			client = css
			if (!pinched) onScreen(css)
		},
		/** Or move before the queries have */
		clientTo(width: number, height: number, pinched = false) {
			client = {width, height}
			if (!pinched) onScreen(client)
		},
		onScreen,
		queries: () => lists.map((list) => list.query),
		reads: () => reads,
	}
})()

type Seen = {
	breakpoint: string
	mobile: boolean
	smallMobile: boolean
	phone: boolean
	tablet: boolean
	phoneNow: boolean
}
const names = ['breakpoint', 'mobile', 'smallMobile', 'phone', 'tablet', 'phoneNow'] as const

// What each hook said of a window of this size before any of this, when the
// size was window.innerWidth and innerHeight (`heldHeight`: the height from
// before the keyboard came up)
function original(width: number, height: number, heldHeight = height): Seen {
	const mobile = width < 1024
	const phone = mobile && (width < 640 || heldHeight < 500)
	return {
		breakpoint: width >= 1400 ? '2xl' : width >= 1280 ? 'xl' : width >= 1024 ? 'lg' : width >= 768 ? 'md' : 'sm',
		mobile,
		smallMobile: width < 768,
		phone,
		tablet: mobile && !phone,
		phoneNow: mobile && (width < 640 || height < 500),
	}
}
const layoutOf = (seen: Seen) => (seen.phone ? 'phone' : seen.tablet ? 'tablet' : 'desktop')

// The ways a browser tells of a new size. React renders between any two of them.
const orders = [
	'the queries, then the resize',
	// Chrome: by the resize the queries have changed
	'the resize, then the queries',
	// Safari on an iPad, measured: the size has moved by the resize and the queries have not
	'the resize before the queries move',
	// Safari on an iPad, as it was noted before: the queries, and the size a moment later
	'the queries before the size moves',
	'a turn first',
	// Safari again, whole: the turn is told of well before the resize
	'a turn first, then the resize before the queries move',
	'the queries alone',
	'the queries backwards',
] as const
type Order = (typeof orders)[number]

let unmount: (() => Promise<void>) | undefined

// A page of probes on a fresh reading of a window of this size
async function open(width: number, height: number, {strict = false} = {}) {
	browser.open(width, height)
	vi.resetModules()
	const added: [EventTarget, string, EventListener][] = []
	const spies = [window, document, window.visualViewport!].map((target) => {
		const add = target.addEventListener.bind(target)
		return vi.spyOn(target, 'addEventListener').mockImplementation((type: string, listener: unknown) => {
			added.push([target, type, listener as EventListener])
			add(type, listener as EventListener)
		})
	})
	const React = await import('react')
	const {createRoot} = await import('react-dom/client')
	const {useBreakpoint} = await import('./tw')
	const {useIsMobile, useIsSmallMobile, useIsPhone, useIsTablet, useIsPhoneNow} = await import('@/hooks/use-is-mobile')
	for (const spy of spies) spy.mockRestore()
	const {act, createElement, useEffect, StrictMode} = React

	const page = {
		/** Every answer the page was drawn with, all six asked together */
		drawn: [] as Seen[],
		/** The same, of a page that mounted later */
		late: [] as Seen[],
		/** What a layout picked by them mounted: a drawer for a phone, a window otherwise */
		mounted: [] as string[],
		/** Every answer drawn by a component that asks only the one */
		alone: Object.fromEntries(names.map((name) => [name, [] as unknown[]])) as Record<keyof Seen, unknown[]>,
		renders: 0,
	}
	function Layout({name}: {name: string}) {
		useEffect(() => {
			page.mounted.push(name)
		}, [name])
		return null
	}
	function All() {
		const seen: Seen = {
			breakpoint: useBreakpoint(),
			mobile: useIsMobile(),
			smallMobile: useIsSmallMobile(),
			phone: useIsPhone(),
			tablet: useIsTablet(),
			phoneNow: useIsPhoneNow(),
		}
		page.renders++
		useEffect(() => {
			page.drawn.push(seen)
		})
		return createElement(Layout, {key: layoutOf(seen), name: layoutOf(seen)})
	}
	function Late() {
		const seen: Seen = {
			breakpoint: useBreakpoint(),
			mobile: useIsMobile(),
			smallMobile: useIsSmallMobile(),
			phone: useIsPhone(),
			tablet: useIsTablet(),
			phoneNow: useIsPhoneNow(),
		}
		useEffect(() => {
			page.late.push(seen)
		})
		return null
	}
	const alone = (name: keyof Seen, useAnswer: () => unknown) =>
		function Alone() {
			const answer = useAnswer()
			useEffect(() => {
				page.alone[name].push(answer)
			})
			return null
		}
	const alones = [
		alone('breakpoint', useBreakpoint),
		alone('mobile', useIsMobile),
		alone('smallMobile', useIsSmallMobile),
		alone('phone', useIsPhone),
		alone('tablet', useIsTablet),
		alone('phoneNow', useIsPhoneNow),
	]
	const tree = () => {
		const probes = [createElement(All, {key: 'all'}), ...alones.map((Alone, i) => createElement(Alone, {key: i}))]
		return strict ? createElement(StrictMode, null, probes) : probes
	}
	const root = createRoot(document.createElement('div'))
	const step = (fn: () => void) => act(async () => fn())
	await step(() => root.render(tree()))
	const clear = () => {
		page.drawn = []
		page.mounted = []
		for (const name of names) page.alone[name] = []
	}
	clear()
	const lateRoot = createRoot(document.createElement('div'))
	unmount = async () => {
		await step(() => root.unmount())
		await step(() => lateRoot.unmount())
		for (const [target, type, listener] of added) target.removeEventListener(type, listener)
	}

	// Something to do once the browser has said the first thing of a resize, and has more to say
	let afterFirst: (() => Promise<void>) | undefined
	const said = async () => {
		const then = afterFirst
		afterFirst = undefined
		await then?.()
	}
	const send = async (type: string, target: EventTarget = window) => {
		await step(() => void target.dispatchEvent(new Event(type)))
		await said()
	}
	const say = async (changes: (() => void)[]) => {
		for (const change of changes) {
			await step(change)
			await said()
		}
	}
	const resized = async () => {
		await send('resize')
		await send('resize', window.visualViewport!)
	}
	return {
		page,
		clear,
		step,
		send,
		rerender: () => step(() => root.render(tree())),
		mountLate: () => step(() => lateRoot.render(createElement(Late))),
		/** The window takes a size, told of in one of the orders above */
		async resize(
			order: Order,
			width: number,
			height: number,
			{pinched = false, between}: {pinched?: boolean; between?: () => Promise<void>} = {},
		) {
			afterFirst = between
			if (order.startsWith('a turn first')) await send('orientationchange')
			if (order.endsWith('the resize before the queries move')) {
				browser.clientTo(width, height, pinched)
				await resized()
				await say(browser.flip(width, height))
				return
			}
			const changes = browser.flip(width, height)
			if (order === 'the queries before the size moves') {
				await say(changes)
				browser.settle(pinched)
				await resized()
				return
			}
			browser.settle(pinched)
			if (order === 'the resize, then the queries') await resized()
			await say(order === 'the queries backwards' ? [...changes].reverse() : changes)
			if (order !== 'the resize, then the queries' && order !== 'the queries alone') await resized()
			afterFirst = undefined
		},
	}
}

afterEach(async () => {
	await unmount?.()
	unmount = undefined
	vi.useRealTimers()
})

test("the queries asked are CSS's own, in px", async () => {
	await open(820, 1180)
	expect(browser.queries()).toEqual([
		'(min-width: 640px)',
		'(min-width: 768px)',
		'(min-width: 1024px)',
		'(min-width: 1280px)',
		'(min-width: 1400px)',
		// `low` in index.css
		'(height < 500px)',
	])
})

test.each([
	[390, 844],
	[844, 390],
	[600, 400],
	[700, 1000],
	[820, 1180],
	[1180, 820],
	[1024, 768],
	[1100, 480],
	[1280, 480],
	[1440, 900],
])('a window of %i by %i is what it always was', async (width, height) => {
	const {page, rerender} = await open(width, height)
	await rerender()
	expect(page.drawn.at(-1)).toEqual(original(width, height))
})

const transitions: [name: string, from: [number, number], to: [number, number]][] = [
	['a desktop and a tablet', [1180, 820], [820, 1180]],
	['a tablet and a phone', [820, 1180], [390, 844]],
	['a phone and a desktop, with every line between them', [390, 844], [1440, 900]],
	['a phone upright and on its side', [390, 844], [844, 390]],
	['a tablet and a window as short as a phone on its side', [820, 600], [820, 480]],
	['a desktop and a short desktop, which is no phone', [1440, 900], [1100, 480]],
	['either side of 640 wide', [639, 900], [640, 900]],
	['either side of 768 wide', [767, 900], [768, 900]],
	['either side of 1024 wide', [1023, 900], [1024, 900]],
	['either side of 1280 wide', [1279, 900], [1280, 900]],
	['either side of 1400 wide', [1399, 900], [1400, 900]],
	['either side of 500 high', [820, 499], [820, 500]],
]

describe.each(orders)('told of by %s', (order) => {
	test.each(transitions.flatMap(([name, a, b]) => [[name, a, b] as const, [`${name}, back`, b, a] as const]))(
		'between %s',
		async (_name, from, to) => {
			const {page, resize} = await open(...from)
			const [was, is] = [original(...from), original(...to)]
			await resize(order, ...to)
			// Drawn once for the new window if anything differs, and never for a third
			expect(page.drawn).toEqual(JSON.stringify(was) === JSON.stringify(is) ? [] : [is])
			// A drawer or a window mounts once, when it is another's turn
			expect(page.mounted).toEqual(layoutOf(was) === layoutOf(is) ? [] : [layoutOf(is)])
			// And whoever asks only one thing is told when it changes, once, and not otherwise
			for (const name of names)
				expect([name, page.alone[name]]).toEqual([name, was[name] === is[name] ? [] : [is[name]]])
		},
	)

	test('a window stays a window while the keyboard comes up and goes away', async () => {
		// A foldable's inner display
		const {page, resize, step} = await open(841, 701)
		const input = document.body.appendChild(document.createElement('input'))
		await step(() => input.focus())
		// The Android app's keyboard shrinks the window, a step at a time
		for (const height of [620, 480, 401]) await resize(order, 841, height)
		// Layouts that follow the window as it is are told, once, and nobody else
		expect(page.drawn).toEqual([original(841, 401, 701)])
		expect(page.mounted).toEqual([])
		expect(page.alone).toMatchObject({phone: [], tablet: [], phoneNow: [true]})
		// Tapping elsewhere takes the keyboard down, a step at a time
		await step(() => input.blur())
		for (const height of [420, 560, 701]) await resize(order, 841, height)
		expect(page.drawn).toEqual([original(841, 401, 701), original(841, 701)])
		expect(page.mounted).toEqual([])
		expect(page.alone).toMatchObject({phone: [], tablet: [], phoneNow: [true, false]})
		input.remove()
	})

	test('a window that crosses the line in one step with a field focused stays a window', async () => {
		const {page, resize, step} = await open(841, 701)
		const input = document.body.appendChild(document.createElement('input'))
		await step(() => input.focus())
		await resize(order, 841, 401)
		expect(page.drawn).toEqual([original(841, 401, 701)])
		expect(page.mounted).toEqual([])
		// Turned while typing, it catches up (at the resize: no line of width is crossed)
		if (order === 'the queries alone') return input.remove()
		await resize(order, 900, 380)
		expect(page.drawn.at(-1)).toEqual(original(900, 380))
		expect(page.drawn.filter((seen) => seen.tablet && seen.phone)).toEqual([])
		expect(page.mounted).toEqual(['phone'])
		input.remove()
	})

	test.each([
		[1440, 900, ['desktop']],
		[900, 700, []],
	] as const)(
		'a window that takes another size with the keyboard up is never a phone on the way: %i by %i',
		async (width, height, mounted) => {
			const {page, resize, step, clear} = await open(841, 701)
			const input = document.body.appendChild(document.createElement('input'))
			await step(() => input.focus())
			await resize(order, 841, 401)
			clear()
			await resize(order, width, height)
			expect(page.drawn.filter((seen) => seen.phone)).toEqual([])
			expect(page.drawn.at(-1)).toEqual(original(width, height))
			expect(page.mounted).toEqual(mounted)
			expect(page.alone.phone).toEqual([])
			input.remove()
		},
	)

	test('a component that mounts part way through a resize is of one mind with the rest', async () => {
		const {page, resize, mountLate} = await open(1180, 820)
		const [was, is] = [original(1180, 820), original(390, 844)]
		await resize(order, 390, 844, {between: mountLate})
		expect(page.late.length).toBeGreaterThan(0)
		for (const seen of page.late) expect([was, is]).toContainEqual(seen)
		expect(page.late.at(-1)).toEqual(is)
		expect(page.drawn).toEqual([is])
	})

	test('a keyboard is taken for gone a second after the window was last heard from', async () => {
		const {page, resize, step, send} = await open(841, 701)
		vi.useFakeTimers()
		const pass = (ms: number) => step(() => vi.advanceTimersByTime(ms))
		const input = document.body.appendChild(document.createElement('input'))
		await step(() => input.focus())
		await resize(order, 841, 401)
		// Put away, leaving the window shorter than it found it
		await step(() => input.blur())
		await send('focusout')
		await resize(order, 841, 450)
		// A pinch says so over and over, for as long as it goes on
		for (let i = 0; i < 5; i++) {
			await pass(500)
			await send('resize', window.visualViewport!)
		}
		await pass(999)
		expect(page.drawn.at(-1)).toEqual(original(841, 450, 701))
		expect(page.mounted).toEqual([])
		await pass(1)
		expect(page.drawn.at(-1)).toEqual(original(841, 450))
		expect(page.mounted).toEqual(['phone'])
		input.remove()
	})

	test('a window that gets short with nothing focused is short', async () => {
		const {page, resize} = await open(841, 701)
		await resize(order, 841, 401)
		expect(page.drawn).toEqual([original(841, 401)])
		expect(page.mounted).toEqual(['phone'])
		await resize(order, 841, 701)
		expect(page.drawn).toEqual([original(841, 401), original(841, 701)])
	})

	test('a phone turned with a field focused is never a tablet', async () => {
		const {page, resize, step} = await open(390, 844)
		const input = document.body.appendChild(document.createElement('input'))
		await step(() => input.focus())
		await resize(order, 844, 390)
		await resize(order, 390, 844)
		expect(page.drawn).toEqual([original(844, 390), original(390, 844)])
		expect(page.mounted).toEqual([])
		input.remove()
	})

	test('a page pinched larger and then turned follows the window, not what is on screen', async () => {
		const {page, resize, send} = await open(820, 1180)
		// 820 wide at 1.3 times its size: less than a phone's width is on screen
		browser.onScreen({width: 630, height: 907})
		await send('resize')
		await send('resize', window.visualViewport!)
		expect(page.drawn).toEqual([])
		await resize(order, 1180, 820, {pinched: true})
		expect(page.drawn).toEqual([original(1180, 820)])
		expect(page.mounted).toEqual(['desktop'])
	})
})

test('a page pinched larger stays what CSS says it is, and nothing is drawn again', async () => {
	const {page, send, rerender} = await open(1180, 820)
	// A desktop's window pinched to a tablet's width and a phone's height
	browser.onScreen({width: 900, height: 480})
	await send('resize')
	await send('resize', window.visualViewport!)
	expect(page.drawn).toEqual([])
	expect(page.alone).toEqual(Object.fromEntries(names.map((name) => [name, []])))
	await rerender()
	expect(page.drawn).toEqual([original(1180, 820)])
})

test('rendering reads nothing: the answer is the one from the last time the window said anything', async () => {
	const {page, rerender, send} = await open(1180, 820)
	// The window is a phone's now, and has not said so
	browser.flip(390, 844)
	browser.settle()
	const reads = browser.reads()
	const renders = page.renders
	await rerender()
	expect(page.renders).toBeGreaterThan(renders)
	expect(browser.reads()).toBe(reads)
	expect(page.drawn).toEqual([original(1180, 820)])
	await send('resize')
	expect(page.drawn.at(-1)).toEqual(original(390, 844))
})

test.each([
	['pageshow', () => window],
	['resize', () => window.visualViewport!],
	['visibilitychange', () => document],
	['focusout', () => window],
	['orientationchange', () => window],
] as const)('a change nothing told of is caught up with at the next %s', async (type, target) => {
	const {page, send} = await open(1180, 820)
	browser.flip(390, 844)
	browser.settle()
	await send(type, target())
	expect(page.drawn).toEqual([original(390, 844)])
	expect(page.mounted).toEqual(['phone'])
	expect(page.alone.phone).toEqual([true])
})

test('a keyboard that leaves the window shorter than it found it is known to be gone', async () => {
	const {page, resize, step, send} = await open(841, 701)
	vi.useFakeTimers()
	const pass = (ms: number) => step(() => vi.advanceTimersByTime(ms))
	const input = document.body.appendChild(document.createElement('input'))
	await step(() => input.focus())
	await resize('the resize, then the queries', 841, 401)
	// Still typing: however long it takes
	await pass(5000)
	expect(page.drawn.at(-1)).toEqual(original(841, 401, 701))
	// Put away, and a toolbar is back that was not there before: the window is not as tall as it was
	await step(() => input.blur())
	await send('focusout')
	await pass(600)
	await resize('the resize, then the queries', 841, 450)
	// It may still be on its way down
	await pass(999)
	expect(page.drawn.at(-1)).toEqual(original(841, 450, 701))
	expect(page.mounted).toEqual([])
	await pass(1)
	expect(page.drawn.at(-1)).toEqual(original(841, 450))
	expect(page.mounted).toEqual(['phone'])
	input.remove()
})

test('a field focused again before the keyboard is taken for gone keeps the window', async () => {
	const {page, resize, step, send} = await open(841, 701)
	vi.useFakeTimers()
	const pass = (ms: number) => step(() => vi.advanceTimersByTime(ms))
	const [first, second] = [0, 1].map(() => document.body.appendChild(document.createElement('input')))
	await step(() => first.focus())
	await resize('the resize, then the queries', 841, 401)
	// From one field to the next: the keyboard stays where it is
	await step(() => first.blur())
	await send('focusout')
	await step(() => second.focus())
	await pass(5000)
	expect(page.drawn.at(-1)).toEqual(original(841, 401, 701))
	expect(page.mounted).toEqual([])
	first.remove()
	second.remove()
})

test('under StrictMode too, a layout is never drawn on the way to another', async () => {
	const {page, resize, clear} = await open(1180, 820, {strict: true})
	const sizes: [number, number][] = [
		[820, 1180],
		[390, 844],
		[1440, 900],
		[844, 390],
		[390, 844],
		[1180, 820],
	]
	let from = original(1180, 820)
	for (const order of orders) {
		for (const size of sizes) {
			clear()
			await resize(order, ...size)
			const to = original(...size)
			for (const seen of page.drawn) expect([from, to]).toContainEqual(seen)
			expect(page.drawn.at(-1) ?? from).toEqual(to)
			from = to
		}
	}
})

describe('a window that can not be asked', () => {
	// Stand-ins other suites give the window: answers with no way to listen, and the other way round
	const standIns: [name: string, matchMedia: unknown][] = [
		['no matchMedia', undefined],
		['queries nobody can listen to', (query: string) => ({matches: false, media: query})],
		['queries that answer nothing', () => ({addEventListener() {}, removeEventListener() {}})],
	]
	test.each(standIns)('is read by its size: %s', async (_name, matchMedia) => {
		const opened = open(1440, 900)
		// (In place before the reading is taken)
		window.matchMedia = matchMedia as unknown as typeof window.matchMedia
		const {page, send, rerender, clear} = await opened
		await rerender()
		expect(page.drawn.at(-1)).toEqual(original(1440, 900))
		clear()
		// Its size is innerWidth and innerHeight, whatever a suite has documentElement say of itself
		browser.flip(240, 300)
		browser.settle()
		browser.onScreen({width: 1440, height: 900})
		await send('resize')
		expect(page.drawn).toEqual([])
		browser.onScreen({width: 390, height: 844})
		await send('resize')
		expect(page.drawn.at(-1)).toEqual(original(390, 844))
		expect(page.mounted).toEqual(['phone'])
		expect(page.alone.phone).toEqual([true])
	})
})
