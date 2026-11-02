import {useMotionValueEvent, useReducedMotion, useSpring} from 'motion/react'
import {useCallback, useRef} from 'react'

// 3D hover tilt for card surfaces. The corner under the cursor
// leans toward the viewer; on leave the card settles back to flat. Tuned to
// feel like a weighty, damped tvOS card — not a springy CSS-demo wobble.
//
// Composition notes:
//   • We only return pointer handlers, never a ref. Spreading them onto a
//     surface (e.g. <Glass>, which forwards `...rest` to its host but does NOT
//     forward refs) lets us grab the host from `e.currentTarget` and mutate its
//     `transform` directly — no wrapper element, so nothing touches the desktop
//     grid layout, drag surfaces or focus ring.
//   • We write only the CSS `transform` property. Tailwind's `hover:scale-105`
//     (and `active:scale-95`) compile to the separate `scale` property, so the
//     scale-up and this tilt compose on the same element without clobbering
//     each other or the `transition-[scale]` that animates the scale.
//   • Motion is driven through spring-smoothed motion values written to the DOM
//     in a `change` subscription — no React state per pointermove, so nothing
//     re-renders while the cursor moves (React Compiler safe).

type TiltOptions = {
	/** Max tilt at the very edges, in degrees. */
	maxTiltDeg?: number
	/** `perspective()` distance in px — smaller is more dramatic. */
	perspectivePx?: number
}

// A weighty, slightly over-damped spring: reaches the target with authority and
// settles flat on exit without any overshoot wobble.
const SPRING = {stiffness: 210, damping: 26, mass: 0.7, restDelta: 0.001} as const

export function useTilt({maxTiltDeg = 7, perspectivePx = 900}: TiltOptions = {}) {
	const prefersReducedMotion = useReducedMotion()

	// Springs hold the live rotation; the host element they drive is captured
	// from the pointer event so we never need a forwarded ref.
	const rotateX = useSpring(0, SPRING)
	const rotateY = useSpring(0, SPRING)
	const hostRef = useRef<HTMLElement | null>(null)

	const apply = useCallback(() => {
		const host = hostRef.current
		if (!host) return
		const x = rotateX.get()
		const y = rotateY.get()
		// Settled flat: drop the transform rather than leave a flat card in a 3D
		// perspective context, which keeps it on its own compositing surface
		// (and Firefox re-rendering it through that surface) long after the hover
		host.style.transform = x === 0 && y === 0 ? '' : `perspective(${perspectivePx}px) rotateX(${x}deg) rotateY(${y}deg)`
	}, [perspectivePx, rotateX, rotateY])

	useMotionValueEvent(rotateX, 'change', apply)
	useMotionValueEvent(rotateY, 'change', apply)

	const onPointerMove = useCallback(
		(e: React.PointerEvent<HTMLElement>) => {
			// Mouse only — touch/pen never tilt.
			if (prefersReducedMotion || e.pointerType !== 'mouse') return
			hostRef.current = e.currentTarget
			const rect = e.currentTarget.getBoundingClientRect()
			if (rect.width === 0 || rect.height === 0) return
			// -1 … 1 from the card centre.
			const px = ((e.clientX - rect.left) / rect.width) * 2 - 1
			const py = ((e.clientY - rect.top) / rect.height) * 2 - 1
			// Bottom cursor → bottom edge forward (+rotateX); right cursor → right
			// edge forward (−rotateY): the corner under the cursor rises toward you.
			rotateX.set(py * maxTiltDeg)
			rotateY.set(-px * maxTiltDeg)
		},
		[prefersReducedMotion, maxTiltDeg, rotateX, rotateY],
	)

	const onPointerLeave = useCallback(() => {
		rotateX.set(0)
		rotateY.set(0)
	}, [rotateX, rotateY])

	return {onPointerMove, onPointerLeave}
}
