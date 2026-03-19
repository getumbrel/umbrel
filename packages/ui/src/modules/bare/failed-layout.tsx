import {ReactNode} from 'react'
import {useTranslation} from 'react-i18next'
import {Link, To} from 'react-router-dom'

import {buttonClass, secondaryButtonClasss} from '@/layouts/bare/shared'
import {cn} from '@/lib/utils'

import {bareContainerClass, BareLogoTitle, BareSpacer, bareTextClass} from './shared'

export default function FailedLayout({
	title,
	description,
	buttonText,
	to,
	buttonOnClick,
}: {
	title: string
	description: ReactNode
	buttonText: string
	to?: To
	buttonOnClick?: () => void
}) {
	const {t} = useTranslation()
	return (
		<div className={cn(bareContainerClass, 'animate-in slide-in-from-bottom-2')}>
			<BareLogoTitle>{title}</BareLogoTitle>
			<BareSpacer />
			<p className={bareTextClass}>{description}</p>
			<BareSpacer />
			{to && (
				<Link to={to} className={buttonClass} onClick={buttonOnClick}>
					{buttonText}
				</Link>
			)}
			{!to && (
				<div className='flex flex-row gap-2.5'>
					<a href='/' className={buttonClass}>
						{t('not-found-404.home')}
					</a>
					<button className={secondaryButtonClasss} onClick={buttonOnClick}>
						{buttonText}
					</button>
				</div>
			)}
		</div>
	)
}
