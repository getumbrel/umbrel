import {Badge} from '@/shadcn-components/ui/badge'

export function CommunityBadge({className}: {className?: string}) {
	return (
		<Badge variant='primary' className={className}>
			Community App Store
		</Badge>
	)
}
