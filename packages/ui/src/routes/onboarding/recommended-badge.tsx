import {useTranslation} from 'react-i18next'
import {IoShieldHalf} from 'react-icons/io5'

import {cn} from '@/lib/utils'

// Shield "Recommended" tag shared by the FailSafe toggle and the Pi drive choice card
export function RecommendedBadge({className, small = false}: {className?: string; small?: boolean}) {
	const {t} = useTranslation()
	return (
		<div
			className={cn(
				'flex items-center rounded-full bg-white/10',
				small ? 'gap-1 px-2.5 py-0.5' : 'gap-1.5 px-3 py-1',
				className,
			)}
		>
			<IoShieldHalf className={cn('text-white', small ? 'size-3.5' : 'size-4')} />
			<span className={cn('text-white', small ? 'text-12' : 'text-13')}>{t('onboarding.raid.recommended')}</span>
		</div>
	)
}
