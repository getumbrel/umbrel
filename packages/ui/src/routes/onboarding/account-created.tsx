import {useEffect, useRef} from 'react'
import {Trans} from 'react-i18next/TransWithoutContext'
import {Link} from 'react-router-dom'

import {links} from '@/constants/links'
import {footerLinkClass, Layout, primaryButtonProps} from '@/layouts/bare/shared'
import {useOnboardingDevice} from '@/routes/onboarding/use-onboarding-device'
import {trpcReact} from '@/trpc/trpc'
import {linkClass} from '@/utils/element-classes'
import {t} from '@/utils/i18n'

export default function AccountCreated() {
	const continueLinkRef = useRef<HTMLAnchorElement>(null)
	const device = useOnboardingDevice()

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
			subTitle={
				<Trans
					i18nKey='onboarding.account-created.by-clicking-button-you-agree'
					components={{
						linked: <Link to={links.legal.tos} className={linkClass} target='_blank' />,
					}}
				/>
			}
			subTitleMaxWidth={470}
			subTitleClassName='text-white/50'
			showLogo={!device.showDevice}
			footer={
				<div className='flex flex-col items-center gap-3'>
					<Link to={links.support} target='_blank' className={footerLinkClass}>
						{t('onboarding.contact-support')}
					</Link>
				</div>
			}
		>
			{device.showDevice && device.image && (
				<>
					<img src={device.image} alt='Umbrel device' className={device.imageClassName} />
					<p className='-mt-2 text-[20px] font-semibold text-white/85'>{device.name}</p>
				</>
			)}

			<Link
				data-testid='to-desktop'
				to='/'
				unstable_viewTransition
				ref={continueLinkRef}
				className={`mt-4 ${primaryButtonProps.className}`}
				style={primaryButtonProps.style}
			>
				{t('onboarding.account-created.next')}
			</Link>
		</Layout>
	)
}
