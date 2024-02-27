import {useEffect, useRef} from 'react'
import {Link} from 'react-router-dom'

import {links} from '@/constants/links'
import {buttonClass, footerLinkClass, Layout} from '@/layouts/bare/shared'
import {LanguageDropdown} from '@/routes/settings/_components/language-dropdown'
import {t} from '@/utils/i18n'

export default function OnboardingStart() {
	const title = t('onboarding.start.title')
	const continueLinkRef = useRef<HTMLAnchorElement>(null)

	useEffect(() => {
		continueLinkRef.current?.focus()
	}, [])

	return (
		<Layout
			title={title}
			transitionTitle={false}
			subTitle={t('onboarding.start.subtitle')}
			subTitleMaxWidth={500}
			footer={
				<>
					<Link to={links.support} target='_blank' className={footerLinkClass}>
						{t('contact-support')}
					</Link>
					{/* TODO: consider adding drawer on mobile */}
					<LanguageDropdown />
				</>
			}
		>
			<Link to='/onboarding/1-create-account' unstable_viewTransition className={buttonClass} ref={continueLinkRef}>
				{t('onboarding.start.continue')}
			</Link>
		</Layout>
	)
}
