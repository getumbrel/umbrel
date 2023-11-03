import {useEffect, useRef} from 'react'
import {Link} from 'react-router-dom'

import {links} from '@/constants/links'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {buttonClass, footerLinkClass, Layout} from '@/layouts/bare/shared'

export function AccountCreated() {
	useUmbrelTitle('Account created')
	const continueLinkRef = useRef<HTMLAnchorElement>(null)

	useEffect(() => {
		continueLinkRef.current?.focus()
	}, [])

	return (
		<Layout
			title='You’re all set, Mayank.'
			subTitle='By clicking Launch below, we take it that you agree to our privacy policy and term of service.'
			subTitleMaxWidth={470}
			footer={
				<>
					<Link to={links.legal.privacy} target='_blank' className={footerLinkClass}>
						Privacy Policy
					</Link>
					<Link to={links.support} target='_blank' className={footerLinkClass}>
						Contact support
					</Link>
					<Link to={links.legal.tos} target='_blank' className={footerLinkClass}>
						Terms of Service
					</Link>
				</>
			}
		>
			<Link to='/install-first-app' unstable_viewTransition className={buttonClass} ref={continueLinkRef}>
				Launch
			</Link>
		</Layout>
	)
}
