import {useTranslation} from 'react-i18next'

import {Badge} from '@/components/ui/badge'

export function CommunityBadge({className}: {className?: string}) {
	const {t} = useTranslation()
	return (
		<Badge variant='primary' className={className}>
			{t('community-app-store')}
		</Badge>
	)
}
