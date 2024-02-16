import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import FailedLayout from '@/modules/bare/failed-layout'
import {t} from '@/utils/i18n'

import {factoryResetTitle} from './misc'

export function Failed() {
	const title = t('factory-reset.failed.title')
	useUmbrelTitle(factoryResetTitle(title))

	return (
		<FailedLayout
			title={title}
			description={
				<>
					{t('factory-reset.failed.message')}
					<br />
					{t('factory-reset.failed.message.please-try-again')}
				</>
			}
			buttonText={t('factory-reset.failed.retry')}
			to='/factory-reset'
		/>
	)
}
