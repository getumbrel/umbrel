import {formatDistanceToNowStrict} from 'date-fns'
import {KeyRound, Pause, Play, RefreshCw, Trash2, TriangleAlert} from 'lucide-react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {MdContentCopy} from 'react-icons/md'
import {useNavigate as useRouterNavigate} from 'react-router-dom'
import {useCopyToClipboard} from 'react-use'

import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {Drawer, DrawerContent, DrawerHeader, DrawerScroller, DrawerTitle} from '@/components/ui/drawer'
import {IconButton} from '@/components/ui/icon-button'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {CloudLinkDiagram} from '@/features/files/components/shared/cloud-constellation'
import {CLOUD_PROVIDER_LOGOS} from '@/features/files/constants'
import {
	cloudSyncName,
	useCloudAccounts,
	useCloudActions,
	useCloudProviders,
	type CloudSync,
} from '@/features/files/hooks/use-cloud'
import {cloudAccountBrand, cloudBrandName} from '@/features/files/utils/cloud'
import {useIsMobile, useIsPhone} from '@/hooks/use-is-mobile'
import {useConfirmation} from '@/providers/confirmation'
import {languageCodeToDateLocale} from '@/utils/date-time'
import {useLinkToDialog} from '@/utils/dialog'
import {sleep} from '@/utils/misc'

export function FactRow({label, value}: {label: string; value: React.ReactNode}) {
	return (
		<div className='flex items-baseline justify-between gap-6 px-3.5 py-2.5'>
			<span className='shrink-0 text-13 text-white/50'>{label}</span>
			<span className='min-w-0 text-right text-13 break-words'>{value}</span>
		</div>
	)
}

// One-click copy for pasting the error into a support thread: CopyableField's
// quiet copy affordance, without forcing the prose message into its one-line
// input.
function CopyMessageButton({message}: {message: string}) {
	const {t} = useTranslation()
	const [, copyToClipboard] = useCopyToClipboard()
	const [showCopied, setShowCopied] = useState(false)
	return (
		<Tooltip open={showCopied}>
			<TooltipTrigger asChild>
				<button
					type='button'
					aria-label={t('files-action.copy')}
					onClick={async () => {
						copyToClipboard(message)
						setShowCopied(true)
						await sleep(1000)
						setShowCopied(false)
					}}
					className='-my-1 -mr-1 shrink-0 rounded-full p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white'
				>
					<MdContentCopy className='size-3.5' />
				</button>
			</TooltipTrigger>
			<TooltipContent>{t('clipboard.copied')}</TooltipContent>
		</Tooltip>
	)
}

// Everything about one cloud download, opened from its folder banner: where it
// downloads from, on which account, its schedule, and the controls that are
// too heavy for the banner itself (pause/resume, reauthentication, removal).
export function CloudDetailsDialog({
	cloud,
	open,
	onOpenChange,
}: {
	cloud: CloudSync
	open: boolean
	onOpenChange: (open: boolean) => void
}) {
	const {t, i18n} = useTranslation()
	const isMobile = useIsMobile()
	const isPhone = useIsPhone()
	const {data: accounts} = useCloudAccounts({enabled: open})
	const {pauseSync, resumeSync, removeSync, runNow, isPausing, isResuming, isRunningNow} = useCloudActions()
	const confirm = useConfirmation()
	const routerNavigate = useRouterNavigate()
	const linkToDialog = useLinkToDialog()

	const {data: providers} = useCloudProviders({enabled: open})
	const account = accounts?.find(({id}) => id === cloud.accountId)
	const brand = account ? cloudAccountBrand(account) : 'cloud'
	const brandName = cloudBrandName(brand, providers) ?? account?.provider ?? ''
	// The last remote path segment; empty when the whole cloud is downloaded
	const remoteFolder = cloud.remote.path.split('/').filter(Boolean).at(-1)
	const name = cloudSyncName(cloud)
	const status = cloud.status
	const attention = status.state === 'needs-attention' ? status.attention : undefined
	const failureMessage = attention?.kind === 'error' ? attention.message : undefined
	const isPaused = status.state === 'paused'

	const formatTime = (timestamp: number) =>
		new Date(timestamp).toLocaleTimeString(i18n.language, {hour: 'numeric', minute: '2-digit'})
	const ago = (timestamp: number) =>
		formatDistanceToNowStrict(new Date(timestamp), {
			addSuffix: true,
			locale: languageCodeToDateLocale[i18n.language as keyof typeof languageCodeToDateLocale],
		})

	const handleRemove = async () => {
		try {
			await confirm({
				title: t('files-cloud.remove-confirm-title', {folder: name}),
				message: t('files-cloud.remove-confirm-message'),
				actions: [
					{label: t('files-cloud.remove-confirm-action'), value: 'remove', variant: 'destructive'},
					{label: t('cancel'), value: 'cancel', variant: 'default'},
				],
			})
			removeSync(cloud.id).catch(() => {})
			onOpenChange(false)
		} catch {
			// User cancelled
		}
	}

	const body = (
		<div className='flex flex-col gap-4'>
			<div className='flex justify-center pt-1'>
				{/* Any attention kind means nothing is flowing, so the link wears
				    the alert badge rather than a live shine */}
				<CloudLinkDiagram
					layoutKey={brand}
					logo={CLOUD_PROVIDER_LOGOS[brand] ?? '/assets/cloud/cloud.webp'}
					morph={false}
					entrance={false}
					state={attention ? 'alert' : isPaused ? 'paused' : 'live'}
				/>
			</div>

			{/* The failure reason in full: the banner behind this dialog only
			    carries a one-line sentence, so the raw rclone message renders
			    here where any length fits */}
			{failureMessage && (
				<div className='flex items-center gap-2 rounded-lg bg-yellow-400/10 px-2.5 py-1.5'>
					<TriangleAlert className='size-3.5 shrink-0 text-yellow-400' />
					<span className='min-w-0 flex-1 text-12 leading-relaxed break-words text-white/90'>{failureMessage}</span>
					<CopyMessageButton message={failureMessage} />
				</div>
			)}

			<div className='divide-y divide-white/6 rounded-xl border border-white/10 bg-white/5'>
				{/* The remote folder with the provider it lives on; only the folder
			    name truncates so the provider always stays visible */}
				<FactRow
					label={t('files-cloud.details-source')}
					value={
						remoteFolder ? (
							<span className='flex min-w-0 items-baseline justify-end' title={cloud.remote.path}>
								<span className='truncate'>'{remoteFolder}</span>
								<span className='shrink-0'>' {t('files-cloud.details-source-on', {provider: brandName})}</span>
							</span>
						) : (
							t('files-cloud.details-source-everything', {provider: brandName})
						)
					}
				/>
				{account && <FactRow label={t('files-cloud.details-account')} value={account.displayName} />}
				<FactRow
					label={t('files-cloud.details-mode')}
					value={cloud.mode === 'auto' ? t('files-cloud.details-mode-auto') : t('files-cloud.details-mode-once')}
				/>
				{cloud.lastSuccessfulAt && (
					<FactRow label={t('files-cloud.details-last-updated')} value={ago(cloud.lastSuccessfulAt)} />
				)}
				{(status.nextRunAt || isPaused) && (
					<FactRow
						label={t('files-cloud.details-next-check')}
						value={isPaused ? t('files-cloud.chip-paused') : formatTime(status.nextRunAt ?? 0)}
					/>
				)}
			</div>

			<div className='flex flex-wrap items-center justify-between gap-2'>
				<div className='flex items-center gap-2'>
					{attention?.kind === 'auth' && (
						<IconButton
							icon={KeyRound}
							variant='primary'
							onClick={() => {
								onOpenChange(false)
								routerNavigate(linkToDialog('files-cloud-add', {account: cloud.accountId, reauth: '1'}))
							}}
						>
							{t('files-cloud.folder-sign-in')}
						</IconButton>
					)}
					<IconButton
						icon={isPaused ? Play : Pause}
						onClick={() => (isPaused ? resumeSync(cloud.id) : pauseSync(cloud.id)).catch(() => {})}
						disabled={isPausing || isResuming}
					>
						{isPaused ? t('files-cloud.resume') : t('files-cloud.pause')}
					</IconButton>
					{/* Phones have no refresh in the banner, so this carries it */}
					{isMobile && (
						<IconButton
							icon={RefreshCw}
							onClick={() => runNow(cloud.id).catch(() => {})}
							disabled={
								isRunningNow ||
								status.state === 'running' ||
								status.state === 'queued' ||
								(attention !== undefined && attention.kind !== 'error')
							}
						>
							{t('files-cloud.refresh-now')}
						</IconButton>
					)}
				</div>
				<IconButton icon={Trash2} className='text-destructive2-lightest' onClick={handleRemove}>
					{t('files-cloud.remove-download')}
				</IconButton>
			</div>
		</div>
	)

	if (isPhone) {
		return (
			<Drawer open={open} onOpenChange={onOpenChange}>
				<DrawerContent>
					<DrawerHeader>
						<DrawerTitle>{name}</DrawerTitle>
					</DrawerHeader>
					<DrawerScroller>{body}</DrawerScroller>
				</DrawerContent>
			</Drawer>
		)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='flex flex-col'>
				<DialogHeader>
					<DialogTitle className='px-6 text-center'>{name}</DialogTitle>
				</DialogHeader>
				{body}
				<DialogFooter />
			</DialogContent>
		</Dialog>
	)
}
