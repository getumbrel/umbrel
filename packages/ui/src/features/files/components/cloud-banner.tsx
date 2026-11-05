import {formatDistanceToNowStrict} from 'date-fns'
import {Check, MoreHorizontal, RefreshCw, TriangleAlert, type LucideIcon} from 'lucide-react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate as useRouterNavigate} from 'react-router-dom'

import {MarqueeText} from '@/components/ui/marquee-text'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {CloudDetailsDialog} from '@/features/files/components/cloud-details-dialog'
import {CLOUD_PROVIDER_LOGOS} from '@/features/files/constants'
import {
	cloudSyncContainingPath,
	cloudSyncRemoteName,
	useCloudAccounts,
	useCloudActions,
	useCloudProviders,
	useCloudSyncs,
} from '@/features/files/hooks/use-cloud'
import {cloudAccountBrand, cloudBrandName} from '@/features/files/utils/cloud'
import {cn} from '@/lib/utils'
import {languageCodeToDateLocale} from '@/utils/date-time'
import {useLinkToDialog} from '@/utils/dialog'

// Mostly a quiet readout: text plus a small glyph. The updating state drops
// its icon because the refresh button beside it is already spinning. Two
// states carry an onClick and render as buttons: auth (signing in again is
// the only fix) and error (View error opens the details dialog).
type Chip = {
	icon?: LucideIcon
	label: string
	tooltip?: string
	className: string
	onClick?: () => void
	/** Show only the glyph on phones. Just for a glyph that reads on its own: the
	 * warnings share one, and tooltips don't open on touch, so they keep their label */
	glyphOnPhones?: boolean
}

// Keep these as *TKey properties: update-translations.js recognizes that
// convention when a translation key is selected dynamically.
const identityTKeys = {
	autoRootTKey: 'files-cloud.banner-auto-root',
	autoTKey: 'files-cloud.banner-auto',
	onceRootTKey: 'files-cloud.banner-once-root',
	onceTKey: 'files-cloud.banner-once',
} as const

// A slim banner pinned above the listing when the current directory is a cloud
// download destination; renders nothing everywhere else. Three stable layers
// on a single line: an identity sentence (swapped for an error sentence when
// the last run failed), a short status chip, and quiet icon actions (refresh,
// details). Live transfer progress belongs to the floating island, so nothing
// here animates numbers.
export function CloudBanner({path}: {path: string}) {
	const {t, i18n} = useTranslation()
	const {data: clouds} = useCloudSyncs()
	// Matches anywhere inside the mirrored subtree, not just the destination
	// root: subdirectories are equally read-only and deep links land in them
	const cloud = cloudSyncContainingPath(clouds, path)
	const {data: providers} = useCloudProviders({enabled: Boolean(cloud)})
	const {data: accounts} = useCloudAccounts({enabled: Boolean(cloud)})
	const {runNow, isRunningNow} = useCloudActions()
	const [detailsOpen, setDetailsOpen] = useState(false)
	const routerNavigate = useRouterNavigate()
	const linkToDialog = useLinkToDialog()

	const status = cloud?.status
	if (!cloud || !status) return null

	const account = accounts?.find(({id}) => id === cloud.accountId)
	const brand = account ? cloudAccountBrand(account) : 'cloud'
	const provider = cloudBrandName(brand, providers) ?? account?.displayName ?? 'Cloud'
	const logo = CLOUD_PROVIDER_LOGOS[brand] ?? '/assets/cloud/cloud.webp'
	const remote = cloudSyncRemoteName(cloud, provider)
	// Downloading the provider's root would read as "downloads 'ownCloud' from
	// ownCloud", so root downloads drop the quoted folder name
	const isRootRemote = cloud.remote.path.split('/').filter(Boolean).length === 0
	const identityTKey =
		cloud.mode === 'auto'
			? isRootRemote
				? identityTKeys.autoRootTKey
				: identityTKeys.autoTKey
			: isRootRemote
				? identityTKeys.onceRootTKey
				: identityTKeys.onceTKey

	const relative = (timestamp: number) =>
		formatDistanceToNowStrict(new Date(timestamp), {
			addSuffix: true,
			locale: languageCodeToDateLocale[i18n.language as keyof typeof languageCodeToDateLocale],
		})

	const attention = status.state === 'needs-attention' ? status.attention : undefined
	// A failed run tints the whole banner and swaps the identity sentence for
	// an error one; the sanitized rclone reason (when the backend captured one)
	// is too long for a banner line, so it lives in the details dialog
	const isFailed = attention?.kind === 'error'
	const failureMessage = isFailed ? attention.message : undefined
	const isBusy = status.state === 'running' || status.state === 'queued'

	const chip: Chip | null = (() => {
		if (isBusy) {
			return {label: t('files-cloud.chip-updating'), className: 'text-white/60'}
		}
		if (status.state === 'paused') {
			return {
				label: t('files-cloud.chip-paused'),
				tooltip: cloud.pauseReasons?.restore ? t('files-cloud.banner-paused-restore') : t('files-cloud.banner-paused'),
				className: 'text-white/60',
			}
		}
		if (attention?.kind === 'auth') {
			return {
				icon: TriangleAlert,
				label: t('files-cloud.chip-sign-in'),
				tooltip: t('files-cloud.banner-auth'),
				className: 'text-yellow-400 hover:bg-yellow-400/10',
				onClick: () => routerNavigate(linkToDialog('files-cloud-add', {account: cloud.accountId, reauth: '1'})),
			}
		}
		if (attention?.kind === 'quota') {
			return {
				icon: TriangleAlert,
				label: t('files-cloud.chip-rate-limited'),
				tooltip: t('files-cloud.banner-quota', {provider}),
				className: 'text-yellow-400',
			}
		}
		if (attention?.kind === 'destination-missing') {
			const destination = cloud.destination
			return {
				icon: TriangleAlert,
				label: t('files-cloud.chip-disconnected'),
				tooltip: destination.path.startsWith('/Network/')
					? t('files-cloud.banner-destination-missing-network', {
							share: destination.share,
							host: destination.host,
						})
					: t('files-cloud.banner-destination-missing-external', {
							volume: destination.path.split('/').filter(Boolean)[1] ?? '',
						}),
				className: 'text-yellow-400',
			}
		}
		if (isFailed) {
			// Without a captured reason there's nothing behind the button, so
			// the tinted banner sentence stands alone
			if (!failureMessage) return null
			return {
				label: t('files-cloud.view-error'),
				className: 'bg-yellow-400/15 text-yellow-400 hover:bg-yellow-400/25',
				onClick: () => setDetailsOpen(true),
			}
		}
		if (cloud.lastSuccessfulAt) {
			return {
				icon: Check,
				label: t('files-cloud.chip-up-to-date'),
				tooltip: t('files-cloud.banner-updated', {ago: relative(cloud.lastSuccessfulAt)}),
				className: 'text-green-400',
				glyphOnPhones: true,
			}
		}
		return {label: t('files-cloud.chip-waiting'), className: 'text-white/60'}
	})()

	// Refresh queues one download without changing a persisted pause. Attention
	// states with a blocked account have nothing useful to retry.
	const isPaused = status.state === 'paused'
	const canRefresh = !isBusy && !isRunningNow && (!attention || attention.kind === 'error')
	const refreshTooltip =
		status.nextRunAt && !isBusy && !isPaused
			? t('files-cloud.refresh-tooltip', {when: relative(status.nextRunAt)})
			: t('files-cloud.refresh-now')

	const ChipIcon = chip?.icon

	return (
		<>
			<div className={cn('mb-3 rounded-xl px-3 py-2 transition-colors', isFailed ? 'bg-yellow-400/10' : 'bg-white/4')}>
				<div className='flex items-center gap-3'>
					<img src={logo} alt={provider} className='size-6 shrink-0 object-contain' draggable={false} />
					<MarqueeText
						className={cn('min-w-0 flex-1 text-13', isFailed ? 'text-white/90' : 'text-white/70')}
						text={isFailed ? t('files-cloud.banner-error', {provider}) : t(identityTKey, {remote, provider})}
					/>

					{chip && (
						<Tooltip>
							<TooltipTrigger asChild>
								{chip.onClick ? (
									<button
										type='button'
										onClick={chip.onClick}
										className={cn(
											'-my-1 flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-12 transition-colors',
											chip.className,
										)}
									>
										{ChipIcon && <ChipIcon className='size-3.5' />}
										<span className={cn(chip.glyphOnPhones && 'max-sm:sr-only')}>{chip.label}</span>
									</button>
								) : (
									<span className={cn('flex shrink-0 cursor-default items-center gap-1 text-12', chip.className)}>
										{ChipIcon && <ChipIcon className='size-3.5' />}
										<span className={cn(chip.glyphOnPhones && 'max-sm:sr-only')}>{chip.label}</span>
									</span>
								)}
							</TooltipTrigger>
							{chip.tooltip && <TooltipContent side='bottom'>{chip.tooltip}</TooltipContent>}
						</Tooltip>
					)}

					{/* A tight control cluster so the icons read as one group; refresh
					    lives in the details drawer on phones */}
					<div className='-mr-1.5 flex shrink-0 items-center gap-0.5'>
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type='button'
									aria-label={t('files-cloud.refresh-now')}
									onClick={() => runNow(cloud.id).catch(() => {})}
									disabled={!canRefresh}
									className='hidden shrink-0 rounded-full p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40 sm:flex'
								>
									<RefreshCw className={cn('size-4', isBusy && 'animate-spin')} />
								</button>
							</TooltipTrigger>
							<TooltipContent side='bottom'>{refreshTooltip}</TooltipContent>
						</Tooltip>

						<button
							type='button'
							aria-label={t('files-cloud.details-title')}
							onClick={() => setDetailsOpen(true)}
							className='shrink-0 rounded-full p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white'
						>
							<MoreHorizontal className='size-4' />
						</button>
					</div>
				</div>
			</div>

			<CloudDetailsDialog cloud={cloud} open={detailsOpen} onOpenChange={setDetailsOpen} />
		</>
	)
}
