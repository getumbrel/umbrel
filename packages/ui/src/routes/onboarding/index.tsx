import {useEffect, useRef} from 'react'
import {Link} from 'react-router-dom'

import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {buttonClass, footerLinkClass, Layout} from '@/layouts/bare/shared'
import {links} from '@/links'

export function OnboardingStart() {
	const title = 'Welcome to umbrelOS'
	useUmbrelTitle(title)
	const continueLinkRef = useRef<HTMLAnchorElement>(null)

	useEffect(() => {
		continueLinkRef.current?.focus()
	}, [])

	return (
		<Layout
			title={title}
			transitionTitle={false}
			subTitle='Your home server is ready to set up.'
			subTitleMaxWidth={500}
			footer={
				<Link to={links.support} target='_blank' className={footerLinkClass}>
					Contact support
				</Link>
			}
		>
			<Link to='/onboarding/1-create-account' unstable_viewTransition className={buttonClass} ref={continueLinkRef}>
				Start
			</Link>
		</Layout>
	)
}
