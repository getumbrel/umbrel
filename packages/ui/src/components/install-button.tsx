import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'
import {arrayIncludes} from 'ts-extras'

import {ProgressButton} from '@/components/progress-button'
import {UNKNOWN} from '@/constants'
import {canStart} from '@/hooks/use-app-install'
import {cn} from '@/lib/utils'
import {AppStateOrLoading} from '@/trpc/trpc'
import {assertUnreachable} from '@/utils/misc'
// import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

import {AnimatedNumber} from './ui/animated-number'

type Props = {
	installSize?: string
	progress?: number
	state: AppStateOrLoading
	onInstallClick?: () => void
	onOpenClick?: () => void
	/** Starts an app that isn't running. Without it (members) the button reads Not running */
	onStartClick?: () => void
	disabled?: boolean
}

export function InstallButton({
	installSize,
	progress,
	state,
	onInstallClick,
	onOpenClick,
	onStartClick,
	disabled,
	...props
}: Props) {
	const action = getInstallButtonAction(state)
	const canAct = action === 'start' ? !!onStartClick : !!action
	return (
		<ProgressButton
			variant={state === 'updating' ? 'default' : 'primary'}
			size='lg'
			state={state}
			progress={progress}
			onClick={() => {
				switch (action) {
					case 'install':
						return onInstallClick?.()
					case 'open':
						return onOpenClick?.()
					case 'start':
						return onStartClick?.()
					case undefined:
						return
				}
			}}
			// Phones (below sm) get the compact full-width form; this is the
			// breakpoint where the app page hero drops the actions to their own
			// row (app-hero.tsx) — keep the two in sync
			className='hover:bg-brand-lighter max-sm:h-[30px] max-sm:w-full max-sm:text-13'
			style={{
				['--progress-button-bg' as string]: state === 'updating' ? 'hsl(0 0 30%)' : 'hsl(var(--color-brand))',
			}}
			disabled={disabled || !canAct}
			{...props}
		>
			<ButtonContentForState state={state} installSize={installSize} progress={progress} startable={!!onStartClick} />
		</ProgressButton>
	)
}

export function getInstallButtonAction(state: AppStateOrLoading): 'install' | 'open' | 'start' | undefined {
	if (state === 'not-installed') return 'install'
	if (arrayIncludes(['ready', 'running'], state)) return 'open'
	// An app that isn't running can't be opened, but it can be started, the
	// same as tapping its home screen icon
	if (canStart(state)) return 'start'
	return undefined
}

function ButtonContentForState({
	state,
	installSize,
	progress,
	startable,
}: {
	state: AppStateOrLoading
	installSize?: string
	progress?: number
	startable: boolean
}) {
	const {t} = useTranslation()
	switch (state) {
		case 'not-installed':
			return (
				<>
					{t('app.install')}{' '}
					<span className='-tracking-normal whitespace-nowrap uppercase opacity-40'>{installSize}</span>
				</>
			)
		case 'installing':
		case 'updating': {
			const text = state === 'updating' ? t('app.updating') : t('app.installing')
			return (
				<>
					{text} {/*  */}
					{/* 4ch to fit text "100%" */}
					<span className='inline-block w-[4ch] text-right -tracking-[0.08em] opacity-40'>
						{progress === undefined ? UNKNOWN() : <AnimatedNumber to={progress} />}%
					</span>
				</>
			)
		}
		case 'ready':
		case 'running':
			return t('app.open')
		case 'starting':
			return t('app.starting') + '…'
		case 'restarting':
			return t('app.restarting') + '…'
		case 'stopping':
			return t('app.stopping') + '…'
		case 'uninstalling':
			return t('app.uninstalling') + '…'
		case 'unknown':
		case 'stopped':
			return startable ? t('start') : t('app.offline')
		case 'loading':
		case undefined:
			return <TbLoader className='white h-3 w-3 animate-spin opacity-50 shadow-xs' />
		// return t('loading') + '…'
	}
	return assertUnreachable(state)
}

export const installButtonClass = cn(
	tw`whitespace-nowrap disabled:bg-brand/60 disabled:opacity-100 bg-brand hover:bg-brand-lighter`,
	tw`max-sm:h-[30px] max-sm:w-full max-sm:text-13`,
)
