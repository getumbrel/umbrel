// Note: the sidebar and sidebar-link components re-render on every navigation click.
// While we could memoize these components to prevent re-renders,
// the performance impact is negligible with so few items and simple DOM updates.
// So we've opted for simpler code over premature optimization.
import {AnimatePresence, motion} from 'framer-motion'

import {SidebarRewind} from '@/features/files/components/rewind'
import {SidebarApps} from '@/features/files/components/sidebar/sidebar-apps'
import {SidebarExternalStorage} from '@/features/files/components/sidebar/sidebar-external-storage'
import {SidebarFavorites} from '@/features/files/components/sidebar/sidebar-favorites'
import {SidebarHome} from '@/features/files/components/sidebar/sidebar-home'
import {SidebarNetworkStorage} from '@/features/files/components/sidebar/sidebar-network-storage'
import {SidebarRecents} from '@/features/files/components/sidebar/sidebar-recents'
import {SidebarShares} from '@/features/files/components/sidebar/sidebar-shares'
import {SidebarTrash} from '@/features/files/components/sidebar/sidebar-trash'
import {HOME_PATH} from '@/features/files/constants'
import {useExternalStorage} from '@/features/files/hooks/use-external-storage'
import {useFavorites} from '@/features/files/hooks/use-favorites'
import {useShares} from '@/features/files/hooks/use-shares'
import {useFilesCapabilities} from '@/features/files/providers/files-capabilities-context'
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

export function Sidebar({className}: {className?: string}) {
	const capabilities = useFilesCapabilities()
	const {shares, isLoadingShares} = useShares()
	const {favorites, isLoadingFavorites} = useFavorites()
	const {disks, isLoadingExternalStorage, isExternalStorageSupported} = useExternalStorage()

	const displayShares = shares?.filter((share) => share && share.path !== HOME_PATH)

	// Visibility flags
	const hidden = capabilities.hiddenSidebarItems || {}
	const showFavorites = !isLoadingFavorites && !!favorites && favorites.length > 0
	const showShares = !isLoadingShares && !!displayShares && displayShares.length > 0
	const showNetwork = !hidden.network
	const showExternal =
		isExternalStorageSupported && !hidden.external && !isLoadingExternalStorage && !!disks && disks.length > 0
	const showTrash = !hidden.trash
	const showRewind = !hidden.rewind

	return (
		<nav className={cn('flex flex-col', className)} aria-label={t('files-sidebar.navigation')}>
			<ScrollArea className='h-full'>
				{/* Hardcoded home link */}
				<SidebarSection>
					<SidebarHome />
					<SidebarRecents />
					<SidebarApps />
				</SidebarSection>
				{/* Favorites */}
				<AnimatePresence initial={!isLoadingFavorites}>
					{showFavorites && (
						<motion.div
							initial={isLoadingFavorites ? {opacity: 0, height: 0} : false}
							animate={{opacity: 1, height: 'auto'}}
							exit={{opacity: 0, height: 0}}
							transition={{duration: 0.2}}
						>
							<SidebarDivider />
							<SidebarSection label={t('files-sidebar.favorites')}>
								<SidebarFavorites favorites={favorites} />
							</SidebarSection>
						</motion.div>
					)}
				</AnimatePresence>

				{/* Shared folders */}
				<AnimatePresence initial={!isLoadingShares}>
					{showShares && (
						<motion.div
							initial={isLoadingShares ? {opacity: 0, height: 0} : false}
							animate={{opacity: 1, height: 'auto'}}
							exit={{opacity: 0, height: 0}}
							transition={{duration: 0.2}}
						>
							<SidebarDivider />
							<SidebarSection label={t('files-sidebar.shared-folders')}>
								<SidebarShares shares={displayShares} />
							</SidebarSection>
						</motion.div>
					)}
				</AnimatePresence>

				{/* Network storage */}
				{/* We don't wrap in AnimatePresence because this section is always rendered */}
				<SidebarDivider />
				{showNetwork ? (
					<SidebarSection label={t('files-sidebar.network')}>
						<SidebarNetworkStorage />
					</SidebarSection>
				) : null}

				{/* External Storage */}
				<AnimatePresence initial={!isLoadingExternalStorage}>
					{showExternal && (
						<motion.div
							initial={isLoadingExternalStorage ? {opacity: 0, height: 0} : false}
							animate={{opacity: 1, height: 'auto'}}
							exit={{opacity: 0, height: 0}}
							transition={{duration: 0.2}}
						>
							<SidebarDivider />
							<SidebarSection label={t('files-sidebar.external-storage')}>
								<SidebarExternalStorage />
							</SidebarSection>
						</motion.div>
					)}
				</AnimatePresence>

				{/* Spacer */}
				<div className='h-6' />
			</ScrollArea>
			{/* Trash */}
			{showTrash ? <SidebarTrash /> : null}
			{showRewind ? <SidebarRewind /> : null}
		</nav>
	)
}

const SidebarSection = ({children, label = ''}: {children: React.ReactNode; label?: string}) => {
	return (
		<section className='flex flex-col gap-0.5 pr-4' aria-label={label}>
			<div className='px-2 py-1 text-[11px] font-medium text-white/40'>{label}</div>
			{children}
		</section>
	)
}

const SidebarDivider = () => {
	return (
		<div
			className='my-3 h-px w-full bg-[radial-gradient(35%_35%_at_35%_35%,rgba(255,255,255,0.35)_0%,transparent_70%)]'
			role='separator'
		/>
	)
}
