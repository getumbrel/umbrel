import {Link} from 'react-router-dom'

import {buttonClass} from '@/layouts/bare/shared'
import {bareContainerClass, BareLogoTitle, BareSpacer, bareTextClass} from '@/modules/bare/shared'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

export function Success() {
	const title = t('factory-reset.success.title')
	return (
		<div className={bareContainerClass}>
			<BareLogoTitle>{title}</BareLogoTitle>
			<p className={cn(bareTextClass, 'w-[80%] sm:w-[55%]')}>{t('factory-reset.success.description')}</p>
			<BareSpacer />
			{/* Skip client side routing and reload to refresh state */}
			<Link reloadDocument to='/' className={buttonClass}>
				{t('continue')}
			</Link>
		</div>
	)
}
