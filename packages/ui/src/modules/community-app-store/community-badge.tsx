import {Badge} from '@/shadcn-components/ui/badge'
import {t} from '@/utils/i18n'

export function CommunityBadge({className}: {className?: string}) {
	return (
		<Badge variant='primary' className={className}>
			{t('community-app-store')}
		</Badge>
	)
}
