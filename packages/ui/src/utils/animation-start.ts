// Safari starts a CSS animation's clock when the element's style is first
// resolved, not when the element is first drawn. Everything in between comes out
// of the animation: the rest of the render that mounted the element, then the
// layout and paint of its first frame. A menu or drawer loses most or all of its
// entrance that way and just appears. Chrome and Firefox keep a new animation
// waiting until its first frame is on screen, so they lose nothing.
//
// This gives Safari the same behaviour where it can be had. WebKit fires
// `animationstart` inside the animation's first rendering update, before any of
// it has been painted, so that is where an animation is put back on its first
// keyframe and held. It is let go once that frame has been drawn. One that had
// run out by then is played again, and the end of the run nobody saw is kept
// from the page.
//
// Only for WebKit: elsewhere the event arrives after the first frame, when
// rewinding would replay an animation that is already on screen. Should WebKit
// start waiting for the first frame itself, this can go.

// Every browser on iOS is WebKit too
const isWebKit = navigator.vendor === 'Apple Computer, Inc.'

// Shorter than this can't be seen (reduced motion collapses some to 0.01ms)
const MIN_DURATION_MS = 50

// What is held: menus and the like that Radix positions, drawers, and a window
// on its way out. Safari only shows what follows the hold as fast as the page
// gets its next frames out, so it pays off for what is light to draw, or already
// on screen. Measured on an iPhone, an arriving window, dialog or page of content
// came up later for it and no more animated.
const HELD = '[data-side], [data-vaul-drawer], [data-vaul-overlay], .umbrel-sheet-zoom[data-state="closed"]'

export function startAnimationsOnFirstFrame() {
	if (!isWebKit) return
	document.addEventListener('animationstart', handleAnimationStart, true)
	document.addEventListener('animationend', handleAnimationEnd, true)
}

function handleAnimationStart(event: AnimationEvent) {
	const element = event.target
	// A hidden tab draws no frames to wait for
	if (!(element instanceof Element) || event.pseudoElement || document.hidden) return
	if (!element.matches(HELD)) return

	// One that started later than its whole duration has already finished, and
	// been discarded unless it fills forwards
	const animation = findAnimation(element, event.animationName) ?? restartAnimation(element, event.animationName)
	if (!animation || !startsNow(animation)) return

	// Held by its rate, not by pausing: a scripted pause would take the animation
	// away from `animation-play-state` for good
	animation.playbackRate = 0
	animation.currentTime = 0

	// The first callback still runs inside this rendering update, the second in
	// the one after it has been painted
	requestAnimationFrame(() =>
		requestAnimationFrame(() => {
			animation.playbackRate = 1
		}),
	)
}

// An animation that is being held here has not played yet. The end it reports
// is the one of the run that finished before its first frame, and whoever acts
// on it (Radix unmounts closed content) would cut off the real one.
function handleAnimationEnd(event: AnimationEvent) {
	const element = event.target
	if (!(element instanceof Element) || event.pseudoElement) return
	if (findAnimation(element, event.animationName)?.playbackRate === 0) event.stopImmediatePropagation()
}

function findAnimation(element: Element, name: string) {
	return element
		.getAnimations()
		.find(
			(animation): animation is CSSAnimation => animation instanceof CSSAnimation && animation.animationName === name,
		)
}

// Elements whose animation came back as one that isn't held. It may well be gone
// again by its own start event, and restarting it each time would never end.
const notRestartable = new WeakSet<Element>()

function restartAnimation(element: Element, name: string) {
	if (!(element instanceof HTMLElement || element instanceof SVGElement) || notRestartable.has(element))
		return undefined
	const {style} = element
	const value = style.getPropertyValue('animation-name')
	const priority = style.getPropertyPriority('animation-name')
	style.setProperty('animation-name', 'none', 'important')
	// Resolves style, which is what ends the old animation
	element.getAnimations()
	if (value) style.setProperty('animation-name', value, priority)
	else style.removeProperty('animation-name')
	const animation = findAnimation(element, name)
	if (animation && !startsNow(animation)) notRestartable.add(element)
	return animation
}

// A plain one-off animation that is due to be moving right now. Delayed ones
// have long been on screen when they start, loops have no entrance to lose, and
// one that is already held or scrubbed by a scroll timeline isn't ours to touch.
function startsNow(animation: CSSAnimation) {
	const timing = animation.effect?.getComputedTiming()
	return (
		timing !== undefined &&
		animation.timeline === document.timeline &&
		animation.playbackRate === 1 &&
		timing.delay === 0 &&
		Number.isFinite(timing.endTime) &&
		Number(timing.duration) >= MIN_DURATION_MS
	)
}
