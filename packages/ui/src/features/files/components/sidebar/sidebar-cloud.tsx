import {keepPreviousData} from '@tanstack/react-query'
import {ChevronRight, Loader2} from 'lucide-react'
import {AnimatePresence, motion} from 'motion/react'
import {useState, type KeyboardEvent} from 'react'
import {useTranslation} from 'react-i18next'
import {FaPlus} from 'react-icons/fa6'
import {useNavigate as useReactRouterNavigate} from 'react-router-dom'

import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/components/ui/context-menu'
import {contextMenuClasses} from '@/components/ui/shared/menu'
import {CloudIcon} from '@/features/files/assets/cloud-icon'
import {CloudAccountDialog} from '@/features/files/components/cloud-account-dialog'
import {CloudDisconnectDialog} from '@/features/files/components/cloud-disconnect-dialog'
import {CircularProgress} from '@/features/files/components/shared/circular-progress'
import {CLOUD_PATH, CLOUD_PROVIDER_LOGOS} from '@/features/files/constants'
import {useCloudAccounts, useCloudProviders, useCloudSyncs, type CloudAccount} from '@/features/files/hooks/use-cloud'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {cloudAccountBrand, cloudBrandName, soleRootCloudDestination} from '@/features/files/utils/cloud'
import {useQueryParams} from '@/hooks/use-query-params'
import {cn} from '@/lib/utils'
import {useCloudActivity} from '@/providers/cloud'
import {trpcReact} from '@/trpc/trpc'
import {tw} from '@/utils/tw'

const selectedClass = tw`
  bg-linear-to-b from-white/[0.04] to-white/[0.08]
  border-white/6
  shadow-button-highlight-soft-hpx
`

// Narrow projection for the sidebar's aggregate affordances: only the fields
// that should trigger a rerender when they change.
type SidebarCloudRow = {
	id: string
	accountId: string
	name: string
	state: string
}

function useSidebarClouds(): SidebarCloudRow[] {
	const {data} = trpcReact.files.cloud.syncs.useQuery(undefined, {
		placeholderData: keepPreviousData,
		staleTime: 5_000,
		refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? 5_000 : false),
		select: (clouds) =>
			clouds.map((cloud) => ({
				id: cloud.id,
				accountId: cloud.accountId,
				name: cloud.destination.path.split('/').filter(Boolean).at(-1) ?? cloud.destination.path,
				state: cloud.status.state,
			})),
	})
	return data ?? []
}

export function SidebarCloud() {
	const {t} = useTranslation()
	const clouds = useSidebarClouds()
	const {data: accounts} = useCloudAccounts()
	const {data: providers} = useCloudProviders()
	const {activities} = useCloudActivity()
	const {currentPath, navigateToDirectory} = useNavigate()
	const [expandedProviders, setExpandedProviders] = useState<string[]>([])
	const [focusedTreeItem, setFocusedTreeItem] = useState<string | null>(null)
	const [managing, setManaging] = useState<CloudAccount | null>(null)
	const [disconnecting, setDisconnecting] = useState<CloudAccount | null>(null)
	// Full download records for the disconnect dialog's folder list; the sidebar
	// rows themselves keep their narrow projection
	const {data: fullClouds} = useCloudSyncs()

	// Keep same-brand accounts adjacent: brands (a provider, or a WebDAV
	// flavor like Nextcloud) appear in first-connected order, accounts within
	// a brand in connection order
	const accountsByProvider = new Map<string, CloudAccount[]>()
	for (const account of accounts ?? []) {
		const brand = cloudAccountBrand(account)
		const group = accountsByProvider.get(brand)
		if (group) group.push(account)
		else accountsByProvider.set(brand, [account])
	}

	const providerName = (brandId: string) => cloudBrandName(brandId, providers)

	const toggleProvider = (providerId: string) =>
		setExpandedProviders((current) =>
			current.includes(providerId) ? current.filter((id) => id !== providerId) : [...current, providerId],
		)

	const visibleTreeItems = [...accountsByProvider.entries()].flatMap(([providerId, providerAccounts]) => {
		if (providerAccounts.length === 1) return [`account-${providerAccounts[0].id}`]
		const groupId = `provider-${providerId}`
		if (!expandedProviders.includes(providerId)) return [groupId]
		return [groupId, ...providerAccounts.map(({id}) => `account-${id}`)]
	})
	const selectedAccount = (accounts ?? []).find(({id}) => currentPath === `${CLOUD_PATH}/${id}`)
	const selectedProvider = selectedAccount ? cloudAccountBrand(selectedAccount) : undefined
	const selectedProviderAccounts = selectedProvider ? accountsByProvider.get(selectedProvider) : undefined
	const selectedTreeItem =
		selectedAccount && selectedProvider && selectedProviderAccounts
			? selectedProviderAccounts.length > 1 && !expandedProviders.includes(selectedProvider)
				? `provider-${selectedProvider}`
				: `account-${selectedAccount.id}`
			: undefined
	const tabbableTreeItem =
		(focusedTreeItem && visibleTreeItems.includes(focusedTreeItem) ? focusedTreeItem : undefined) ??
		selectedTreeItem ??
		visibleTreeItems[0]

	const handleTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const currentItem = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]')
		if (!currentItem || !event.currentTarget.contains(currentItem)) return

		const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'))
		const currentIndex = items.indexOf(currentItem)
		if (currentIndex < 0) return

		const focus = (item: HTMLElement | undefined) => {
			if (!item) return
			event.preventDefault()
			item.focus()
		}

		if (event.key === 'ArrowDown') return focus(items[currentIndex + 1])
		if (event.key === 'ArrowUp') return focus(items[currentIndex - 1])
		if (event.key === 'Home') return focus(items[0])
		if (event.key === 'End') return focus(items.at(-1))

		const level = Number(currentItem.getAttribute('aria-level') ?? 1)
		const expanded = currentItem.getAttribute('aria-expanded')
		if (event.key === 'ArrowRight') {
			if (expanded === 'false') {
				event.preventDefault()
				currentItem.click()
			} else if (expanded === 'true') {
				const child = items.slice(currentIndex + 1).find((item) => Number(item.getAttribute('aria-level') ?? 1) > level)
				focus(child)
			}
		}
		if (event.key === 'ArrowLeft') {
			if (expanded === 'true') {
				event.preventDefault()
				currentItem.click()
			} else if (level > 1) {
				const parent = items
					.slice(0, currentIndex)
					.reverse()
					.find((item) => Number(item.getAttribute('aria-level') ?? 1) < level)
				focus(parent)
			}
		}
	}

	// Aggregate download activity for a set of accounts: per account for rows,
	// across a provider's accounts for a collapsed group header
	const activityFor = (accountIds: string[]) => {
		const accountClouds = clouds.filter(({accountId}) => accountIds.includes(accountId))
		const active = accountClouds.filter(({state}) => state === 'running' || state === 'queued')
		const needsAttention = accountClouds.some(({state}) => state === 'needs-attention')
		const knownPercents = active
			.map(({id}) => activities.find(({syncId}) => syncId === id)?.percent)
			.filter((percent): percent is number => percent !== undefined)
		const percent =
			knownPercents.length > 0 ? knownPercents.reduce((sum, value) => sum + value, 0) / knownPercents.length : undefined
		return {accountClouds, active, needsAttention, percent}
	}

	const activityIndicator = ({active, needsAttention, percent}: ReturnType<typeof activityFor>) => {
		if (active.length > 0) {
			// Same 14px footprint as the CircularProgress below, so the indicator
			// doesn't change size when a transfer's percent becomes known
			return percent === undefined ? (
				<Loader2 className='size-3.5 flex-shrink-0 animate-spin opacity-60' />
			) : (
				<span className='flex-shrink-0'>
					<CircularProgress progress={percent} size={14} strokeWidth={2} />
				</span>
			)
		}
		if (needsAttention) return <span className='size-1.5 flex-shrink-0 rounded-full bg-yellow-400' />
		return null
	}

	// A navigable account row: the sole account of a provider (labeled as the
	// provider) or one account inside an expanded provider group
	const renderAccountRow = (account: CloudAccount, {label, showLogo = true}: {label: string; showLogo?: boolean}) => {
		const activity = activityFor([account.id])
		const accountPath = `${CLOUD_PATH}/${account.id}`
		const accountClouds = fullClouds?.filter(({accountId}) => accountId === account.id) ?? []
		const openPath = soleRootCloudDestination(accountClouds) ?? accountPath
		const treeItemId = `account-${account.id}`
		const isSelected = currentPath === accountPath
		return (
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<button
						type='button'
						role='treeitem'
						aria-level={showLogo ? 1 : 2}
						aria-selected={isSelected}
						tabIndex={tabbableTreeItem === treeItemId ? 0 : -1}
						onFocus={() => setFocusedTreeItem(treeItemId)}
						onClick={() => navigateToDirectory(openPath)}
						className={cn(
							'flex w-full items-center gap-1.5 rounded-lg border border-transparent px-2 py-1.5 text-left text-12 focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:outline-hidden',
							isSelected ? selectedClass : 'text-white/60 hover:bg-white/10 hover:text-white',
						)}
					>
						{showLogo && (
							<img
								src={CLOUD_PROVIDER_LOGOS[cloudAccountBrand(account)]}
								alt=''
								className='size-4 flex-shrink-0 object-contain'
								draggable={false}
							/>
						)}
						<span className='min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap'>{label}</span>
						{activityIndicator(activity)}
					</button>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem onClick={() => setManaging(account)}>{t('files-cloud.manage')}</ContextMenuItem>
					<ContextMenuItem
						className={contextMenuClasses.item.rootDestructive}
						onClick={() => setDisconnecting(account)}
					>
						{t('files-cloud.manage-disconnect')}
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
		)
	}

	return (
		<>
			{/* Permanent root item with "Add download" button. */}
			<CloudRootItem hasAccounts={(accounts?.length ?? 0) > 0} />

			<CloudAccountDialog
				account={managing}
				onOpenChange={(open) => {
					if (!open) setManaging(null)
				}}
				onDisconnect={(account) => {
					setManaging(null)
					setDisconnecting(account)
				}}
			/>

			<CloudDisconnectDialog
				account={disconnecting}
				clouds={fullClouds?.filter(({accountId}) => accountId === disconnecting?.id) ?? []}
				onOpenChange={(open) => {
					if (!open) setDisconnecting(null)
				}}
			/>

			{/* One row per connected account. Multi-account providers use the
			    standard tree pattern so the group can be explored with arrows. */}
			{visibleTreeItems.length > 0 && (
				<div
					role='tree'
					aria-label={t('files-sidebar.cloud')}
					aria-orientation='vertical'
					onKeyDown={handleTreeKeyDown}
				>
					<AnimatePresence initial={false}>
						{[...accountsByProvider.entries()].map(([providerId, providerAccounts]) => {
							if (providerAccounts.length === 1) {
								const account = providerAccounts[0]
								return (
									<motion.div
										key={`sidebar-cloud-${account.id}`}
										role='none'
										initial={{opacity: 0, height: 0}}
										animate={{opacity: 1, height: 'auto'}}
										exit={{opacity: 0, height: 0}}
										transition={{duration: 0.2}}
									>
										{renderAccountRow(account, {label: providerName(providerId) ?? account.displayName})}
									</motion.div>
								)
							}

							const expanded = expandedProviders.includes(providerId)
							const containsSelection = providerAccounts.some(({id}) => currentPath === `${CLOUD_PATH}/${id}`)
							const treeItemId = `provider-${providerId}`
							return (
								<motion.div
									key={`sidebar-cloud-group-${providerId}`}
									role='none'
									initial={{opacity: 0, height: 0}}
									animate={{opacity: 1, height: 'auto'}}
									exit={{opacity: 0, height: 0}}
									transition={{duration: 0.2}}
								>
									{/* With several accounts the provider row expands/collapses; it has no destination of its own. */}
									<button
										type='button'
										role='treeitem'
										aria-level={1}
										aria-expanded={expanded}
										aria-selected={!expanded && containsSelection}
										tabIndex={tabbableTreeItem === treeItemId ? 0 : -1}
										onFocus={() => setFocusedTreeItem(treeItemId)}
										onClick={() => toggleProvider(providerId)}
										className={cn(
											'flex w-full items-center gap-1.5 rounded-lg border border-transparent px-2 py-1.5 text-left text-12 focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:outline-hidden',
											!expanded && containsSelection
												? selectedClass
												: 'text-white/60 hover:bg-white/10 hover:text-white',
										)}
									>
										<img
											src={CLOUD_PROVIDER_LOGOS[providerId]}
											alt=''
											className='size-4 flex-shrink-0 object-contain'
											draggable={false}
										/>
										<span className='min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap'>
											{providerName(providerId) ?? providerId}
										</span>
										{!expanded && activityIndicator(activityFor(providerAccounts.map(({id}) => id)))}
										<ChevronRight
											className={cn('size-3 flex-shrink-0 transition-transform duration-200', expanded && 'rotate-90')}
										/>
									</button>
									<AnimatePresence initial={false}>
										{expanded && (
											<motion.div
												key={`sidebar-cloud-group-accounts-${providerId}`}
												role='group'
												initial={{opacity: 0, height: 0}}
												animate={{opacity: 1, height: 'auto'}}
												exit={{opacity: 0, height: 0}}
												transition={{duration: 0.2}}
												className='overflow-hidden'
											>
												{providerAccounts.map((account) => (
													<div key={account.id} role='none' className='ml-6'>
														{renderAccountRow(account, {label: account.displayName, showLogo: false})}
													</div>
												))}
											</motion.div>
										)}
									</AnimatePresence>
								</motion.div>
							)
						})}
					</AnimatePresence>
				</div>
			)}
		</>
	)
}

// Always rendered root item: opens the /Cloud accounts view once accounts
// exist and the add wizard's pitch before that, so the first-run journey stays
// inside one dialog and the constellation can morph into the picker in place.
// Its + always opens the add wizard.
function CloudRootItem({hasAccounts}: {hasAccounts: boolean}) {
	const {t} = useTranslation()
	const navigate = useReactRouterNavigate()
	const {addLinkSearchParams} = useQueryParams()
	const {currentPath, navigateToDirectory} = useNavigate()
	const isActive = currentPath === CLOUD_PATH

	return (
		<div className='group flex items-stretch gap-0.5 rounded-lg text-12'>
			<button
				type='button'
				aria-current={isActive ? 'page' : undefined}
				onClick={() => {
					if (hasAccounts) navigateToDirectory(CLOUD_PATH)
					else navigate({search: addLinkSearchParams({dialog: 'files-cloud-add'})})
				}}
				className={cn(
					'flex flex-1 items-center gap-1.5 rounded-l-lg border border-r-0 border-transparent from-white/[0.04] to-white/[0.08] px-2 py-1.5 text-left text-white/60 group-hover:bg-white/10 group-hover:bg-linear-to-b group-hover:text-white focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:outline-hidden',
					isActive && 'border-white/6 bg-linear-to-b text-white shadow-button-highlight-soft-hpx',
				)}
			>
				{/* The cloud art fills its square, so it sits at 18px inside the rows' 20px icon box */}
				<CloudIcon className='size-5 flex-shrink-0 p-px' />
				<span className='min-w-0 overflow-hidden text-ellipsis whitespace-nowrap'>{t('files-sidebar.cloud')}</span>
			</button>
			<button
				type='button'
				aria-label={t('files-cloud.add-cloud')}
				onClick={() => navigate({search: addLinkSearchParams({dialog: 'files-cloud-add'})})}
				className={cn(
					'group/plus flex items-center justify-center rounded-r-lg border border-l-0 border-transparent from-white/[0.04] to-white/[0.08] px-2 py-1.5 group-hover:bg-white/10 group-hover:bg-linear-to-b focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:outline-hidden',
					isActive && 'border-white/6 bg-linear-to-b shadow-button-highlight-soft-hpx',
				)}
			>
				<span className='flex items-center justify-center text-white/60 group-hover/plus:text-white'>
					<FaPlus className='size-3' strokeWidth={5} />
				</span>
			</button>
		</div>
	)
}
