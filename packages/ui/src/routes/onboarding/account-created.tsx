import {useEffect, useRef} from 'react'
import {Trans} from 'react-i18next/TransWithoutContext'
import {Link} from 'react-router-dom'

import {links} from '@/constants/links'
import {buttonClass, footerLinkClass, Layout} from '@/layouts/bare/shared'
import {trpcReact} from '@/trpc/trpc'
import {linkClass} from '@/utils/element-classes'
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

	return (
		<Layout
			title={t('onboarding.account-created.youre-all-set-name', {name})}
			subTitle={t('onboarding.account-created.subtitle')}
			subTitleMaxWidth={470}
			footer={
				<div className='flex flex-col items-center gap-3'>
					<Link to={links.support} target='_blank' className={footerLinkClass}>
						{t('onboarding.contact-support')}
					</Link>
				</div>
			}
		>
			<Link
				data-testid='to-desktop'
				to='/'
				unstable_viewTransition
				className={`${buttonClass} mb-2`}
				ref={continueLinkRef}
			>
				{t('onboarding.account-created.next')}
			</Link>
			<p className='text-center text-xs font-medium opacity-70'>
				<Trans
					i18nKey='onboarding.account-created.by-clicking-button-you-agree'
					components={{
						linked: <Link to={links.legal.tos} className={linkClass} target='_blank' />,
					}}
				/>
			</p>
		</Layout>
	)
}
