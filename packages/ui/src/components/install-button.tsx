import {motion} from 'framer-motion'
import {CSSProperties} from 'react'
import {TbLoader} from 'react-icons/tb'
import {arrayIncludes} from 'ts-extras'

import {UNKNOWN} from '@/constants'
import {buttonVariants} from '@/shadcn-components/ui/button'
import {cn} from '@/shadcn-lib/utils'
import {AppState} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

import {AnimatedNumber} from './ui/animated-number'

type InstallState = 'loading' | 'uninstalled' | AppState

export function InstallButton({
	installSize,
	progress,
	state,
	onInstallClick,
	onOpenClick,
}: {
	installSize?: string
	progress?: number
	state: InstallState
	onInstallClick?: () => void
	onOpenClick?: () => void
}) {
	// if (state === 'loading') {
	// 	return (
	// 		<button className={cn(installButtonClass, '!bg-transparent')} disabled>
	// 			<TbLoader className='white h-3 w-3 animate-spin opacity-50 shadow-sm' />
	// 		</button>
	// 	)
	// }

	const installingStyle: CSSProperties = {
		// Adding transitions so hover and other transitions work
		transition:
			state === ('installing' || 'ready')
				? '--progress 0.2s, opacity 0.2s, width 0.2s, background-color 0.2s'
				: 'width 0.2s, background-color 0.2s',
		['--progress' as string]: `${progress}%`,
		backgroundImage:
			state === 'installing'
				? `linear-gradient(to right, hsl(var(--color-brand)) var(--progress), transparent var(--progress))`
				: undefined,
	}

	return (
		<motion.button
			initial={{
				borderRadius: 999,
				opacity: 0,
				// scale: 1.1,
			}}
			animate={{
				opacity: 1,
				// scale: 1,
			}}
			onClick={() => {
				if (state === 'uninstalled') {
					onInstallClick?.()
				} else if (state === 'ready') {
					onOpenClick?.()
				}
			}}
			className={cn(installButtonClass)}
			style={arrayIncludes(['uninstalled', 'installing', 'ready'], state) ? installingStyle : undefined}
			layout
			disabled={!arrayIncludes(['uninstalled', 'ready'], state)}
		>
			<motion.div
				layout='position'
				initial={{width: 'auto', opacity: 0}}
				animate={{width: 'auto', opacity: 1, transition: {opacity: {delay: 0}}}}
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
	state: InstallState
	installSize?: string
	progress?: number
}) {
	switch (state) {
		case 'uninstalled':
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
			return t('app.open')
		case 'offline':
			return t('app.offline')
		case 'uninstalling':
			return t('app.uninstalling') + '...'
		case 'updating':
			return t('app.updating') + '...'
		case 'loading':
		default:
			// return <TbLoader className='white h-3 w-3 animate-spin opacity-50 shadow-sm' />
			return t('loading') + '...'
	}
}

export const installButtonClass = cn(
	buttonVariants({size: 'lg', variant: 'primary'}),
	tw`select-none text-13 md:text-15 max-md:w-full font-semibold -tracking-3 whitespace-nowrap disabled:bg-brand/60 disabled:opacity-100 max-md:h-[30px] rounded-none`,
)
