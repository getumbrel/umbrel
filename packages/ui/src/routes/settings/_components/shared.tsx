import {Trans} from 'react-i18next/TransWithoutContext'
import {Link} from 'react-router-dom'

import {links} from '@/constants/links'
import {cn} from '@/shadcn-lib/utils'
import {linkClass} from '@/utils/element-classes'
import {tw} from '@/utils/tw'

export const cardTitleClass = tw`text-12 font-semibold leading-none -tracking-2 text-white/40`
export const cardValueClass = tw`text-17 font-bold leading-inter-trimmed -tracking-4`
export const cardValueSubClass = tw`text-14 font-bold leading-inter-trimmed -tracking-3 text-white/40`
export const cardSecondaryValueClass = tw`text-14 hidden md:block font-medium truncate leading-inter-trimmed -tracking-3 text-white/40`
export const cardErrorClass = cn(cardSecondaryValueClass, tw`animate-pulse leading-tight text-destructive2-lightest`)

export function ContactSupportLink({className}: {className?: string}) {
	return (
		<p className={cn('mx-auto text-12 font-normal text-white/70', className)}>
			<Trans
				i18nKey='settings.contact-support'
				components={{
					linked: <Link to={links.support} className={linkClass} target='_blank' />,
				}}
			/>
		</p>
	)
}
