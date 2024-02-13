import {useEffect, useRef} from 'react'
import {Link} from 'react-router-dom'

import {links} from '@/constants/links'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {buttonClass, footerLinkClass, Layout} from '@/layouts/bare/shared'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export default function AccountCreated() {
	useUmbrelTitle(t('onboarding.account-created.page-title'))
	const continueLinkRef = useRef<HTMLAnchorElement>(null)

	const getQuery = trpcReact.user.get.useQuery()

	const name = getQuery.data?.name

	useEffect(() => {
		continueLinkRef.current?.focus()
	}, [])

	if (!name) {
		return null
	}

	// Keep this in variable to avoid getting out of sync between message and button
	const launch = t('onboarding.account-created.launch')

	return (
		<Layout
			title={t('onboarding.account-created.youre-all-set-name', {name})}
			subTitle={t('onboarding.account-created.by-clicking-button-you-agree', {
				button: launch,
			})}
			subTitleMaxWidth={470}
			footer={
				<>
					<Link to={links.legal.privacy} target='_blank' className={footerLinkClass}>
						{t('legal.privacy-policy')}
					</Link>
					<Link to={links.support} target='_blank' className={footerLinkClass}>
						{t('contact-support')}
					</Link>
					<Link to={links.legal.tos} target='_blank' className={footerLinkClass}>
						{t('legal.terms-of-service')}
					</Link>
				</>
			}
		>
			<Link data-testid='to-desktop' to='/' unstable_viewTransition className={buttonClass} ref={continueLinkRef}>
				{launch}
			</Link>
		</Layout>
	)
}
