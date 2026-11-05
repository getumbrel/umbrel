import {useTranslation} from 'react-i18next'

import UmbrelLogo from '@/components/umbrel-logo'
import {cn} from '@/lib/utils'
import {greetingMessage} from '@/modules/desktop/greeting-message'

export function Header({userName, inline = false}: {userName: string; inline?: boolean}) {
	const {t} = useTranslation()
	const name = userName
	// Always rendering the entire component to avoid layout thrashing
	return (
		<div className={cn('relative z-10', name ? '' : 'invisible')}>
			{/* Sized by the --home-* variables in index.css, which follow height as well as width */}
			<div
				className={cn('flex items-center px-4', !inline && 'flex-col')}
				style={{gap: inline ? '0.5em' : 'calc(var(--home-gap) / 2)', fontSize: 'var(--home-title)'}}
			>
				<UmbrelLogo style={{width: inline ? '1.6em' : 'var(--home-logo)'}} />
				<h1 className='text-center leading-tight font-bold'>{greetingMessage(name, t)}</h1>
			</div>
		</div>
	)
}
