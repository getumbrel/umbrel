// Note: the sidebar and sidebar-link components re-render on every navigation click.
// While we could memoize these components to prevent re-renders,
// the performance impact is negligible with so few items and simple DOM updates.
// So we've opted for simpler code over premature optimization.
import {AnimatePresence, motion} from 'motion/react'
import {useTranslation} from 'react-i18next'

import {ScrollArea} from '@/components/ui/scroll-area'
import {SidebarRewind} from '@/features/files/components/rewind'
import {SidebarApps} from '@/features/files/components/sidebar/sidebar-apps'
import {SidebarCloud} from '@/features/files/components/sidebar/sidebar-cloud'
import {SidebarExternalStorage} from '@/features/files/components/sidebar/sidebar-external-storage'
import {SidebarFavorites} from '@/features/files/components/sidebar/sidebar-favorites'
import {SidebarHome} from '@/features/files/components/sidebar/sidebar-home'
import {SidebarMachines} from '@/features/files/components/sidebar/sidebar-machines'
import {SidebarNetworkStorage} from '@/features/files/components/sidebar/sidebar-network-storage'
import {SidebarRaidStorage} from '@/features/files/components/sidebar/sidebar-raid-storage'
import {SidebarRecents} from '@/features/files/components/sidebar/sidebar-recents'
import {SidebarOwnersUmbrel, SidebarSharedStorage} from '@/features/files/components/sidebar/sidebar-shared-with-me'
import {SidebarShares} from '@/features/files/components/sidebar/sidebar-shares'
import {SidebarTrash} from '@/features/files/components/sidebar/sidebar-trash'
import {useExternalStorage} from '@/features/files/hooks/use-external-storage'
import {useFavorites} from '@/features/files/hooks/use-favorites'
import {useHomePath, useIsMember} from '@/features/files/hooks/use-home-path'
import {useMemberShares} from '@/features/files/hooks/use-member-shares'
import {useShares} from '@/features/files/hooks/use-shares'
import {useFilesCapabilities} from '@/features/files/providers/files-capabilities-context'
import {cn} from '@/lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {firstNameFromFullName} from '@/utils/misc'

export function Sidebar({className}: {className?: string}) {
	const {t} = useTranslation()
	const capabilities = useFilesCapabilities()
	const {shares, isLoadingShares, canManageShares} = useShares()
	const {favorites, isLoadingFavorites} = useFavorites()
	const {disks, isLoadingExternalStorage, isExternalStorageSupported} = useExternalStorage()
	const raidMountsQ = trpcReact.files.raidMounts.useQuery(undefined, {retry: false})
	const homePath = useHomePath()

	const displayShares = shares?.filter((share) => share && share.path !== homePath)

	// Visibility flags
	const hidden = capabilities.hiddenSidebarItems || {}
	// Members only have their own home, favorites + trash; hide everything else
	const isMember = useIsMember()

	// Paths the owner has shared with this member
	const {sharedWithMe} = useMemberShares()
	const homeShares = sharedWithMe?.shares.filter((share) => share.base === 'home') ?? []
	const hasExternalStorage = sharedWithMe?.shares.some((share) => share.path === '/External') ?? false
	const hasNetworkStorage = sharedWithMe?.shares.some((share) => share.path === '/Network') ?? false
	const hasRaidStorage = sharedWithMe?.shares.some((share) => share.path === '/Raid') ?? false
	const hasSharedApps = sharedWithMe?.shares.some((share) => share.base === 'apps') ?? false
	const sharedWithMeLabel = sharedWithMe?.ownerName
		? t('files-sidebar.owners-umbrel', {name: firstNameFromFullName(sharedWithMe.ownerName)})
		: ''
	const showFavorites = !isLoadingFavorites && !!favorites && favorites.length > 0
	const showShares = canManageShares && !isLoadingShares && !!displayShares && displayShares.length > 0
	const showNetwork = !hidden.network && !isMember
	const showExternal =
		isExternalStorageSupported &&
		!hidden.external &&
		!isMember &&
		!isLoadingExternalStorage &&
		!!disks &&
		disks.length > 0
	const showTrash = !hidden.trash
	const showRewind = !hidden.rewind && !isMember
	const showCloud = !hidden.cloud
	const showMachines = !hidden.machines && !isMember
	// The owner browses arrays as individual rows; a member with RAID shared sees
	// the single /Raid category row in SidebarSharedStorage instead, mirroring how
	// /External and /Network are surfaced to members.
	const showRaid = !hidden.raid && !isMember && !raidMountsQ.isLoading && (raidMountsQ.data?.length ?? 0) > 0

	return (
		<nav className={cn('flex flex-col', className)} aria-label={t('files-sidebar.navigation')}>
			<ScrollArea className='h-full'>
				{/* Hardcoded home link */}
				<SidebarSection>
					<SidebarHome />
					{!isMember && <SidebarRecents />}
					{(!isMember || hasSharedApps) && <SidebarApps />}
					{showMachines && <SidebarMachines />}
				</SidebarSection>

				{/* Owner's Umbrel, shown to members only when the owner has shared something from their home */}
				{isMember && homeShares.length > 0 && (
					<>
						<SidebarDivider />
						<SidebarSection label={t('files-sidebar.shared-with-you')}>
							<SidebarOwnersUmbrel name={sharedWithMeLabel} />
						</SidebarSection>
					</>
				)}
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

				{/* Storage categories shared with this member */}
				{isMember && (hasExternalStorage || hasNetworkStorage || hasRaidStorage) && (
					<>
						<SidebarDivider />
						<SidebarSection label={t('files-sidebar.devices')}>
							<SidebarSharedStorage external={hasExternalStorage} network={hasNetworkStorage} raid={hasRaidStorage} />
						</SidebarSection>
					</>
				)}

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
				{!isMember && <SidebarDivider />}
				{showNetwork ? (
					<SidebarSection>
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

				{/* Cloud */}
				{/* Always rendered for owners and members (unless hidden): this account-private
			    permanent root row is the feature's ambient entry point. No section label since
			    the root row itself carries the feature name. */}
				{showCloud ? (
					<>
						<SidebarDivider />
						<SidebarSection>
							<SidebarCloud />
						</SidebarSection>
					</>
				) : null}

				{/* Linux RAID (mdadm) arrays */}
				{showRaid && (
					<>
						<SidebarDivider />
						<SidebarSection label={t('files-sidebar.raid-storage')}>
							<SidebarRaidStorage />
						</SidebarSection>
					</>
				)}

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
		<section className='flex flex-col pr-4' aria-label={label}>
			{label && <div className='px-2 py-1 text-[11px] font-medium text-white/40'>{label}</div>}
			{children}
		</section>
	)
}

const SidebarDivider = () => {
	return (
		<div
			className='my-2.5 h-px w-full bg-[radial-gradient(35%_35%_at_35%_35%,rgba(255,255,255,0.35)_0%,transparent_70%)]'
			role='separator'
		/>
	)
}
