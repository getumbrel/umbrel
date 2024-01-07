import {ReactNode} from 'react'
import {take} from 'remeda'
import urlJoin from 'url-join'

import {WidgetContainer} from './shared/shared'
import {StatText} from './shared/stat-text'
import {TablerIcon} from './shared/tabler-icon'

export function StatWithButtonsWidget({
	appUrl,
	title,
	value,
	valueSub,
	buttons,
}: {
	appUrl?: string
	title?: string
	value?: string
	valueSub?: string
	buttons?: {
		icon: string
		title: string
		link: string
	}[]
}) {
	return (
		<WidgetContainer className='gap-0 p-2 md:p-5'>
			<StatText title={title} value={value} valueSub={valueSub} />
			<div className='flex-1' />
			<div className='flex flex-col gap-1 md:flex-row'>
				{buttons &&
					take(buttons, 3).map((button) => (
						// Not using endpoint for `key` in case user wants two buttons to link to the same endpoint for some reason
						<WidgetButtonLink key={button.title} href={urlJoin(appUrl || '', button.link)}>
							<TablerIcon iconName={button.icon} className='mr-1 h-4 w-4 [&>svg]:h-4 [&>svg]:w-4' />
							<span className='truncate'>{button.title}</span>
						</WidgetButtonLink>
					))}
			</div>
		</WidgetContainer>
	)
}

function WidgetButtonLink({href, children}: {href: string; children: ReactNode}) {
	return (
		<a
			href={href}
			target='_blank'
			className='flex h-[24px] min-w-0 flex-1 cursor-pointer select-none items-center justify-center rounded-5 bg-white/5 px-2.5 text-12 font-medium transition-colors hover:bg-white/10 active:bg-white/5 md:h-[30px] md:rounded-full'
		>
			{children}
		</a>
	)
}
