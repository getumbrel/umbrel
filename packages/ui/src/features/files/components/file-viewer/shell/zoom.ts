// The zoom levels ⌘+ and ⌘− step through
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]

// The next level up or down from `current`, which a pinch or a fit can leave between levels
export const zoomStep = (current: number, direction: 1 | -1) =>
	direction > 0
		? (ZOOM_STEPS.find((step) => step > current * 1.01) ?? ZOOM_STEPS.at(-1)!)
		: (ZOOM_STEPS.findLast((step) => step < current * 0.99) ?? ZOOM_STEPS[0])

// A trackpad pinch over `element` zooms by a factor about a point on screen, never the window around it: Chrome and
// Firefox send it as the wheel with ctrl, Safari as gestures of its own. A touch screen's pinch comes as touches,
// which each viewer follows itself, so `gestures` is off there (Safari on iPhone and iPad sends those as gestures too).
export function listenForPinch(
	element: HTMLElement,
	onZoom: (factor: number, x: number, y: number) => void,
	{gestures, signal}: {gestures: boolean; signal: AbortSignal},
) {
	const options = {passive: false, signal}
	// Safari's gesture in progress: its scale so far
	let gesture: number | undefined
	if (gestures) {
		element.addEventListener('gesturestart', (event) => (event.preventDefault(), (gesture = 1)), options)
		element.addEventListener(
			'gesturechange',
			(event) => {
				event.preventDefault()
				const {scale, clientX, clientY} = event as Event & {scale: number; clientX: number; clientY: number}
				onZoom(scale / (gesture ?? 1), clientX, clientY)
				gesture = scale
			},
			options,
		)
		element.addEventListener('gestureend', (event) => (event.preventDefault(), (gesture = undefined)), options)
	}
	element.addEventListener(
		'wheel',
		(event) => {
			if (!event.ctrlKey && gesture === undefined) return
			event.preventDefault()
			// Safari sends the wheel alongside its gesture, which already zooms
			if (gesture !== undefined) return
			const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY
			onZoom(Math.exp(-Math.min(25, Math.max(-25, delta)) / 100), event.clientX, event.clientY)
		},
		options,
	)
}
