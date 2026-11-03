import {ReactNode} from 'react'
import {useTranslation} from 'react-i18next'

import {ButtonLink} from '@/components/ui/button-link'
import {AppCard} from '@/features/app-store/components/app-card'
import {SectionHeading} from '@/features/app-store/components/section-heading'
import {
	APP_STORE_EMPTY_STATE_SRC,
	appGridClass,
	storeCardClass,
	storeCardPaddedClass,
	storeRevealCardClass,
	storeRevealDelay,
} from '@/features/app-store/constants'
import type {AppStoreStatus} from '@/features/app-store/data/catalog'
import {useAppCardStateMap} from '@/features/app-store/hooks/use-app-status'
import {cn} from '@/lib/utils'
import type {RegistryApp} from '@/trpc/trpc'

export function AppGrid({
	apps,
	statuses,
	makeTo,
	className,
	revealDelayStart,
}: {
	apps: readonly RegistryApp[]
	statuses?: Map<string, AppStoreStatus>
	/** Override link targets (community stores) */
	makeTo?: (app: RegistryApp) => string
	className?: string
	/** When set, cards trickle in with a tiny per-card stagger from this delay */
	revealDelayStart?: number
}) {
	const stagger = revealDelayStart !== undefined
	const appStates = useAppCardStateMap(apps)
	return (
		<div className={cn(appGridClass, className)}>
			{apps.map((app, index) => {
				const actionState = appStates.get(app.id)
				return (
					<AppCard
						key={app.id}
						app={app}
						status={statuses?.get(app.id)}
						lifecycleState={actionState?.state}
						progress={actionState?.progress}
						to={makeTo?.(app)}
						className={stagger ? storeRevealCardClass : undefined}
						style={stagger ? storeRevealDelay(revealDelayStart + Math.min(index * 12, 240)) : undefined}
					/>
				)
			})}
		</div>
	)
}

/** A titled, contained grid section — the workhorse of the storefront */
export function AppGridSection({
	overline,
	title,
	rightChildren,
	apps,
	statuses,
	makeTo,
	children,
}: {
	overline?: string
	title: ReactNode
	rightChildren?: ReactNode
	apps: readonly RegistryApp[]
	statuses?: Map<string, AppStoreStatus>
	makeTo?: (app: RegistryApp) => string
	children?: ReactNode
}) {
	return (
		<section className={cn(storeCardPaddedClass, 'flex flex-col gap-4')}>
			<SectionHeading overline={overline} title={title} rightChildren={rightChildren} />
			<AppGrid apps={apps} statuses={statuses} makeTo={makeTo} />
			{children}
		</section>
	)
}

// In place of an app or app store a link pointed to that's no longer there
export function AppStoreNotFound({title, description}: {title: string; description: string}) {
	const {t} = useTranslation()
	return (
		<div className={cn(storeCardClass, 'flex flex-col items-center pb-10')}>
			<AppStoreEmptyState title={title} description={description} />
			<ButtonLink to='/app-store' size='sm'>
				{t('app-store.go-to-app-store')}
			</ButtonLink>
		</div>
	)
}

export function AppStoreEmptyState({title, description}: {title: string; description?: string}) {
	const {t} = useTranslation()
	return (
		<div className='flex flex-col items-center justify-center gap-3 px-6 py-12 text-center'>
			<img src={APP_STORE_EMPTY_STATE_SRC} alt='' className='h-24 w-24 md:h-28 md:w-28' loading='lazy' />
			<p className='text-15 font-semibold text-white/80'>{title || t('app-store.search.no-results')}</p>
			{description && <p className='max-w-sm text-13 text-white/40'>{description}</p>}
		</div>
	)
}
