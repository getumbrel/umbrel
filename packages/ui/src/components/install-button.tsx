import {CSSProperties, useEffect, useRef} from 'react'
import {arrayIncludes} from 'ts-extras'

import {LOADING_DASH, UNKNOWN} from '@/constants'
import {buttonVariants} from '@/shadcn-components/ui/button'
import {cn} from '@/shadcn-lib/utils'
import {AppState} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

import {AnimatedNumber} from './ui/animated-number'

export function InstallButton({
	installSize,
	progress,
	state,
	onInstallClick,
	onOpenClick,
}: {
	installSize?: string
	progress?: number
	state: 'loading' | 'uninstalled' | AppState
	onInstallClick?: () => void
	onOpenClick?: () => void
}) {
	const ref = useRef<HTMLButtonElement>(null)

	useEffect(() => {
		if (!ref.current) return

		switch (state) {
			case 'uninstalled': {
				const width = ref.current?.offsetWidth
				ref.current.style.width = width + 'px'
				break
			}
			case 'installing': {
				ref.current.style.width = '135px'
				break
			}
			case 'ready': {
				// Size of "Open" state
				ref.current.style.width = '68px'
				break
			}
			default: {
				ref.current.style.width = ''
			}
		}
	}, [state, progress])

	const style: CSSProperties = {
		// Adding transitions so hover and other transitions work
		transition:
			state === 'installing'
				? '--progress 0.2s, opacity 0.2s, width 0.2s, background-color 0.2s'
				: 'width 0.2s, background-color 0.2s',
		['--progress' as string]: `${progress}%`,
		backgroundImage:
			state === 'installing'
				? `linear-gradient(to right, hsl(var(--color-brand)) var(--progress), transparent var(--progress))`
				: undefined,
	}

	return (
		<button
			ref={ref}
			// Make invisible when loading, but reserve space
			className={cn(installButtonClass, state === 'loading' && 'invisible')}
			style={state === 'uninstalled' ? undefined : style}
			onClick={() => {
				if (state === 'uninstalled') {
					onInstallClick?.()
				} else if (state === 'ready') {
					onOpenClick?.()
				}
			}}
			disabled={!arrayIncludes(['uninstalled', 'ready'], state)}
		>
			{state === 'uninstalled' && (
				<>
					{t('app.install')}{' '}
					<span className='whitespace-nowrap uppercase -tracking-normal opacity-40'>{installSize}</span>
				</>
			)}
			{state === 'installing' && (
				<>
					{/* 4ch to fit "100%", tabular-nums so each char is the same width */}
					{t('app.installing')}{' '}
					<span className='w-[4ch] text-right tabular-nums -tracking-[0.08em] opacity-40'>
						{progress === undefined ? UNKNOWN() : <AnimatedNumber to={progress} />}%
					</span>
				</>
			)}
			{state === 'ready' && t('app.open')}
			{state === 'offline' && t('app.offline')}
			{state === 'loading' && LOADING_DASH}
			{state === 'uninstalling' && t('app.uninstalling') + '...'}
		</button>
	)
}

export const installButtonClass = cn(
	buttonVariants({size: 'lg', variant: 'primary'}),
	'select-none text-13 md:text-15 font-semibold -tracking-3 disabled:bg-brand/60 disabled:opacity-100 max-md:min-w-full max-md:h-[30px]',
)
