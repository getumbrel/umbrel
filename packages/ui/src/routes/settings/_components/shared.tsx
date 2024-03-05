import {Trans} from 'react-i18next/TransWithoutContext'
import {RiAlarmWarningFill} from 'react-icons/ri'
import {Link} from 'react-router-dom'

import {ErrorAlert} from '@/components/ui/alert'
import {links} from '@/constants/links'
import {cn} from '@/shadcn-lib/utils'
import {linkClass} from '@/utils/element-classes'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

export const cardTitleClass = tw`text-12 font-semibold leading-tight truncate -tracking-2 text-white/40`
export const cardValueClass = tw`font-bold -tracking-4 truncate text-17 leading-inter-trimmed`
export const cardValueSubClass = tw`text-14 font-bold truncate leading-inter-trimmed -tracking-3 text-white/40`
export const cardSecondaryValueBaseClass = tw`text-14 font-medium -tracking-3 text-white/40 leading-inter-trimmed`
export const cardSecondaryValueClass = cn(cardSecondaryValueBaseClass, tw`truncate flex-shrink-full`)
export const cardErrorClass = cn(cardSecondaryValueBaseClass, tw`animate-pulse leading-snug text-destructive2-lightest`)

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

export function ChangePasswordWarning() {
	return <ErrorAlert icon={RiAlarmWarningFill} description={t('change-password.callout')} />
}
