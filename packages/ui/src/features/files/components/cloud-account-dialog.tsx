import {formatDistanceToNowStrict} from 'date-fns'
import {KeyRound, PlusCircle, Unplug} from 'lucide-react'
import {useTranslation} from 'react-i18next'
import {useNavigate as useRouterNavigate} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/components/ui/drawer'
import {IconButton} from '@/components/ui/icon-button'
import {ScrollArea} from '@/components/ui/scroll-area'
import {FactRow} from '@/features/files/components/cloud-details-dialog'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {CLOUD_PROVIDER_LOGOS} from '@/features/files/constants'
import {
	cloudSyncName,
	useCloudProviders,
	useCloudSyncs,
	type CloudAccount,
	type CloudSync,
} from '@/features/files/hooks/use-cloud'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {cloudAccountBrand, cloudBrandName} from '@/features/files/utils/cloud'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
import {useIsPhone} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {languageCodeToDateLocale} from '@/utils/date-time'
import {useLinkToDialog} from '@/utils/dialog'

// Everything about one connected account, opened from the sidebar or the
// /Cloud tiles: who it is, whether it is healthy, every folder downloading
// from it with its live status, and the account-level controls
// (reauthentication, disconnecting).
export function CloudAccountDialog({
	account,
	onOpenChange,
	onSignIn,
	onAddDownload,
	onDisconnect,
}: {
	account: CloudAccount | null
	onOpenChange: (open: boolean) => void
	// Overrides the reauth deep link for hosts that drive reauthentication
	// themselves (the add wizard, which is already open at that route)
	onSignIn?: (account: CloudAccount) => void
	// Same override for adding a download from this account
	onAddDownload?: (account: CloudAccount) => void
	onDisconnect: (account: CloudAccount) => void
}) {
	const {t, i18n} = useTranslation()
	const isPhone = useIsPhone()
	const open = Boolean(account)
	const {data: providers} = useCloudProviders({enabled: open})
	const {data: clouds} = useCloudSyncs()
	const {navigateToDirectory} = useNavigate()
	const routerNavigate = useRouterNavigate()
	const linkToDialog = useLinkToDialog()

	if (!account) return null

	const brand = cloudAccountBrand(account)
	const brandName = cloudBrandName(brand, providers) ?? account.provider
	const accountClouds = clouds?.filter(({accountId}) => accountId === account.id) ?? []
	// Account-level aggregates from data already on the clouds: the freshest
	// successful download and the soonest scheduled check
	const lastUpdatedAt = accountClouds.reduce<number | undefined>(
		(latest, {lastSuccessfulAt}) =>
			lastSuccessfulAt && (!latest || lastSuccessfulAt > latest) ? lastSuccessfulAt : latest,
		undefined,
	)
	const nextRunAt = accountClouds.reduce<number | undefined>((soonest, cloud) => {
		const next = cloud.status.state === 'paused' ? undefined : cloud.status.nextRunAt
		return next && (!soonest || next < soonest) ? next : soonest
	}, undefined)
	const allPaused = accountClouds.length > 0 && accountClouds.every(({status}) => status.state === 'paused')
	const needsAuth = account.attention?.kind === 'auth'
	// Three rows read at a glance; more scroll inside a fixed viewport
	const needsScroll = accountClouds.length > 3

	const formatTime = (timestamp: number) =>
		new Date(timestamp).toLocaleTimeString(i18n.language, {hour: 'numeric', minute: '2-digit'})
	const ago = (timestamp: number) =>
		formatDistanceToNowStrict(new Date(timestamp), {
			addSuffix: true,
			locale: languageCodeToDateLocale[i18n.language as keyof typeof languageCodeToDateLocale],
		})

	// One quiet line per folder: the lifecycle state when something is
	// happening or wrong, the last successful download otherwise
	const cloudStatus = (cloud: CloudSync): {text: string; attention?: boolean} => {
		const status = cloud.status
		if (status.state === 'running' || status.state === 'queued') return {text: t('files-cloud.chip-updating')}
		if (status.state === 'paused') return {text: t('files-cloud.chip-paused')}
		if (status.state === 'needs-attention') {
			const kind = status.attention?.kind
			if (kind === 'auth') return {text: t('files-cloud.manage-status-auth'), attention: true}
			if (kind === 'quota') return {text: t('files-cloud.chip-rate-limited'), attention: true}
			if (kind === 'destination-missing') return {text: t('files-cloud.chip-disconnected'), attention: true}
			return {text: t('files-cloud.banner-failed'), attention: true}
		}
		if (cloud.lastSuccessfulAt) return {text: t('files-cloud.banner-updated', {ago: ago(cloud.lastSuccessfulAt)})}
		return {text: t('files-cloud.chip-waiting')}
	}

	const accountStatus = needsAuth
		? {text: t('files-cloud.manage-status-auth'), attention: true}
		: account.attention?.kind === 'quota'
			? {text: t('files-cloud.chip-rate-limited'), attention: true}
			: {text: t('files-cloud.account-status-connected')}

	const openFolder = (cloud: CloudSync) => {
		onOpenChange(false)
		navigateToDirectory(cloud.destination.path)
	}

	const downloadRows = accountClouds.map((cloud) => {
		const status = cloudStatus(cloud)
		return (
			<button
				key={cloud.id}
				type='button'
				onClick={() => openFolder(cloud)}
				className='flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-white/10 focus:outline-hidden focus-visible:bg-white/10'
			>
				<FileItemIcon
					item={{
						path: cloud.destination.path,
						type: 'directory',
						name: cloudSyncName(cloud),
						operations: [],
						size: 0,
						modified: 0,
					}}
					className='h-8 w-8'
				/>
				<span className='min-w-0 flex-1'>
					<span className='block truncate text-13'>{formatItemName({name: cloudSyncName(cloud)})}</span>
					<span className={cn('block truncate text-12', status.attention ? 'text-yellow-400' : 'text-white/50')}>
						{status.text}
					</span>
				</span>
			</button>
		)
	})

	const body = (
		<div className='flex flex-col gap-4'>
			{/* Identity block: the mark and who this is, with the credential action
			    riding the row's right edge */}
			<div className='flex items-center gap-3.5'>
				<img src={CLOUD_PROVIDER_LOGOS[brand]} alt='' className='size-14 shrink-0 object-contain' draggable={false} />
				<div className='min-w-0 flex-1'>
					<p className='truncate text-15 font-semibold -tracking-2'>{brandName}</p>
					<p className='truncate text-13 text-white/50'>{account.displayName}</p>
				</div>
				<IconButton
					icon={KeyRound}
					variant={needsAuth ? 'primary' : 'default'}
					className='shrink-0'
					onClick={() => {
						onOpenChange(false)
						if (onSignIn) onSignIn(account)
						else routerNavigate(linkToDialog('files-cloud-add', {account: account.id, reauth: '1'}))
					}}
				>
					{t('files-cloud.folder-sign-in')}
				</IconButton>
			</div>

			<div className='divide-y divide-white/6 rounded-xl border border-white/10 bg-white/5'>
				{account.connection.kind === 'webdav' && (
					<FactRow
						label={t('files-cloud.account-server')}
						value={
							<span className='block truncate' title={account.connection.url}>
								{account.connection.url}
							</span>
						}
					/>
				)}
				{account.connection.kind === 'icloud' && (
					<FactRow
						label={t('files-cloud.account-apple-id')}
						value={
							<span className='block truncate' title={account.connection.appleId}>
								{account.connection.appleId}
							</span>
						}
					/>
				)}
				<FactRow
					label={t('files-cloud.account-status')}
					value={
						<span className='flex items-center justify-end gap-1.5'>
							<span className={cn('size-2 rounded-full', accountStatus.attention ? 'bg-yellow-400' : 'bg-green-400')} />
							<span className={cn(accountStatus.attention && 'text-yellow-400')}>{accountStatus.text}</span>
						</span>
					}
				/>
				{/* OAuth and iCloud connections are scoped read-only, worth saying out
				    loud; WebDAV credentials are the server's own, so no claim there */}
				{account.connection.kind !== 'webdav' && (
					<FactRow label={t('files-cloud.account-access')} value={t('files-cloud.account-access-read-only')} />
				)}
				{lastUpdatedAt && <FactRow label={t('files-cloud.details-last-updated')} value={ago(lastUpdatedAt)} />}
				{(nextRunAt || allPaused) && (
					<FactRow
						label={t('files-cloud.details-next-check')}
						value={nextRunAt ? formatTime(nextRunAt) : t('files-cloud.chip-paused')}
					/>
				)}
			</div>

			<div className='space-y-1.5'>
				<div className='flex items-center justify-between'>
					<p className='text-13 text-white/60'>{t('files-cloud.account-downloads')}</p>
					<Button
						size='sm'
						onClick={() => {
							onOpenChange(false)
							if (onAddDownload) onAddDownload(account)
							else routerNavigate(linkToDialog('files-cloud-add', {account: account.id}))
						}}
					>
						{t('files-cloud.account-add')}
						<PlusCircle className='h-3 w-3' />
					</Button>
				</div>
				{accountClouds.length === 0 ? (
					<p className='rounded-xl border border-white/10 bg-white/5 p-3 text-12 text-white/50'>
						{t('files-cloud.account-empty')}
					</p>
				) : needsScroll ? (
					<div className='h-[170px] overflow-hidden rounded-xl border border-white/10 bg-white/5'>
						<ScrollArea className='h-full'>
							<div className='divide-y divide-white/6'>{downloadRows}</div>
						</ScrollArea>
					</div>
				) : (
					<div className='divide-y divide-white/6 overflow-hidden rounded-xl border border-white/10 bg-white/5'>
						{downloadRows}
					</div>
				)}
			</div>

			<div className='flex justify-end'>
				<IconButton icon={Unplug} className='text-destructive2-lightest' onClick={() => onDisconnect(account)}>
					{t('files-cloud.manage-disconnect')}
				</IconButton>
			</div>
		</div>
	)

	// The identity block carries the visible title; the structural title and
	// description stay for screen readers only
	if (isPhone) {
		return (
			<Drawer open={open} onOpenChange={onOpenChange}>
				<DrawerContent>
					<DrawerHeader className='sr-only'>
						<DrawerTitle>{brandName}</DrawerTitle>
						<DrawerDescription>{account.displayName}</DrawerDescription>
					</DrawerHeader>
					<DrawerScroller>{body}</DrawerScroller>
				</DrawerContent>
			</Drawer>
		)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='flex flex-col'>
				<DialogHeader className='sr-only'>
					<DialogTitle>{brandName}</DialogTitle>
					<DialogDescription>{account.displayName}</DialogDescription>
				</DialogHeader>
				{body}
			</DialogContent>
		</Dialog>
	)
}
