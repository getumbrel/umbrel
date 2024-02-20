import FailedLayout from '@/modules/bare/failed-layout'
import {t} from '@/utils/i18n'

export default function MigrateFailed() {
	const title = t('migrate.failed.title')

	return (
		<FailedLayout
			title={title}
			description={
				<>
					{t('migrate.failed.description')}
					<br />
					{t('migrate.failed.please-try-again')}
				</>
			}
			buttonText={t('migrate.failed.retry')}
			to='/migrate'
		/>
	)
}
