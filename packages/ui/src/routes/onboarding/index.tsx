import {useEffect, useRef} from 'react'
import {Link} from 'react-router-dom'

import {links} from '@/constants/links'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {buttonClass, footerLinkClass, Layout} from '@/layouts/bare/shared'
import {t} from '@/utils/i18n'

export default function OnboardingStart() {
	const title = t('onboarding.start.title')
	useUmbrelTitle(title)
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
				<Link to={links.support} target='_blank' className={footerLinkClass}>
					{t('contact-support')}
				</Link>
			}
		>
			<Link to='/onboarding/1-create-account' unstable_viewTransition className={buttonClass} ref={continueLinkRef}>
				{t('onboarding.start.continue')}
			</Link>
		</Layout>
	)
}
