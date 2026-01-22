import {Globe} from 'lucide-react'
import {TbHistory, TbMessageCircle, TbUser} from 'react-icons/tb'
import {Link} from 'react-router-dom'

import {ChevronDown} from '@/assets/chevron-down'
import {IconButton} from '@/components/ui/icon-button'
import {links} from '@/constants/links'
import {useLanguage} from '@/hooks/use-language'
import {LanguageDropdownContent} from '@/routes/settings/_components/language-dropdown'
import {DropdownMenu, DropdownMenuTrigger} from '@/shadcn-components/ui/dropdown-menu'
import {t} from '@/utils/i18n'
import {languages} from '@/utils/language'

export enum OnboardingAction {
	CREATE_ACCOUNT = 'create-account',
	RESTORE = 'restore',
}

interface OnboardingFooterProps {
	action: OnboardingAction
}

// Custom footer button class for onboarding - override default border from buttonVariants
const footerButtonClass = 'bg-white/[0.06] border-0'

export function OnboardingFooter({action}: OnboardingFooterProps) {
	const isCreateAccount = action === OnboardingAction.CREATE_ACCOUNT
	const route = isCreateAccount ? '/onboarding/create-account' : '/onboarding/restore'
	const Icon = isCreateAccount ? TbUser : TbHistory

	return (
		<div className='flex flex-row flex-wrap items-center justify-center gap-3'>
			<Link to={route} unstable_viewTransition>
				{/* Small screens: with short text */}
				<IconButton icon={Icon} size='default' className={`sm:hidden ${footerButtonClass}`}>
					{/* Using explicit conditionals instead of dynamic keys so GitHub Action for translations can detect translation keys */}
					{isCreateAccount ? t('onboarding.create-instead-short') : t('onboarding.restore-short')}
				</IconButton>
				{/* Larger screens: with full text */}
				<IconButton icon={Icon} size='default' className={`hidden sm:flex ${footerButtonClass}`}>
					{/* Using explicit conditionals instead of dynamic keys so GitHub Action for translations can detect translation keys */}
					{isCreateAccount ? t('onboarding.create-instead-long') : t('onboarding.restore-long')}
				</IconButton>
			</Link>
			{/* TODO: consider adding drawer on mobile */}
			<DropdownMenu>
				<OnboardingLanguageDropdownTrigger />
				<LanguageDropdownContent />
			</DropdownMenu>
			<Link to={links.support} target='_blank'>
				<IconButton icon={TbMessageCircle} size='default' className={footerButtonClass}>
					{t('onboarding.contact-support')}
				</IconButton>
			</Link>
		</div>
	)
}

// Custom language dropdown trigger just for onboarding footer with custom styling
function OnboardingLanguageDropdownTrigger() {
	const [activeCode] = useLanguage()

	return (
		<DropdownMenuTrigger asChild>
			<IconButton icon={Globe} className={footerButtonClass}>
				{languages.find(({code}) => code === activeCode)?.name}
				<ChevronDown />
			</IconButton>
		</DropdownMenuTrigger>
	)
}
