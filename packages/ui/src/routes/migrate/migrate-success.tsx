import {SuccessLayout} from '@/modules/bare/success-layout'
import {t} from '@/utils/i18n'

export default function MigrateSuccess() {
	const title = t('migrate.success.title')

	return (
		<SuccessLayout title={title} description={t('migrate.success.description')} buttonText={t('continue-to-log-in')} />
	)
}
