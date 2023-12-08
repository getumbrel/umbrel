import {Link} from 'react-router-dom'

import {links} from '@/constants/links'
import {cn} from '@/shadcn-lib/utils'
import {linkClass} from '@/utils/element-classes'
import {tw} from '@/utils/tw'

export const cardTitleClass = tw`text-12 font-semibold leading-none -tracking-2 text-white/40`
export const cardValueClass = tw`text-17 font-bold leading-inter-trimmed -tracking-4`
export const cardValueSubClass = tw`text-14 font-bold leading-inter-trimmed -tracking-3 text-white/40`
export const cardSecondaryValueClass = tw`text-14 hidden md:block font-medium leading-inter-trimmed -tracking-3 text-white/40`
export const cardErrorClass = cn(cardSecondaryValueClass, tw`animate-pulse leading-tight text-destructive2-lightest`)

export function ContactSupportLink({className}: {className?: string}) {
	return (
		<div className={cn('mx-auto text-12 font-normal text-white/70', className)}>
			Need help?{' '}
			<Link className={linkClass} to={links.support}>
				Contact support.
			</Link>
		</div>
	)
}
