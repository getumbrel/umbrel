import {VariantProps} from 'class-variance-authority'
import {ButtonHTMLAttributes, CSSProperties, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {arrayIncludes} from 'ts-extras'

import {buttonVariants} from '@/components/ui/button'
import {cn} from '@/lib/utils'
import {AppStateOrLoading, progressBarStates} from '@/trpc/trpc'

// Check if CSS available
// https://developer.mozilla.org/en-US/docs/Web/API/CSS/registerProperty
if (typeof CSS !== 'undefined' && CSS.registerProperty) {
	CSS.registerProperty({
		name: '--progress-button-progress',
		syntax: '<percentage>',
		inherits: false,
		initialValue: '0%',
	})
}

type Props = {
	progress?: number
	state: AppStateOrLoading
} & VariantProps<typeof buttonVariants> &
	ButtonHTMLAttributes<HTMLButtonElement>

const WIDTH_SLIDE_MS = 300

/**
 * An app action button (Install / Open / Update…) whose background can fill
 * with live progress during a transition. Deliberately a plain, intrinsically
 * sized button: the label stays visible and progress is a CSS custom property,
 * so grids can render many instances without layout measurement observers.
 * When the label changes width with the state, the button slides between the
 * two intrinsic widths (see useSlideWidthOnStateChange).
 */
export function ProgressButton({variant, size, progress, state, children, className, style, ...buttonProps}: Props) {
	const progressing = arrayIncludes(progressBarStates, state)
	const ref = useSlideWidthOnStateChange(state)

	// Stops flicker when progressing done
	const [progressingDone, setProgressingDone] = useState(true)
	useEffect(() => {
		if (state === 'ready') {
			setTimeout(() => setProgressingDone(true), 0)
		} else if (progressing) {
			setProgressingDone(false)
		}
	}, [state, progressing])

	const progressingStyle: CSSProperties = {
		['--progress-button-progress' as string]: `${Math.round(progress ?? 0)}%`,
		backgroundImage:
			'linear-gradient(to right, var(--progress-button-bg) var(--progress-button-progress), transparent var(--progress-button-progress))',
		backgroundColor: 'color-mix(in srgb, var(--progress-button-bg) 60%, transparent)',
		opacity: 1,
	}

	return (
		<button
			ref={ref}
			data-progressing={progressing}
			className={cn(
				buttonVariants({size, variant}),
				'overflow-hidden whitespace-nowrap transition-[background-color,opacity,--progress-button-progress] duration-300 ease-out disabled:opacity-60',
				state === 'loading' && '!bg-white/10',
				// Disable transition right when installing done for a sec to prevent flicker
				state === 'ready' && !progressingDone && 'transition-none',
				className,
			)}
			style={{
				...(progressing ? progressingStyle : undefined),
				...style,
			}}
			{...buttonProps}
			disabled={isProgressButtonDisabled(state, buttonProps.disabled)}
		>
			<span className='flex w-max items-center'>{children}</span>
		</button>
	)
}

/**
 * Slides the button's width between its intrinsic widths when `state` changes
 * the label ("Install 120 MB" → "Installing 40%" → "Open"). The label only
 * changes with the state, so this measures once per change — a single layout
 * read after the commit — and runs one Web Animation from the previously
 * measured width to the new one; when it finishes the width is intrinsic
 * again. No observer and no work between changes, so the catalog grids can
 * render many of these.
 */
function useSlideWidthOnStateChange(state: AppStateOrLoading) {
	const ref = useRef<HTMLButtonElement>(null)
	const stateRef = useRef<AppStateOrLoading | null>(null)
	const widthRef = useRef<number | null>(null)
	const slideRef = useRef<Animation | null>(null)

	useLayoutEffect(() => {
		const el = ref.current
		if (!el || typeof el.animate !== 'function') return
		const stateChanged = stateRef.current !== state
		stateRef.current = state

		if (!stateChanged) {
			// The label can change on its own too (the install size arriving, a
			// language switch, fonts loading): keep the measurement fresh so the
			// next slide starts from the right place, but never disturb a running one
			if (!slideRef.current) widthRef.current = el.offsetWidth
			return
		}

		// Start from wherever a still-running slide got to, then let the width
		// go intrinsic to measure the new label
		const from = slideRef.current ? el.getBoundingClientRect().width : widthRef.current
		slideRef.current?.cancel()
		slideRef.current = null
		const to = el.offsetWidth
		widthRef.current = to
		// Nothing to slide from on first layout or while not laid out, and nothing to
		// do when the label kept its width or the button fills its row (the phone form)
		if (!from || !to || Math.abs(from - to) < 0.5) return

		const slide = el.animate([{width: `${from}px`}, {width: `${to}px`}], {
			duration: WIDTH_SLIDE_MS,
			easing: 'cubic-bezier(0.29, 0.01, 0, 1)',
		})
		slide.onfinish = slide.oncancel = () => {
			if (slideRef.current === slide) slideRef.current = null
		}
		slideRef.current = slide
	})

	useEffect(() => () => slideRef.current?.cancel(), [])

	return ref
}

/** Loading and lifecycle transitions are never interactive, regardless of caller props. */
export function isProgressButtonDisabled(state: AppStateOrLoading, callerDisabled = false) {
	return (
		callerDisabled ||
		arrayIncludes(
			['loading', 'installing', 'updating', 'uninstalling', 'starting', 'restarting', 'stopping'] as const,
			state,
		)
	)
}
