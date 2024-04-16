import {Link, To} from 'react-router-dom'

import {buttonClass} from '@/layouts/bare/shared'
import {bareContainerClass, BareLogoTitle, BareSpacer, bareTextClass} from '@/modules/bare/shared'
import {cn} from '@/shadcn-lib/utils'

export function SuccessLayout({
	title,
	description,
	buttonText,
	to,
	buttonOnClick,
}: {
	title: string
	description: string
	buttonText: string
	to?: To
	buttonOnClick?: () => void
}) {
	return (
		<div className={cn(bareContainerClass, 'h-auto w-auto duration-1000 animate-in fade-in zoom-in-95')}>
			<BareLogoTitle>{title}</BareLogoTitle>
			<p className={cn(bareTextClass, 'w-[80%] sm:w-[55%]')}>{description}</p>
			<BareSpacer />
			{to && (
				<Link to={to} className={buttonClass} onClick={buttonOnClick}>
					{buttonText}
				</Link>
			)}
			{!to && (
				<button className={buttonClass} onClick={buttonOnClick}>
					{buttonText}
				</button>
			)}
		</div>
	)
}
