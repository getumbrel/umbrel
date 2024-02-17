import {motion} from 'framer-motion'
import {CSSProperties, useEffect, useState} from 'react'
import {TbLoader} from 'react-icons/tb'
import {useFirstMountState} from 'react-use'
import {arrayIncludes} from 'ts-extras'

import {UNKNOWN} from '@/constants'
import {buttonVariants} from '@/shadcn-components/ui/button'
import {cn} from '@/shadcn-lib/utils'
import {AppStateOrLoading} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
import {assertUnreachable} from '@/utils/misc'
// import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

import {AnimatedNumber} from './ui/animated-number'

// Check if CSS available
// https://developer.mozilla.org/en-US/docs/Web/API/CSS/registerProperty
if (typeof CSS !== 'undefined' && CSS.registerProperty) {
	CSS.registerProperty({
		name: '--install-button-progress',
		syntax: '<percentage>',
		inherits: false,
		initialValue: '0%',
	})
}

export function InstallButton({
	installSize,
	progress,
	state,
	onInstallClick,
	onOpenClick,
}: {
	installSize?: string
	progress?: number
	state: AppStateOrLoading
	onInstallClick?: () => void
	onOpenClick?: () => void
}) {
	const isFirstRender = useFirstMountState()

	// Stops flicker when installing done
	const [installToReadyDone, setInstallToReadyDone] = useState(true)
	useEffect(() => {
		if (state === 'ready') {
			setTimeout(() => setInstallToReadyDone(true), 0)
		} else if (state === 'installing') {
			setInstallToReadyDone(false)
		}
	}, [state])

	const installingStyle: CSSProperties = {
		// Adding transitions so hover and other transitions work
		transition: '--install-button-progress 0.3s',
		['--install-button-progress' as string]: `${progress}%`,
		backgroundImage:
			'linear-gradient(to right, hsl(var(--color-brand)) var(--install-button-progress), transparent var(--install-button-progress))',
	}

	return (
		<motion.button
			initial={{
				borderRadius: 999,
				// opacity: 0,
			}}
			animate={{
				opacity: 1,
			}}
			onClick={() => {
				if (state === 'not-installed') {
					onInstallClick?.()
				} else if (state === 'ready') {
					onOpenClick?.()
				}
			}}
			className={cn(
				installButtonClass,
				state === 'loading' && '!bg-white/10',
				// Disable transition right when installing done for a sec to prevent flicker
				state === 'ready' && !installToReadyDone && 'transition-none',
			)}
			style={{
				...(state === 'installing' ? installingStyle : undefined),
			}}
			layout
			disabled={!arrayIncludes(['not-installed', 'ready'], state)}
		>
			{/* Child has `layout` too to prevent contenet from being scaled and stretched with the parent */}
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
				<ButtonContentForState state={state} installSize={installSize} progress={progress} />
			</motion.div>
		</motion.button>
	)
}

function ButtonContentForState({
	state,
	installSize,
	progress,
}: {
	state: AppStateOrLoading
	installSize?: string
	progress?: number
}) {
	switch (state) {
		case 'not-installed':
			return (
				<>
					{t('app.install')}{' '}
					<span className='whitespace-nowrap uppercase -tracking-normal opacity-40'>{installSize}</span>
				</>
			)
		case 'installing':
			return (
				<>
					{t('app.installing')} {/*  */}
					{/* 4ch to fit text "100%" */}
					<span className='inline-block w-[4ch] text-right -tracking-[0.08em] opacity-40'>
						{progress === undefined ? UNKNOWN() : <AnimatedNumber to={progress} />}%
					</span>
				</>
			)
		case 'ready':
		case 'running':
			return t('app.open')
		case 'starting':
			return t('app.restarting') + '...'
		case 'restarting':
			return t('app.starting') + '...'
		case 'stopping':
			return t('app.stopping') + '...'
		case 'updating':
			return t('app.updating') + '...'
		case 'uninstalling':
			return t('app.uninstalling') + '...'
		case 'unknown':
		case 'stopped':
			return t('app.offline')
		case 'loading':
		case undefined:
			return <TbLoader className='white h-3 w-3 animate-spin opacity-50 shadow-sm' />
		// return t('loading') + '...'
	}
	return assertUnreachable(state)
}

export const installButtonClass = cn(
	buttonVariants({size: 'lg', variant: 'primary'}),
	tw`select-none whitespace-nowrap disabled:bg-brand/60 disabled:opacity-100 bg-brand hover:bg-brand-lighter`,
	tw`max-md:h-[30px] max-md:w-full max-md:text-13`,
)
