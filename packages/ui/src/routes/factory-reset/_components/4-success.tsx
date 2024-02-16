import {Link} from 'react-router-dom'

import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {buttonClass} from '@/layouts/bare/shared'
import {bareContainerClass, BareLogoTitle, BareSpacer, bareTextClass} from '@/modules/bare/shared'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

import {factoryResetTitle} from './misc'

// TODO: start using when necessary
export function Success() {
	const title = t('factory-reset.success.title')
	useUmbrelTitle(factoryResetTitle(title))
	return (
		<div className={bareContainerClass}>
			<BareLogoTitle>{title}</BareLogoTitle>
			<p className={cn(bareTextClass, 'w-[80%] sm:w-[55%]')}>{t('factory-reset.success.description')}</p>
			<BareSpacer />
			<Link to='/restart' className={buttonClass}>
				{t('factory-reset.success.restart-device')}
			</Link>
		</div>
	)
}
