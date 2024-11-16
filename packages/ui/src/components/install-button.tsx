import {TbLoader} from 'react-icons/tb'
import {arrayIncludes} from 'ts-extras'

import {ProgressButton} from '@/components/progress-button'
import {UNKNOWN} from '@/constants'
import {cn} from '@/shadcn-lib/utils'
import {AppStateOrLoading} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
import {assertUnreachable} from '@/utils/misc'
// import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

import {AnimatedNumber} from './ui/animated-number'

type Props = {
	installSize?: string
	progress?: number
	state: AppStateOrLoading
	compatible?: boolean
	onInstallClick?: () => void
	onOpenClick?: () => void
}

export function InstallButton({installSize, progress, state, onInstallClick, onOpenClick, ...props}: Props) {
	return (
		<ProgressButton
			variant={state === 'updating' ? 'default' : 'primary'}
			size='lg'
			state={state}
			progress={progress}
			onClick={() => {
				if (state === 'not-installed') {
					onInstallClick?.()
				} else if (state === 'ready') {
					onOpenClick?.()
				}
			}}
			className='hover:bg-brand-lighter max-md:h-[30px] max-md:w-full max-md:text-13'
			style={{
				['--progress-button-bg' as string]: state === 'updating' ? 'hsl(0 0 30%)' : 'hsl(var(--color-brand))',
			}}
			disabled={!arrayIncludes(['not-installed', 'ready'], state)}
			initial={{borderRadius: 9999}}
			{...props}
		>
			<ButtonContentForState state={state} installSize={installSize} progress={progress} />
		</ProgressButton>
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
			return t('app.restarting') + '...'
		case 'restarting':
			return t('app.starting') + '...'
		case 'stopping':
			return t('app.stopping') + '...'
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
	tw`select-none whitespace-nowrap disabled:bg-brand/60 disabled:opacity-100 bg-brand hover:bg-brand-lighter`,
	tw`max-md:h-[30px] max-md:w-full max-md:text-13`,
)
