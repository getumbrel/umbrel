import FailedLayout from '@/modules/bare/failed-layout'
import {t} from '@/utils/i18n'

export function Failed() {
	const title = t('factory-reset.failed.title')

	return (
		<FailedLayout
			title={title}
			description={
				<>
					{t('factory-reset.failed.message')}
				</>
			}
			buttonText={t('factory-reset.failed.retry')}
			to='/factory-reset'
		/>
	)
}
