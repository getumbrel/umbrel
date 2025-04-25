import {useEffect, useRef} from 'react'
import {Link} from 'react-router-dom'

import {links} from '@/constants/links'
import {useLanguage} from '@/hooks/use-language'
import {buttonClass, footerLinkClass, Layout} from '@/layouts/bare/shared'
import {LanguageDropdown} from '@/routes/settings/_components/language-dropdown'
import {t} from '@/utils/i18n'
import {supportedLanguageCodes} from '@/utils/language'

// Attempt to auto-select a suitable language from the user's browser preferences
function useAutoDetectLanguage() {
	const [, setLang] = useLanguage()

	useEffect(() => {
		// Only run once
		if (sessionStorage.getItem('temporary-language')) {
			return
		}

		// Get the browser language codes (eg. ['en-US', 'jp'])
		const {languages: browserLanguageCodes} = navigator
		if (!Array.isArray(browserLanguageCodes)) return

		// Try to find a supported language code
		for (const languageCode of browserLanguageCodes) {
			const baseCode = languageCode.split('-')[0] // eg. 'en'

			// If we support the language, set it
			if ((supportedLanguageCodes as readonly string[]).includes(baseCode)) {
				setLang(baseCode as any)
				sessionStorage.setItem('temporary-language', baseCode)
				break
			}
		}
	}, [])
}

export default function OnboardingStart() {
	const title = t('onboarding.start.title')
	const continueLinkRef = useRef<HTMLAnchorElement>(null)

	// Auto detect browser language once to set the default language
	useAutoDetectLanguage()

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
				<div className='flex flex-col items-center gap-3'>
					{/* TODO: consider adding drawer on mobile */}
					<LanguageDropdown />
					<Link to={links.support} target='_blank' className={footerLinkClass}>
						{t('onboarding.contact-support')}
					</Link>
				</div>
			}
		>
			<Link to='/onboarding/create-account' unstable_viewTransition className={buttonClass} ref={continueLinkRef}>
				{t('onboarding.start.continue')}
			</Link>
		</Layout>
	)
}
