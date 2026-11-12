import {useTranslation} from 'react-i18next'
import {TbCircleArrowUp} from 'react-icons/tb'
import {Link} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {buttonVariants} from '@/components/ui/button'
import {storeCardClass, storeRevealClass, storeRevealDelay} from '@/features/app-store/constants'
import {useAppsWithUpdates} from '@/hooks/use-apps-with-updates'
import {cn} from '@/lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'

// Maintenance before discovery: when updates exist, the storefront leads with
// this compact shelf. Members browse read-only, so they never see it.
const MAX_SHELF_ICONS = 3

export function UpdatesShelf() {
	const {t} = useTranslation()
	const linkToDialog = useLinkToDialog()
	const isOwner = trpcReact.user.get.useQuery().data?.role === 'owner'
	const {appsWithUpdates, updatableApps, updatingApps, isLoading} = useAppsWithUpdates()

	if (!isOwner || isLoading || appsWithUpdates.length === 0) return null

	const compatibleUpdates = appsWithUpdates.filter((app) => app.compatible)
	const incompatibleCount = appsWithUpdates.length - compatibleUpdates.length
	const updatingOnly = updatableApps.length === 0 && updatingApps.length > 0
	const shelfLabel = updatingOnly
		? t('app-updates.updating')
		: t('app-updates.updates-available-count', {count: appsWithUpdates.length})

	return (
		// The whole shelf is one link to the updates dialog (where individual
		// updates and Update all live); the "View" at the end is just its visual
		// affordance — an <a> can't hold a nested interactive control
		<Link
			to={linkToDialog('updates')}
			className={cn(
				storeCardClass,
				'group flex items-center gap-1.5 p-2 outline-hidden transition-colors duration-200 hover:bg-white/6 focus-visible:ring-2 focus-visible:ring-white/25 md:gap-4 md:p-5',
				storeRevealClass,
			)}
			style={storeRevealDelay(50)}
			aria-label={shelfLabel}
		>
			{/* The first few icons fanned left-to-right, first on top; the overlap
			    reads as depth through a soft shadow — the icons carry their own
			    border already, so no ring */}
			<div className='flex shrink-0 -space-x-6 md:-space-x-2.5'>
				{appsWithUpdates.slice(0, MAX_SHELF_ICONS).map((app, index) => (
					<AppIcon
						key={app.id}
						src={app.icon}
						className='size-9 rounded-10 shadow-[0_2px_10px_rgba(0,0,0,0.5)] md:size-10'
						style={{zIndex: MAX_SHELF_ICONS - index}}
					/>
				))}
			</div>
			<div className='flex min-w-0 flex-1 flex-col gap-0.5'>
				<h2 className='flex items-center gap-1 text-14 leading-tight font-semibold -tracking-3 sm:gap-1.5 sm:text-15'>
					<TbCircleArrowUp className='h-4.5 w-4.5 shrink-0 text-brand-lightest' />
					<span className='min-w-0'>{shelfLabel}</span>
				</h2>
				{/* Names beyond the fanned icons collapse into "…, and more" */}
				<p className='truncate text-13 leading-tight text-white/40'>
					{appsWithUpdates.length > MAX_SHELF_ICONS
						? t('app-store.updates-shelf.names-and-more', {
								names: appsWithUpdates
									.slice(0, MAX_SHELF_ICONS)
									.map((app) => app.name)
									.join(', '),
							})
						: appsWithUpdates.map((app) => app.name).join(', ')}
				</p>
				{incompatibleCount > 0 && (
					<p className='text-12 leading-tight text-amber-300/70'>
						{t('app-store.updates-shelf.os-update-required-count', {count: incompatibleCount})}
					</p>
				)}
			</div>
			<span
				className={cn(buttonVariants({size: 'md', variant: 'primary'}), 'w-auto shrink-0 group-hover:bg-brand-lighter')}
			>
				{t('app.view')}
			</span>
		</Link>
	)
}
