import {LEFT, MIDDLE, RIGHT, type Controller} from './controller'

const TAP_SLOP = 10
const DRAG_SLOP = 7
const LONG_PRESS_MS = 360
const ARMING_DELAY_MS = 120
const DOUBLE_TAP_MS = 320
const DOUBLE_TAP_RADIUS = 30
const TWO_FINGER_TAP_MS = 320
const PINCH_SLOP = 12
const SCROLL_SLOP = 8
const TAP_AND_DRAG_MS = 260
// A swipe this much closer to one axis stays on it, like a scroll view
const AXIS_LOCK_RATIO = 1.6

export type SurfaceEffects = {
	ripple: (x: number, y: number) => void
	arming: (x: number, y: number) => void
	disarm: () => void
	loupe: (x: number, y: number) => void
	hideLoupe: () => void
	// A tap landed, inside the touch's own event so the keyboard may be raised
	tapped: () => void
	padFingers?: (fingers: {x: number; y: number}[], pressed?: boolean) => void
	pointerMoved?: () => void
	// The trackpad clicked, wherever the pointer is
	pointerClicked?: () => void
	// The desktop preview's mouse plays a finger. Anywhere else a mouse or an iPad
	// trackpad is itself: it hovers, presses and scrolls like on a computer.
}

type Finger = {id: number; x: number; y: number}
type Sample = {x: number; y: number; t: number}

function centroid(fingers: Finger[]) {
	return {
		x: fingers.reduce((sum, finger) => sum + finger.x, 0) / fingers.length,
		y: fingers.reduce((sum, finger) => sum + finger.y, 0) / fingers.length,
	}
}
const spread = ([a, b]: Finger[]) => Math.hypot(a.x - b.x, a.y - b.y)

// Release velocity from the last 100 ms of travel, px/s
function releaseVelocity(samples: Sample[]) {
	const last = samples.at(-1)
	const first = samples.find((sample) => last && last.t - sample.t < 100)
	if (!last || !first || last.t === first.t) return {x: 0, y: 0}
	const seconds = (last.t - first.t) / 1000
	return {x: (last.x - first.x) / seconds, y: (last.y - first.y) / seconds}
}

function point(event: Touch, element: HTMLElement): Finger {
	const rect = element.getBoundingClientRect()
	return {id: event.identifier, x: event.clientX - rect.left, y: event.clientY - rect.top}
}

function touches(list: TouchList, element: HTMLElement) {
	return Array.from(list).map((touch) => point(touch, element))
}

// The screen itself: you touch what you see.
//
//   tap                  click there
//   hold                 right-click, with a loupe to see under your finger
//   hold, then move      drag, like lifting something on iOS
//   swipe                move the view, then scroll the guest
//   two-finger tap       right-click
//   two-finger swipe     scroll the guest
//   pinch                zoom the view, never the guest
export function attachDirect(element: HTMLElement, controller: Controller, effects: SurfaceEffects) {
	const {camera} = controller
	type State = 'idle' | 'pending' | 'armed' | 'dragging' | 'panning' | 'two' | 'pinching' | 'scrolling'
	let state: State = 'idle'
	let start = {x: 0, y: 0}
	let last = {x: 0, y: 0}
	let startedAt = 0
	let previousSpread = 0
	let startSpread = 0
	let lastCentre = {x: 0, y: 0}
	let startCentre = {x: 0, y: 0}
	let samples: Sample[] = []
	let holdTimer: ReturnType<typeof setTimeout> | undefined
	let armingTimer: ReturnType<typeof setTimeout> | undefined
	let lastTap = {t: 0, x: 0, y: 0, gx: 0, gy: 0}
	let axis: 'x' | 'y' | undefined

	const clearHold = () => {
		clearTimeout(holdTimer)
		clearTimeout(armingTimer)
		effects.disarm()
	}

	const beginOne = (finger: Finger) => {
		state = 'pending'
		start = last = {x: finger.x, y: finger.y}
		startedAt = performance.now()
		samples = [{...start, t: startedAt}]
		// Hover first, so the guest has reported its cursor shape by the time the
		// tap lands: an I-beam says there's something to type into
		controller.moveToStage(finger.x, finger.y)
		armingTimer = setTimeout(() => effects.arming(start.x, start.y), ARMING_DELAY_MS)
		holdTimer = setTimeout(() => {
			state = 'armed'
			effects.disarm()
			effects.loupe(start.x, start.y)
		}, LONG_PRESS_MS)
	}

	const beginTwo = (fingers: Finger[]) => {
		clearHold()
		state = 'two'
		startedAt = performance.now()
		startSpread = previousSpread = spread(fingers)
		startCentre = lastCentre = centroid(fingers)
		samples = [{...startCentre, t: startedAt}]
	}

	const moveOne = (finger: Finger) => {
		const distance = Math.hypot(finger.x - start.x, finger.y - start.y)
		if (state === 'pending' && distance > TAP_SLOP) {
			clearHold()
			state = 'panning'
			last = {x: finger.x, y: finger.y}
			const across = Math.abs(finger.x - start.x)
			const along = Math.abs(finger.y - start.y)
			axis = along >= across * AXIS_LOCK_RATIO ? 'y' : across >= along * AXIS_LOCK_RATIO ? 'x' : undefined
		}
		if (state === 'armed' && distance > DRAG_SLOP) {
			state = 'dragging'
			effects.disarm()
			controller.moveToStage(start.x, start.y)
			controller.down(LEFT)
		}
		if (state === 'panning') {
			controller.panOrScroll(axis === 'y' ? 0 : finger.x - last.x, axis === 'x' ? 0 : finger.y - last.y)
			last = {x: finger.x, y: finger.y}
			samples = [...samples.slice(-12), {...last, t: performance.now()}]
		}
		if (state === 'dragging') {
			controller.moveToStage(finger.x, finger.y)
			edgePan(finger)
			effects.loupe(finger.x, finger.y)
		}
	}

	// Dragging into an edge of a zoomed view keeps the view moving
	const edgePan = (finger: Finger) => {
		const {view} = camera
		const zone = 44
		const dx = finger.x < view.x + zone ? 7 : finger.x > view.x + view.w - zone ? -7 : 0
		const dy = finger.y < view.y + zone ? 7 : finger.y > view.y + view.h - zone ? -7 : 0
		if (dx || dy) camera.panBy(dx, dy)
	}

	const moveTwo = (fingers: Finger[]) => {
		const span = spread(fingers)
		const centre = centroid(fingers)
		if (state === 'two') {
			if (Math.abs(span - startSpread) > PINCH_SLOP) state = 'pinching'
			else if (Math.hypot(centre.x - startCentre.x, centre.y - startCentre.y) > SCROLL_SLOP) state = 'scrolling'
		}
		if (state === 'pinching') {
			camera.zoomAt(centre.x, centre.y, span / previousSpread)
			camera.shift(centre.x - lastCentre.x, centre.y - lastCentre.y)
		}
		if (state === 'scrolling') {
			controller.scroll(centre.x - lastCentre.x, centre.y - lastCentre.y)
			samples = [...samples.slice(-12), {...centre, t: performance.now()}]
		}
		previousSpread = span
		lastCentre = centre
	}

	const tap = (x: number, y: number) => {
		const now = performance.now()
		const second = now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(x - lastTap.x, y - lastTap.y) < DOUBLE_TAP_RADIUS
		// A finger never lands twice on the same pixel, and a double click has to. In
		// guest pixels, because the view may already be moving for the first tap.
		if (second) controller.moveToGuest(lastTap.gx, lastTap.gy)
		else controller.moveToStage(x, y)
		lastTap = {t: second ? 0 : now, x, y, gx: controller.x, gy: controller.y}
		controller.click(LEFT)
		effects.ripple(x, y)
		effects.tapped()
	}

	const end = (remaining: Finger[], cancelled = false) => {
		clearHold()
		switch (state) {
			case 'pending':
				if (!cancelled) tap(start.x, start.y)
				break
			case 'armed':
				effects.hideLoupe()
				if (!cancelled) {
					controller.moveToStage(start.x, start.y)
					controller.click(RIGHT)
					effects.ripple(start.x, start.y)
				}
				break
			case 'dragging':
				effects.hideLoupe()
				controller.up(LEFT)
				break
			case 'panning': {
				const velocity = releaseVelocity(samples)
				if (!cancelled) controller.flick(axis === 'y' ? 0 : velocity.x, axis === 'x' ? 0 : velocity.y, 'pan')
				break
			}
			case 'two':
				if (!cancelled && remaining.length === 0 && performance.now() - startedAt < TWO_FINGER_TAP_MS) {
					controller.moveToStage(startCentre.x, startCentre.y)
					controller.click(RIGHT)
					effects.ripple(startCentre.x, startCentre.y)
				}
				break
			case 'pinching':
				if (remaining.length === 0) camera.endZoom()
				break
			case 'scrolling': {
				const velocity = releaseVelocity(samples)
				if (!cancelled && remaining.length === 0) controller.flick(velocity.x, velocity.y, 'scroll')
				break
			}
		}
		if (remaining.length === 0 || ['pending', 'armed', 'dragging', 'panning'].includes(state)) state = 'idle'
	}

	const onTouchStart = (event: TouchEvent) => {
		// Also what stops Safari taking a swipe from the edge for back and forward
		event.preventDefault()
		controller.haltFlick()
		camera.stop()
		const fingers = touches(event.touches, element)
		if (fingers.length === 1) beginOne(fingers[0])
		else if (fingers.length === 2 && ['idle', 'pending', 'panning', 'armed'].includes(state)) beginTwo(fingers)
	}
	const onTouchMove = (event: TouchEvent) => {
		event.preventDefault()
		const fingers = touches(event.touches, element)
		if (fingers.length === 1) moveOne(fingers[0])
		if (fingers.length >= 2) moveTwo(fingers.slice(0, 2))
	}
	const onTouchEnd = (event: TouchEvent) => {
		event.preventDefault()
		end(touches(event.touches, element))
	}
	const onTouchCancel = () => end([], true)

	// A mouse on a tablet is a mouse; a Mac trackpad's pinch arrives as a wheel
	const mousePoint = (event: MouseEvent) => {
		const rect = element.getBoundingClientRect()
		return {id: 0, x: event.clientX - rect.left, y: event.clientY - rect.top}
	}
	const onMouseDown = (event: MouseEvent) => {
		event.preventDefault()
		const start = mousePoint(event)
		const mask = event.button === 2 ? RIGHT : event.button === 1 ? MIDDLE : LEFT
		controller.moveToStage(start.x, start.y)
		controller.down(mask)
		const onMove = (move: MouseEvent) => {
			const {x, y} = mousePoint(move)
			controller.moveToStage(x, y)
		}
		const onUp = () => {
			window.removeEventListener('mousemove', onMove)
			window.removeEventListener('mouseup', onUp)
			controller.up(mask)
			if (mask === LEFT) effects.tapped()
		}
		window.addEventListener('mousemove', onMove)
		window.addEventListener('mouseup', onUp)
	}
	const onContextMenu = (event: MouseEvent) => event.preventDefault()
	const onHover = (event: MouseEvent) => {
		if (state !== 'idle' || event.buttons) return
		const {x, y} = mousePoint(event)
		controller.moveToStage(x, y)
	}
	let wheelEnd: ReturnType<typeof setTimeout> | undefined
	const onWheel = (event: WheelEvent) => {
		event.preventDefault()
		const {x, y} = mousePoint(event)
		if (event.ctrlKey) {
			camera.zoomAt(x, y, Math.exp(-event.deltaY * 0.012))
			clearTimeout(wheelEnd)
			wheelEnd = setTimeout(() => camera.endZoom(), 160)
			return
		}
		controller.moveToStage(x, y)
		controller.scroll(-event.deltaX, -event.deltaY)
	}

	element.addEventListener('touchstart', onTouchStart, {passive: false})
	element.addEventListener('touchmove', onTouchMove, {passive: false})
	element.addEventListener('touchend', onTouchEnd, {passive: false})
	element.addEventListener('touchcancel', onTouchCancel)
	element.addEventListener('mousedown', onMouseDown)
	element.addEventListener('mousemove', onHover)
	element.addEventListener('contextmenu', onContextMenu)
	element.addEventListener('wheel', onWheel, {passive: false})
	return () => {
		clearHold()
		element.removeEventListener('touchstart', onTouchStart)
		element.removeEventListener('touchmove', onTouchMove)
		element.removeEventListener('touchend', onTouchEnd)
		element.removeEventListener('touchcancel', onTouchCancel)
		element.removeEventListener('mousedown', onMouseDown)
		element.removeEventListener('mousemove', onHover)
		element.removeEventListener('contextmenu', onContextMenu)
		element.removeEventListener('wheel', onWheel)
	}
}

// Android wants a finger, not a mouse, so a touch is the guest's own: down, move,
// up. It handles its own scrolling, flings and long presses. Two fingers still
// zoom the view, which Android has no way of being told about.
export function attachNativeTouch(element: HTMLElement, controller: Controller, effects: SurfaceEffects) {
	const {camera} = controller
	let pressed = false
	let previousSpread = 0
	let pinching = false
	let lastCentre = {x: 0, y: 0}

	const onTouchStart = (event: TouchEvent) => {
		event.preventDefault()
		camera.stop()
		const fingers = touches(event.touches, element)
		if (fingers.length === 1 && !pinching) {
			controller.moveToStage(fingers[0].x, fingers[0].y)
			controller.down(LEFT)
			pressed = true
		} else if (fingers.length === 2) {
			if (pressed) {
				controller.up(LEFT)
				pressed = false
			}
			pinching = true
			previousSpread = spread(fingers)
			lastCentre = centroid(fingers)
		}
	}
	const onTouchMove = (event: TouchEvent) => {
		event.preventDefault()
		const fingers = touches(event.touches, element)
		if (pressed && fingers.length === 1) controller.moveToStage(fingers[0].x, fingers[0].y)
		if (pinching && fingers.length >= 2) {
			const span = spread(fingers)
			const centre = centroid(fingers)
			camera.zoomAt(centre.x, centre.y, span / previousSpread)
			camera.shift(centre.x - lastCentre.x, centre.y - lastCentre.y)
			previousSpread = span
			lastCentre = centre
		}
	}
	const onTouchEnd = (event: TouchEvent) => {
		event.preventDefault()
		if (event.touches.length > 0) return
		if (pressed) {
			controller.up(LEFT)
			pressed = false
			effects.tapped()
		}
		if (pinching) {
			pinching = false
			camera.endZoom()
		}
	}

	const mousePoint = (event: MouseEvent) => {
		const rect = element.getBoundingClientRect()
		return {x: event.clientX - rect.left, y: event.clientY - rect.top}
	}
	const onMouseDown = (event: MouseEvent) => {
		if (event.button !== 0) return
		event.preventDefault()
		const start = mousePoint(event)
		controller.moveToStage(start.x, start.y)
		controller.down(LEFT)
		const onMove = (move: MouseEvent) => {
			const {x, y} = mousePoint(move)
			controller.moveToStage(x, y)
		}
		const onUp = () => {
			window.removeEventListener('mousemove', onMove)
			window.removeEventListener('mouseup', onUp)
			controller.up(LEFT)
			effects.tapped()
		}
		window.addEventListener('mousemove', onMove)
		window.addEventListener('mouseup', onUp)
	}

	element.addEventListener('touchstart', onTouchStart, {passive: false})
	element.addEventListener('touchmove', onTouchMove, {passive: false})
	element.addEventListener('touchend', onTouchEnd, {passive: false})
	element.addEventListener('touchcancel', onTouchEnd, {passive: false})
	element.addEventListener('mousedown', onMouseDown)
	return () => {
		element.removeEventListener('touchstart', onTouchStart)
		element.removeEventListener('touchmove', onTouchMove)
		element.removeEventListener('touchend', onTouchEnd)
		element.removeEventListener('touchcancel', onTouchEnd)
		element.removeEventListener('mousedown', onMouseDown)
	}
}

// A laptop's trackpad, gesture for gesture.
//
//   move                 move the pointer
//   tap                  click where the pointer is
//   tap, then drag       drag
//   two-finger tap       right-click
//   two-finger swipe     scroll
//   pinch                zoom the view around the pointer
export function attachTrackpad(element: HTMLElement, controller: Controller, effects: SurfaceEffects) {
	const {camera} = controller
	type State = 'idle' | 'pending' | 'moving' | 'tapdrag' | 'dragging' | 'two' | 'pinching' | 'scrolling'
	let state: State = 'idle'
	let start = {x: 0, y: 0}
	let last = {x: 0, y: 0, t: 0}
	let startedAt = 0
	let lastTapAt = 0
	let previousSpread = 0
	let startSpread = 0
	let lastCentre = {x: 0, y: 0}
	let startCentre = {x: 0, y: 0}
	let samples: Sample[] = []

	const beginOne = (finger: Finger) => {
		const now = performance.now()
		state = now - lastTapAt < TAP_AND_DRAG_MS ? 'tapdrag' : 'pending'
		start = {x: finger.x, y: finger.y}
		last = {...start, t: now}
		startedAt = now
	}

	const beginTwo = (fingers: Finger[]) => {
		state = 'two'
		startedAt = performance.now()
		startSpread = previousSpread = spread(fingers)
		startCentre = lastCentre = centroid(fingers)
		samples = [{...startCentre, t: startedAt}]
	}

	const movePointer = (finger: Finger) => {
		const now = performance.now()
		const dx = finger.x - last.x
		const dy = finger.y - last.y
		const dt = Math.max(1, now - last.t)
		// Slow movements stay exact, quick ones cover the screen
		const speed = Math.hypot(dx, dy) / dt
		const gain = 1.15 + Math.min(1.9, speed * 1.1)
		last = {x: finger.x, y: finger.y, t: now}
		controller.moveBy(dx * gain, dy * gain)
		effects.pointerMoved?.()
	}

	const moveOne = (finger: Finger) => {
		const distance = Math.hypot(finger.x - start.x, finger.y - start.y)
		if (state === 'pending' && distance > 3) state = 'moving'
		if (state === 'tapdrag' && distance > 3) {
			state = 'dragging'
			controller.down(LEFT)
		}
		if (state === 'moving' || state === 'dragging') movePointer(finger)
	}

	const moveTwo = (fingers: Finger[]) => {
		const span = spread(fingers)
		const centre = centroid(fingers)
		if (state === 'two') {
			if (Math.abs(span - startSpread) > PINCH_SLOP) state = 'pinching'
			else if (Math.hypot(centre.x - startCentre.x, centre.y - startCentre.y) > SCROLL_SLOP) state = 'scrolling'
		}
		if (state === 'pinching') {
			const focus = camera.toStage(controller.x, controller.y)
			camera.zoomAt(focus.x, focus.y, span / previousSpread)
		}
		if (state === 'scrolling') {
			controller.scroll(centre.x - lastCentre.x, centre.y - lastCentre.y)
			samples = [...samples.slice(-12), {...centre, t: performance.now()}]
		}
		previousSpread = span
		lastCentre = centre
	}

	const end = (remaining: Finger[]) => {
		const now = performance.now()
		switch (state) {
			case 'pending':
				if (now - startedAt < 220) {
					lastTapAt = now
					controller.click(LEFT)
					effects.tapped()
					effects.pointerClicked?.()
					effects.padFingers?.([], true)
				}
				break
			case 'tapdrag':
				controller.click(LEFT)
				break
			case 'dragging':
				controller.up(LEFT)
				break
			case 'two':
				if (remaining.length === 0 && now - startedAt < TWO_FINGER_TAP_MS) {
					controller.click(RIGHT)
					effects.pointerClicked?.()
					effects.padFingers?.([], true)
				}
				break
			case 'pinching':
				if (remaining.length === 0) camera.endZoom()
				break
			case 'scrolling': {
				const velocity = releaseVelocity(samples)
				if (remaining.length === 0) controller.flick(velocity.x, velocity.y, 'scroll')
				break
			}
		}
		if (remaining.length === 0) state = 'idle'
		else if (remaining.length === 1 && state !== 'pinching' && state !== 'scrolling' && state !== 'two')
			beginOne(remaining[0])
	}

	const onTouchStart = (event: TouchEvent) => {
		event.preventDefault()
		controller.haltFlick()
		camera.stop()
		const fingers = touches(event.touches, element)
		effects.padFingers?.(fingers)
		if (fingers.length === 1) beginOne(fingers[0])
		else if (fingers.length === 2) beginTwo(fingers)
	}
	const onTouchMove = (event: TouchEvent) => {
		event.preventDefault()
		const fingers = touches(event.touches, element)
		effects.padFingers?.(fingers)
		if (fingers.length === 1) moveOne(fingers[0])
		if (fingers.length >= 2) moveTwo(fingers.slice(0, 2))
	}
	const onTouchEnd = (event: TouchEvent) => {
		event.preventDefault()
		const fingers = touches(event.touches, element)
		end(fingers)
		effects.padFingers?.(fingers)
	}
	const onTouchCancel = () => {
		state = 'idle'
		effects.padFingers?.([])
	}

	const mousePoint = (event: MouseEvent) => {
		const rect = element.getBoundingClientRect()
		return {id: 0, x: event.clientX - rect.left, y: event.clientY - rect.top}
	}
	const onMouseDown = (event: MouseEvent) => {
		if (event.button !== 0) return
		event.preventDefault()
		controller.haltFlick()
		camera.stop()
		beginOne(mousePoint(event))
		effects.padFingers?.([mousePoint(event)])
		const onMove = (move: MouseEvent) => {
			moveOne(mousePoint(move))
			effects.padFingers?.([mousePoint(move)])
		}
		const onUp = () => {
			window.removeEventListener('mousemove', onMove)
			window.removeEventListener('mouseup', onUp)
			end([])
			effects.padFingers?.([])
		}
		window.addEventListener('mousemove', onMove)
		window.addEventListener('mouseup', onUp)
	}
	const onContextMenu = (event: MouseEvent) => {
		event.preventDefault()
		controller.click(RIGHT)
	}
	const onWheel = (event: WheelEvent) => {
		event.preventDefault()
		if (event.ctrlKey) {
			const focus = camera.toStage(controller.x, controller.y)
			camera.zoomAt(focus.x, focus.y, Math.exp(-event.deltaY * 0.012))
			return
		}
		controller.scroll(-event.deltaX, -event.deltaY)
	}

	element.addEventListener('touchstart', onTouchStart, {passive: false})
	element.addEventListener('touchmove', onTouchMove, {passive: false})
	element.addEventListener('touchend', onTouchEnd, {passive: false})
	element.addEventListener('touchcancel', onTouchCancel)
	element.addEventListener('mousedown', onMouseDown)
	element.addEventListener('contextmenu', onContextMenu)
	element.addEventListener('wheel', onWheel, {passive: false})
	return () => {
		element.removeEventListener('touchstart', onTouchStart)
		element.removeEventListener('touchmove', onTouchMove)
		element.removeEventListener('touchend', onTouchEnd)
		element.removeEventListener('touchcancel', onTouchCancel)
		element.removeEventListener('mousedown', onMouseDown)
		element.removeEventListener('contextmenu', onContextMenu)
		element.removeEventListener('wheel', onWheel)
	}
}
