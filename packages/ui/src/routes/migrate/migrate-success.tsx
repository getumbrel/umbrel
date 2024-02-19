import {Link} from 'react-router-dom'

import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {buttonClass} from '@/layouts/bare/shared'
import {bareContainerClass, BareLogoTitle, BareSpacer, bareTextClass} from '@/modules/bare/shared'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

export default function MigrateSuccess() {
	const title = t('migrate.success.title')

	return (
		<div className={cn(bareContainerClass, 'h-auto w-auto duration-1000 animate-in fade-in zoom-in-95')}>
			<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
			<BareLogoTitle>{title}</BareLogoTitle>
			<p className={cn(bareTextClass, 'w-[80%] sm:w-[55%]')}>{t('migrate.success.description')}</p>
			<BareSpacer />
			<Link to='/' className={buttonClass}>
				{t('migrate.success.continue-to-log-in')}
			</Link>
		</div>
	)
}
