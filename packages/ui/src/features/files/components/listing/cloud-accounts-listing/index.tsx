import {CircleAlert, CircleCheck, Loader2, MoreHorizontal} from 'lucide-react'
import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate as useRouterNavigate} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/components/ui/context-menu'
import {ScrollArea} from '@/components/ui/scroll-area'
import {contextMenuClasses} from '@/components/ui/shared/menu'
import {CloudIcon} from '@/features/files/assets/cloud-icon'
import {CloudPlusIcon} from '@/features/files/assets/cloud-plus'
import {CloudAccountDialog} from '@/features/files/components/cloud-account-dialog'
import {CloudDisconnectDialog} from '@/features/files/components/cloud-disconnect-dialog'
import {useSetActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {CloudPitchPoints} from '@/features/files/components/shared/cloud-constellation'
import {CLOUD_PATH, CLOUD_PROVIDER_LOGOS} from '@/features/files/constants'
import {
	useCloudAccounts,
	useCloudProviders,
	useCloudSyncs,
	type CloudAccount,
	type CloudProvider,
	type CloudSync,
} from '@/features/files/hooks/use-cloud'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {cloudAccountBrand, cloudBrandName, soleRootCloudDestination} from '@/features/files/utils/cloud'
import {DockSpacer} from '@/modules/desktop/dock'
import {useLinkToDialog} from '@/utils/dialog'

// Virtual /Cloud route: connected cloud accounts as tiles, like the network
// devices view. A tile opens the sole root download directly, otherwise it
// opens the account's destination listing.
export function CloudAccountsListing() {
	const {t} = useTranslation()
	const {data: accounts, isLoading: isLoadingAccounts} = useCloudAccounts()
	const {data: providers, isLoading: isLoadingProviders} = useCloudProviders()
	const {data: clouds, isLoading: isLoadingClouds} = useCloudSyncs()
	const {navigateToDirectory} = useNavigate()
	const routerNavigate = useRouterNavigate()
	const linkToDialog = useLinkToDialog()
	const setActionsBarConfig = useSetActionsBarConfig()
	const [managing, setManaging] = useState<CloudAccount | null>(null)
	const [disconnecting, setDisconnecting] = useState<CloudAccount | null>(null)

	const isLoading = isLoadingAccounts || isLoadingProviders || isLoadingClouds

	const openAddWizard = () => routerNavigate(linkToDialog('files-cloud-add'))

	useEffect(() => {
		setActionsBarConfig({
			hideSearch: true,
			// The tiles are accounts to go into, not things to select or to view as a list
			selectable: false,
			hideViewOptions: true,
			actions: [
				{id: 'add-cloud', label: t('files-cloud.add-cloud'), icon: CloudPlusIcon, onSelect: openAddWizard, pill: true},
			],
		})
	}, [])

	return (
		// Straight on the sheet, as the listings are, and down to its bottom edge:
		// what it holds scrolls clear of the dock at its end
		<div className='h-full'>
			{isLoading ? (
				<div className='flex h-full items-center justify-center pb-24'>
					<Loader2 className='size-5 animate-spin opacity-60' />
				</div>
			) : (accounts?.length ?? 0) === 0 ? (
				<EmptyState providers={providers} onConnect={openAddWizard} />
			) : (
				<ScrollArea className='h-full'>
					<div className='grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2 pt-1 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]'>
						{(accounts ?? []).map((account) => {
							const accountClouds = clouds?.filter(({accountId}) => accountId === account.id) ?? []
							const openPath = soleRootCloudDestination(accountClouds) ?? `${CLOUD_PATH}/${account.id}`

							return (
								<AccountTile
									key={account.id}
									account={account}
									providerName={cloudBrandName(cloudAccountBrand(account), providers) ?? account.displayName}
									accountClouds={accountClouds}
									onOpen={() => navigateToDirectory(openPath)}
									onManage={() => setManaging(account)}
									onDisconnect={() => setDisconnecting(account)}
								/>
							)
						})}
					</div>
					<DockSpacer className='mt-3' />
				</ScrollArea>
			)}
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
				clouds={clouds?.filter(({accountId}) => accountId === disconnecting?.id) ?? []}
				onOpenChange={(open) => {
					if (!open) setDisconnecting(null)
				}}
			/>
		</div>
	)
}

function AccountTile({
	account,
	providerName,
	accountClouds,
	onOpen,
	onManage,
	onDisconnect,
}: {
	account: CloudAccount
	providerName: string
	accountClouds: CloudSync[]
	onOpen: () => void
	onManage: () => void
	onDisconnect: (accountClouds: CloudSync[]) => void
}) {
	const {t} = useTranslation()
	const needsAttention =
		Boolean(account.attention) || accountClouds.some(({status}) => status.state === 'needs-attention')

	return (
		<ContextMenu>
			<div className='group relative'>
				<ContextMenuTrigger asChild>
					<button
						type='button'
						onClick={onOpen}
						className='flex w-full flex-col items-center gap-1 rounded-xl border border-transparent px-3 py-4 text-center transition-colors hover:border-white/6 hover:bg-white/5 focus-visible:border-white/10 focus-visible:bg-white/5 focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:outline-hidden'
					>
						<img
							src={CLOUD_PROVIDER_LOGOS[cloudAccountBrand(account)]}
							alt=''
							className='size-10 object-contain'
							draggable={false}
						/>
						<div className='mt-1 flex w-full items-center justify-center gap-1'>
							<span className='truncate text-13 font-medium'>{providerName}</span>
							{needsAttention ? (
								<CircleAlert className='size-3 shrink-0 text-yellow-400' />
							) : (
								<CircleCheck className='size-3 shrink-0 text-green-400' />
							)}
						</div>
						<div className='w-full truncate text-12 text-white/50'>{account.displayName}</div>
						<div className='text-12 text-white/40'>
							{accountClouds.length === 0
								? t('files-cloud.account-no-folders')
								: t('files-cloud.account-folders', {count: accountClouds.length})}
						</div>
					</button>
				</ContextMenuTrigger>
				{/* Quiet corner affordance for the manage dialog; the tile itself opens the listing. */}
				<button
					type='button'
					aria-label={t('files-cloud.manage')}
					onClick={onManage}
					className='absolute top-1.5 right-1.5 rounded-full p-1.5 text-white/60 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/10 hover:text-white focus:outline-hidden focus-visible:bg-white/10 focus-visible:opacity-100'
				>
					<MoreHorizontal className='size-4' />
				</button>
			</div>
			<ContextMenuContent>
				<ContextMenuItem onClick={onManage}>{t('files-cloud.manage')}</ContextMenuItem>
				<ContextMenuItem
					className={contextMenuClasses.item.rootDestructive}
					onClick={() => onDisconnect(accountClouds)}
				>
					{t('files-cloud.manage-disconnect')}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}

// Mirrors the manage dialog's first-run pitch so the empty route sells the feature
function EmptyState({providers, onConnect}: {providers?: CloudProvider[]; onConnect: () => void}) {
	const {t} = useTranslation()
	return (
		// Centered by the auto margins on its first and last items rather than by the
		// container, so when the pitch is taller than the card (larger text, a longer
		// language, a short phone) it scrolls from the top instead of losing both ends
		<div className='umbrel-hide-scrollbar flex h-full flex-col items-center gap-5 overflow-y-auto px-1 text-center'>
			<CloudIcon className='mt-auto size-14 shrink-0' />
			<p className='text-19 font-semibold -tracking-2'>{t('files-cloud.pitch-title')}</p>
			<CloudPitchPoints />
			<div className='flex items-center gap-3 py-1'>
				{providers?.map((provider) => (
					<img
						key={provider.id}
						src={CLOUD_PROVIDER_LOGOS[provider.id]}
						alt={provider.displayName}
						title={provider.displayName}
						className='size-7 object-contain'
						draggable={false}
					/>
				))}
			</div>
			<Button variant='primary' size='dialog' className='shrink-0' onClick={onConnect}>
				{t('files-cloud.pitch-cta')}
			</Button>
			{/* The dock floats over the page's end: the pitch stops above it, and its
			    button scrolls clear of it when the pitch is taller than the page */}
			<DockSpacer className='mb-auto' />
		</div>
	)
}
