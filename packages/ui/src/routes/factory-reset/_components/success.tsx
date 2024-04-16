import {Link} from 'react-router-dom'

import {buttonClass} from '@/layouts/bare/shared'
import {bareContainerClass, BareLogoTitle, BareSpacer, bareTextClass} from '@/modules/bare/shared'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

// TODO: start using when necessary
export function Success() {
	const title = t('factory-reset.success.title')
	return (
		<div className={bareContainerClass}>
			<BareLogoTitle>{title}</BareLogoTitle>
			<p className={cn(bareTextClass, 'w-[80%] sm:w-[55%]')}>{t('factory-reset.success.description')}</p>
			<BareSpacer />
			<Link to='/' className={buttonClass} onClick={() => alert('TODO: implement')}>
				{t('factory-reset.success.restart-device')}
			</Link>
		</div>
	)
}
