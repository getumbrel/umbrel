import {TbHistory, TbMessageCircle, TbUser} from 'react-icons/tb'
import {Link} from 'react-router-dom'

import {IconButton} from '@/components/ui/icon-button'
import {links} from '@/constants/links'
import {LanguageDropdown} from '@/routes/settings/_components/language-dropdown'
import {t} from '@/utils/i18n'

export enum OnboardingAction {
	CREATE_ACCOUNT = 'create-account',
	RESTORE = 'restore',
}

interface OnboardingFooterProps {
	action: OnboardingAction
}

export function OnboardingFooter({action}: OnboardingFooterProps) {
	const isCreateAccount = action === OnboardingAction.CREATE_ACCOUNT
	const route = isCreateAccount ? '/onboarding/create-account' : '/onboarding/restore'
	const Icon = isCreateAccount ? TbUser : TbHistory

	return (
		<div className='flex flex-row flex-wrap items-center justify-center gap-3'>
			<Link to={route} unstable_viewTransition>
				{/* Small screens: with short text */}
				<IconButton icon={Icon} size='default' className='sm:hidden'>
					{/* Using explicit conditionals instead of dynamic keys so GitHub Action for translations can detect translation keys */}
					{isCreateAccount ? t('onboarding.create-instead-short') : t('onboarding.restore-short')}
				</IconButton>
				{/* Larger screens: with full text */}
				<IconButton icon={Icon} size='default' className='hidden sm:flex'>
					{/* Using explicit conditionals instead of dynamic keys so GitHub Action for translations can detect translation keys */}
					{isCreateAccount ? t('onboarding.create-instead-long') : t('onboarding.restore-long')}
				</IconButton>
			</Link>
			{/* TODO: consider adding drawer on mobile */}
			<LanguageDropdown />
			<Link to={links.support} target='_blank'>
				<IconButton icon={TbMessageCircle} size='default'>
					{t('onboarding.contact-support')}
				</IconButton>
			</Link>
		</div>
	)
}
