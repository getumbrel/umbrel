import {VariantProps} from 'class-variance-authority'
import {HTMLMotionProps, motion} from 'framer-motion'
import {CSSProperties, useEffect, useState} from 'react'
import {useFirstMountState} from 'react-use'
import {arrayIncludes} from 'ts-extras'

import {buttonVariants} from '@/shadcn-components/ui/button'
import {cn} from '@/shadcn-lib/utils'
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
	onClick?: () => void
} & VariantProps<typeof buttonVariants> &
	HTMLMotionProps<'button'>

export function ProgressButton({variant, size, progress, state, children, className, style, ...buttonProps}: Props) {
	const isFirstRender = useFirstMountState()
	const progressing = arrayIncludes(progressBarStates, state)

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
		// Adding transitions so hover and other transitions work
		transition: '--progress-button-progress 0.3s',
		// ['--progress-button-bg' as string]: 'var(--color-brand)',
		['--progress-button-progress' as string]: `${Math.round(progress ?? 0)}%`,
		backgroundImage:
			'linear-gradient(to right, var(--progress-button-bg) var(--progress-button-progress), transparent var(--progress-button-progress))',
	}

	return (
		<motion.button
			data-progressing={progressing}
			className={cn(
				buttonVariants({size, variant}),
				'select-none whitespace-nowrap disabled:bg-opacity-60 disabled:opacity-100',
				state === 'loading' && '!bg-white/10',
				// Disable transition right when installing done for a sec to prevent flicker
				state === 'ready' && !progressingDone && 'transition-none',
				className,
			)}
			style={{
				...(progressing ? progressingStyle : undefined),
				...style,
			}}
			layout
			disabled={!arrayIncludes(['not-installed', 'ready'], state)}
			{...buttonProps}
		>
			{/* Child has `layout` too to prevent content from being scaled and stretched with the parent */}
			{/* https://codesandbox.io/p/sandbox/framer-motion-2-scale-correction-z4tgr?file=%2Fsrc%2FApp.js&from-embed= */}
			<motion.div
				layout='position'
				key={state}
				initial={{opacity: 0}}
				animate={{
					opacity: 1,
					transition: {opacity: {duration: 0.2, delay: state === 'loading' || isFirstRender ? 0 : 0.2}},
				}}
				// className='bg-red-500/50'
			>
				{children}
			</motion.div>
		</motion.button>
	)
}
