import {Helmet} from 'react-helmet'

import {t} from '@/utils/i18n'

export function UmbrelHeadTitle({children}: {children: string}) {
	const title = children
	return (
		<Helmet>
			<title>{t('page-title-umbrel', {title})}</title>
		</Helmet>
	)
}
