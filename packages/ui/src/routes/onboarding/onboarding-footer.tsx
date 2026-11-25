import {Globe} from 'lucide-react'
import {useTranslation} from 'react-i18next'
import {TbHistory, TbMessageCircle, TbUser} from 'react-icons/tb'

import {ChevronDown} from '@/components/chevron-down'
import {IconButton} from '@/components/ui/icon-button'
import {IconButtonLink} from '@/components/ui/icon-button-link'
import {links} from '@/constants/links'
import {useLanguage} from '@/hooks/use-language'
import {LanguageDropdown} from '@/routes/settings/_components/language-dropdown'
import {languages} from '@/utils/language'

export enum OnboardingAction {
	CREATE_ACCOUNT = 'create-account',
	RESTORE = 'restore',
}

interface OnboardingFooterProps {
	action: OnboardingAction
}

// Custom footer button class for onboarding - override default border from buttonVariants,
// which Increase contrast brings back as the buttons' edge
const footerButtonClass = 'bg-white/[0.06] border-0 contrast-more:border'

export function OnboardingFooter({action}: OnboardingFooterProps) {
	const {t} = useTranslation()
	const isCreateAccount = action === OnboardingAction.CREATE_ACCOUNT
	const route = isCreateAccount ? '/onboarding/create-account' : '/onboarding/restore'
	const Icon = isCreateAccount ? TbUser : TbHistory

	return (
		<div className='flex flex-row flex-wrap items-center justify-center gap-3'>
			{/* One link styled as a button (not a button inside a link, which made two tab stops) */}
			<IconButtonLink to={route} viewTransition icon={Icon} size='default' className={footerButtonClass}>
				{/* Small screens: with short text */}
				<span className='sm:hidden'>
					{/* Using explicit conditionals instead of dynamic keys so GitHub Action for translations can detect translation keys */}
					{isCreateAccount ? t('onboarding.create-instead-short') : t('onboarding.restore-short')}
				</span>
				{/* Larger screens: with full text */}
				<span className='hidden sm:inline'>
					{/* Using explicit conditionals instead of dynamic keys so GitHub Action for translations can detect translation keys */}
					{isCreateAccount ? t('onboarding.create-instead-long') : t('onboarding.restore-long')}
				</span>
			</IconButtonLink>
			{/* TODO: consider adding drawer on mobile */}
			<OnboardingLanguageDropdown />
			<IconButtonLink
				to={links.support}
				target='_blank'
				icon={TbMessageCircle}
				size='default'
				className={footerButtonClass}
			>
				{t('onboarding.contact-support')}
			</IconButtonLink>
		</div>
	)
}

// Custom language dropdown trigger just for onboarding footer with custom styling
function OnboardingLanguageDropdown() {
	const [activeCode] = useLanguage()

	return (
		<LanguageDropdown>
			<IconButton icon={Globe} className={footerButtonClass}>
				{languages.find(({code}) => code === activeCode)?.name}
				<ChevronDown />
			</IconButton>
		</LanguageDropdown>
	)
}
