import {useEffect, useRef} from 'react'
import {Link} from 'react-router-dom'

import {links} from '@/constants/links'
import {buttonClass, footerLinkClass, Layout} from '@/layouts/bare/shared'
import {LanguageDropdown} from '@/routes/settings/_components/language-dropdown'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export default function AccountCreated() {
	const continueLinkRef = useRef<HTMLAnchorElement>(null)

	const getQuery = trpcReact.user.get.useQuery()

	// Grab the first name
	const name = getQuery.data?.name?.split(' ')[0]

	useEffect(() => {
		continueLinkRef.current?.focus()
	}, [])

	if (!name) {
		return null
	}

	// Keep this in variable to avoid getting out of sync between message and button
	const next = t('onboarding.account-created.next')
	const tos = t('legal.terms-of-service')

	return (
		<Layout
			title={t('onboarding.account-created.youre-all-set-name', {name})}
			headTitle={t('onboarding.account-created.page-title')}
			subTitle={t('onboarding.account-created.by-clicking-button-you-agree', {
				button: next,
				tos: tos,
			})}
			subTitleMaxWidth={470}
			footer={
				<div className='flex flex-col items-center gap-3'>
					{/* TODO: consider adding drawer on mobile */}
					<LanguageDropdown />
					<div className='flex flex-row gap-3'>
						<Link to={links.support} target='_blank' className={footerLinkClass}>
							{t('onboarding.contact-support')}
						</Link>
						<Link to={links.legal.tos} target='_blank' className={footerLinkClass}>
							{t('legal.terms-of-service')}
						</Link>
					</div>
				</div>
			}
		>
			<Link data-testid='to-desktop' to='/' unstable_viewTransition className={buttonClass} ref={continueLinkRef}>
				{next}
			</Link>
		</Layout>
	)
}
