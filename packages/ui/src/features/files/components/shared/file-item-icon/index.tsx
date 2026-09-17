import React, {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {BsTrash2} from 'react-icons/bs'
import {IoPlay} from 'react-icons/io5'
import {RiAlertFill} from 'react-icons/ri'

import backupsIcon from '@/features/backups/assets/backups-icon.png'
import {AppsIcon} from '@/features/files/assets/apps-icon'
import {CloudIcon} from '@/features/files/assets/cloud-icon'
import externalStorageIcon from '@/features/files/assets/external-storage-icon.png'
import {HomeIcon} from '@/features/files/assets/home-icon'
import {MachinesIcon} from '@/features/files/assets/machines-icon'
import activeNasIcon from '@/features/files/assets/nas-icon-active.png'
import nasIconInactive from '@/features/files/assets/nas-icon-inactive.png'
import networkIcon from '@/features/files/assets/network-icon.png'
import {RecentsIcon} from '@/features/files/assets/recents-icon'
import {SharedFolderBadge} from '@/features/files/assets/shared-folder-badge'
import umbrelDeviceActive from '@/features/files/assets/umbrel-device-icon-active.png'
import umbrelDeviceInactive from '@/features/files/assets/umbrel-device-icon-inactive.png'
import {AnimatedFolderIcon} from '@/features/files/components/shared/file-item-icon/animated-folder-icon'
import {
	DocumentsIcon,
	DownloadsIcon,
	PhotosIcon,
	VideosIcon,
} from '@/features/files/components/shared/file-item-icon/embedded-overlay-icons'
import {FolderIcon as SimpleFolderIcon} from '@/features/files/components/shared/file-item-icon/folder-icon'
import {UnknownFileThumbnail} from '@/features/files/components/shared/file-item-icon/unknown-file-thumbnail'
import {
	APPS_PATH,
	BACKUPS_PATH,
	CLOUD_PATH,
	CLOUD_PROVIDER_LOGOS,
	FILE_TYPE_MAP,
	HOME_PATH,
	IMAGE_EXTENSIONS_WITH_IMAGE_THUMBNAILS,
	MACHINES_PATH,
	NETWORK_STORAGE_PATH,
	RECENTS_PATH,
	TRASH_PATH,
	VIDEO_EXTENSIONS_WITH_IMAGE_THUMBNAILS,
} from '@/features/files/constants'
import {useCloudAccounts} from '@/features/files/hooks/use-cloud'
import {useCloudBadge} from '@/features/files/hooks/use-cloud-badge'
import {MachineFolderMetadata} from '@/features/files/hooks/use-machine-folder'
import {useNetworkDeviceType} from '@/features/files/hooks/use-network-device-type'
import {useNetworkStorage} from '@/features/files/hooks/use-network-storage'
import {useOnDemandThumbnail} from '@/features/files/hooks/use-on-demand-thumbnail'
import {useShares} from '@/features/files/hooks/use-shares'
import type {FileSystemItem} from '@/features/files/types'
import {CLOUD_SELF_TILE_BRANDS, cloudAccountBrand} from '@/features/files/utils/cloud'
import {splitFileName} from '@/features/files/utils/format-filesystem-name'
import {isDirectoryANetworkDevice} from '@/features/files/utils/is-directory-a-network-device-or-share'
import {isDirectoryAnExternalDrivePartition} from '@/features/files/utils/is-directory-an-external-drive-partition'
import {OsIcon} from '@/features/machines/components/os-icon'
import type {Machine} from '@/features/machines/types'
import {EnsureHttpUrlAuthorizer, useSharedAuthorizedHttpUrl} from '@/modules/auth/http-url-authorizer'

interface FileItemIconProps {
	item: FileSystemItem
	// undefined resolves metadata from the Files-level map; null means the
	// caller already resolved the path and found no matching machine.
	machine?: Machine | null
	onlySVG?: boolean
	className?: string
	useAnimatedIcon?: boolean
	isHovered?: boolean
	// Overlay badges (share, cloud, app folder) have minimum sizes tuned for
	// listing icons; compact contexts like breadcrumbs turn them off
	showBadges?: boolean
}

export const FileItemIcon = (props: FileItemIconProps) => {
	if (props.machine !== undefined) return <FileItemIconContent {...props} machine={props.machine ?? undefined} />
	return (
		<MachineFolderMetadata path={props.item.path}>
			{({machine}) => <FileItemIconContent {...props} machine={machine} />}
		</MachineFolderMetadata>
	)
}

const FileItemIconContent = ({
	item,
	machine,
	onlySVG,
	className,
	useAnimatedIcon = false,
	isHovered = false,
	showBadges = true,
}: FileItemIconProps) => {
	const {t} = useTranslation()
	const {isPathShared} = useShares()
	const isShared = showBadges && isPathShared(item.path)
	const cloudProvider = useCloudBadge(item.path)
	// Flavor branding only matters for the handful of icons that carry a badge
	const {data: badgeAccounts} = useCloudAccounts({enabled: Boolean(cloudProvider)})
	const badgeAccount = badgeAccounts?.find(({id}) => id === cloudProvider?.accountId)
	const badgeBrand = badgeAccount ? cloudAccountBrand(badgeAccount) : cloudProvider?.provider

	const shareBadge = isShared ? (
		<div className='absolute top-0 left-0 flex size-1/2 max-h-8 min-h-[0.9rem] max-w-8 min-w-[0.9rem] translate-x-[-30%] translate-y-[-20%] items-center justify-center rounded-full border border-white/15 bg-linear-to-b from-brand to-[color-mix(in_srgb,hsl(var(--color-brand))_80%,black_20%)] shadow-md'>
			<SharedFolderBadge className='size-4/5' />
		</div>
	) : null

	// Brand badge on folders that are cloud destinations, styled as a sticker
	// slapped on the folder's corner: a tilted dark chip carrying the mark, or
	// the logo itself for brands that are already full app-icon squares. A
	// download that needs the user swaps the mark for an amber warning
	// triangle on the same sticker. Width-based sizing with aspect-square
	// keeps the sticker a true square; percentage heights would resolve
	// against the folder's shorter box and squash it.
	const badgeBrandId = badgeBrand ?? cloudProvider?.provider
	const cloudBadge =
		showBadges && cloudProvider ? (
			<div className='absolute top-0 right-0 aspect-square w-1/2 max-w-7 min-w-4 translate-x-[26%] translate-y-[-10%] rotate-[10deg]'>
				{cloudProvider.state === 'attention' ? (
					<span className='flex size-full items-center justify-center rounded-[30%] border border-white/25 bg-neutral-900 shadow-[0_2px_6px_rgba(0,0,0,0.6)]'>
						<RiAlertFill className='aspect-square w-[68%] text-yellow-400' />
					</span>
				) : badgeBrandId && CLOUD_SELF_TILE_BRANDS.has(badgeBrandId) ? (
					<img
						src={CLOUD_PROVIDER_LOGOS[badgeBrandId]}
						alt=''
						className='size-full rounded-[28%] object-contain shadow-[0_2px_6px_rgba(0,0,0,0.6)]'
						draggable={false}
					/>
				) : (
					<span className='flex size-full items-center justify-center rounded-[30%] border border-white/25 bg-neutral-900 shadow-[0_2px_6px_rgba(0,0,0,0.6)]'>
						<img
							src={CLOUD_PROVIDER_LOGOS[badgeBrandId ?? '']}
							alt=''
							className='aspect-square w-[62%] rounded-[16%] object-contain'
							draggable={false}
						/>
					</span>
				)}
			</div>
		) : null

	// Check if this is an app folder in either normal mode or rewind mode
	// Normal: /Apps/bitcoin
	// Rewind: /Backups/some-mount-dir/Apps/bitcoin
	const isAppFolder = (() => {
		// Match normal app path: /Apps/appId (but not /Apps/appId/data)
		if (item.path.startsWith(APPS_PATH)) {
			return item.path.slice(APPS_PATH.length).split('/').length === 2
		}

		// Match rewind app path: /Backups/xxx/Apps/appId (but not /Backups/xxx/Apps/appId/data)
		if (item.path.startsWith(BACKUPS_PATH)) {
			// Example: /Backups/2025-10-29T20:32:32.710Z/Apps/transmission
			// Split: ['', 'Backups', '2025-10-29T20:32:32.710Z', 'Apps', 'transmission']
			const parts = item.path.split('/')
			// Check: parts[0] === '', parts[1] === 'Backups', parts[3] === 'Apps', parts[4] === appId, parts[5] === undefined
			return parts.length === 5 && parts[1] === 'Backups' && parts[3] === 'Apps'
		}

		return false
	})()

	// External storage icon for the /External root or individual drive partitions
	if (item.type === 'directory' && (item.path === '/External' || isDirectoryAnExternalDrivePartition(item.path))) {
		return (
			<div className='relative'>
				<img src={externalStorageIcon} alt={t('external-drive')} className={className} draggable={false} />
				{shareBadge}
			</div>
		)
	}

	// Network share icon when browsing /Network
	if (item.type === 'directory' && isDirectoryANetworkDevice(item.path)) {
		return <NetworkDeviceIcon path={item.path} className={className} />
	}

	// Network root for synthetic MiniBrowser roots
	if (item.type === 'directory' && item.path === NETWORK_STORAGE_PATH) {
		return <img src={networkIcon} alt='Network' className={`${className ?? ''} object-contain`} draggable={false} />
	}

	if (item.type === 'directory' && item.name === 'Umbrel Backup.backup') {
		return <img src={backupsIcon} alt='Umbrel Backup' className={className} draggable={false} />
	}

	// External storage for sidebar and pathbar
	if (item.type === 'external-storage') {
		return <img src={externalStorageIcon} alt={t('external-drive')} className={className} draggable={false} />
	}

	// Network root for sidebar and pathbar
	if (item.type === 'network-root') {
		return <img src={networkIcon} alt='Network' className={`${className ?? ''} object-contain`} draggable={false} />
	}

	// Network share for sidebar and pathbar
	if (item.type === 'network-share') {
		return <NetworkDeviceIcon path={item.path} className={className} />
	}

	// Cloud account for the pathbar's virtual /Cloud/<accountId> route
	if (item.type === 'cloud-account') {
		return <CloudAccountIcon path={item.path} className={className} />
	}

	// Folder
	if (item.type === 'directory') {
		if (onlySVG) {
			return <SimpleFolderIcon className={className} skipFilter />
		}

		return (
			<div className='relative'>
				<FolderIcon className={className} path={item.path} useAnimatedIcon={useAnimatedIcon} isHovered={isHovered} />
				{showBadges && isAppFolder ? <AppFolderBottomIcon appId={extractAppIdFromPath(item.path)} /> : null}
				{showBadges && machine ? (
					<div className='absolute right-0 bottom-0 size-1/2 max-h-8 min-h-5 max-w-8 min-w-5 translate-x-[16%] translate-y-[10%] overflow-hidden rounded-[25%] shadow-md md:min-h-[0.9rem] md:min-w-[0.9rem]'>
						<OsIcon osId={machine.osId} state={machine.state} className='size-full' />
					</div>
				) : null}

				{shareBadge}
				{cloudBadge}
			</div>
		)
	}

	const definition = item.type ? FILE_TYPE_MAP[item.type as keyof typeof FILE_TYPE_MAP] : undefined
	const DefaultThumbnail = definition?.thumbnail as React.ComponentType<{className?: string}> | null | undefined

	// When rendering inside an SVG context, only return SVG-safe elements
	if (onlySVG) {
		return DefaultThumbnail ? (
			<DefaultThumbnail className={className} />
		) : (
			<UnknownFileThumbnail type={item.type || ''} className={className} />
		)
	}

	const {extension} = splitFileName(item.name)
	const fallback = DefaultThumbnail ? (
		<DefaultThumbnail className={className} />
	) : (
		<UnknownFileThumbnail type={item.type || ''} className={className} />
	)
	// Image file
	if (extension && IMAGE_EXTENSIONS_WITH_IMAGE_THUMBNAILS.has(extension.toLowerCase())) {
		return <ImageThumbnail item={item} fallback={fallback} className={className} />
	}

	// Video file
	if (extension && VIDEO_EXTENSIONS_WITH_IMAGE_THUMBNAILS.has(extension.toLowerCase())) {
		return <VideoThumbnail item={item} fallback={fallback} className={className} />
	}

	// Unknown file
	if (!DefaultThumbnail) return <UnknownFileThumbnail type={item.type || ''} className={className} />

	// All other supported file types
	return <DefaultThumbnail className={className} />
}

const FolderIcon = ({
	className = '',
	path,
	useAnimatedIcon,
	isHovered = false,
}: {
	className?: string
	path: string
	useAnimatedIcon: boolean
	isHovered?: boolean
}) => {
	const memberHome = path.match(/^(\/Users\/[^/]+)(?:\/|$)/)?.[1]
	const memberTrash = path.match(/^\/Users\/[^/]+\/Trash$/)?.[0]
	const homeRoot = memberHome ?? HOME_PATH

	if (path === homeRoot) {
		return <HomeIcon className={className} />
	}
	if (path === TRASH_PATH || path === memberTrash) {
		return <BsTrash2 className={className} />
	}
	if (path === RECENTS_PATH) {
		return <RecentsIcon className={className} />
	}
	if (path === APPS_PATH) {
		return <AppsIcon className={className} />
	}

	if (path === MACHINES_PATH) {
		return <MachinesIcon className={className} />
	}

	const FolderComponent = useAnimatedIcon ? AnimatedFolderIcon : SimpleFolderIcon

	if (path === `${homeRoot}/Videos`) {
		return useAnimatedIcon ? (
			<FolderComponent className={className} overlayIcon={VideosIcon} isHovered={isHovered} />
		) : (
			<FolderComponent className={className} overlayIcon={VideosIcon} />
		)
	}
	if (path === `${homeRoot}/Downloads`) {
		return useAnimatedIcon ? (
			<FolderComponent className={className} overlayIcon={DownloadsIcon} isHovered={isHovered} />
		) : (
			<FolderComponent className={className} overlayIcon={DownloadsIcon} />
		)
	}
	if (path === `${homeRoot}/Documents`) {
		return useAnimatedIcon ? (
			<FolderComponent className={className} overlayIcon={DocumentsIcon} isHovered={isHovered} />
		) : (
			<FolderComponent className={className} overlayIcon={DocumentsIcon} />
		)
	}
	if (path === `${homeRoot}/Photos`) {
		return useAnimatedIcon ? (
			<FolderComponent className={className} overlayIcon={PhotosIcon} isHovered={isHovered} />
		) : (
			<FolderComponent className={className} overlayIcon={PhotosIcon} />
		)
	}
	return useAnimatedIcon ? (
		<FolderComponent className={className} isHovered={isHovered} />
	) : (
		<FolderComponent className={className} />
	)
}

const AppFolderBottomIcon = ({appId}: {appId: string}) => {
	const [error, setError] = useState(false)
	const [loaded, setLoaded] = useState(false)

	return (
		<img
			onError={() => setError(true)}
			onLoad={() => setLoaded(true)}
			src={`https://getumbrel.github.io/umbrel-apps-gallery/${appId}/icon.svg`}
			alt={appId}
			className={`absolute right-0 bottom-0 flex h-1/2 max-h-8 min-h-5 w-1/2 max-w-8 min-w-5 translate-x-[16%] translate-y-[10%] items-center justify-center overflow-hidden rounded-[25%] border border-white/15 object-contain shadow-md md:min-h-[0.9rem] md:min-w-[0.9rem] ${
				!loaded || error ? 'opacity-0' : 'opacity-100'
			}`}
		/>
	)
}

// A file's own thumbnail, asked of the backend when the listing didn't carry
// it (see useOnDemandThumbnail). The URL is authorized through the provider
// above — Files, ⌘K — or one of its own where there is none.
const Thumbnail = (props: {
	item: FileSystemItem
	fallback: React.ReactNode
	className?: string
	overlay?: React.ReactNode
}) => (
	<EnsureHttpUrlAuthorizer>
		<AuthorizedThumbnail {...props} />
	</EnsureHttpUrlAuthorizer>
)

const AuthorizedThumbnail = ({
	item,
	fallback,
	className,
	overlay,
}: {
	item: FileSystemItem
	fallback: React.ReactNode
	className?: string
	overlay?: React.ReactNode
}) => {
	const authorizedThumbnailUrl = useSharedAuthorizedHttpUrl(useOnDemandThumbnail(item))

	// Track if the image failed to load so we can gracefully fall back to the
	// default thumbnail component
	const [hadError, setHadError] = useState(false)

	// Reset the error flag whenever the thumbnail url or file changes
	useEffect(() => {
		setHadError(false)
	}, [authorizedThumbnailUrl, item.path])

	const imageNode =
		authorizedThumbnailUrl && !hadError ? (
			<img
				src={authorizedThumbnailUrl}
				alt={item.name}
				decoding='async'
				onError={() => setHadError(true)}
				className={`rounded-xs object-contain ${className || ''}`}
			/>
		) : null

	const content = imageNode ?? fallback

	// Only display overlay when we have a real thumbnail to show
	if (overlay && imageNode) {
		return (
			<div className='relative'>
				{imageNode}
				{overlay}
			</div>
		)
	}

	return content
}

// Image thumbnail
const ImageThumbnail = (props: {item: FileSystemItem; fallback: React.ReactNode; className?: string}) => (
	<Thumbnail {...props} />
)

// Video thumbnail
const VideoThumbnail = ({
	item,
	fallback,
	className,
}: {
	item: FileSystemItem
	fallback: React.ReactNode
	className?: string
}) => (
	<Thumbnail
		item={item}
		fallback={fallback}
		className={className}
		overlay={
			<div className='absolute top-1/2 left-1/2 flex h-full w-full -translate-x-1/2 -translate-y-1/2 items-center justify-center'>
				<IoPlay className='h-1/3 w-1/3 text-white shadow-md' />
			</div>
		}
	/>
)

// Brand logo for /Cloud/<accountId> paths, the generic cloud otherwise
const CloudAccountIcon = ({path, className}: {path: string; className?: string}) => {
	const accountId = path.startsWith(`${CLOUD_PATH}/`) ? path.split('/')[2] : undefined
	const {data: accounts} = useCloudAccounts({enabled: Boolean(accountId)})
	const account = accounts?.find(({id}) => id === accountId)
	const logo = account ? CLOUD_PROVIDER_LOGOS[cloudAccountBrand(account)] : undefined
	if (logo) return <img src={logo} alt='' className={`object-contain ${className ?? ''}`} draggable={false} />
	return <CloudIcon className={className} />
}

// Component to render network device icon with Umbrel detection
const NetworkDeviceIcon = ({path, className}: {path: string; className?: string}) => {
	const {doesHostHaveMountedShares} = useNetworkStorage()
	const {deviceType, isLoading} = useNetworkDeviceType(path)

	// The path may point at a share (/Network/<host>/<share>) while the mounted
	// check expects the host root (/Network/<host>)
	const hostRoot = `/${path.split('/').filter(Boolean).slice(0, 2).join('/')}`
	const isMounted = doesHostHaveMountedShares(hostRoot)

	// While detecting, show generic NAS icon
	if (isLoading) {
		return (
			<img src={isMounted ? activeNasIcon : nasIconInactive} alt='Network' className={className} draggable={false} />
		)
	}

	// Show appropriate icon based on device type and mount status
	if (deviceType === 'umbrel') {
		return (
			<img
				src={isMounted ? umbrelDeviceActive : umbrelDeviceInactive}
				alt='Umbrel'
				className={className}
				draggable={false}
			/>
		)
	}

	// Default to generic NAS icon
	return <img src={isMounted ? activeNasIcon : nasIconInactive} alt='NAS' className={className} draggable={false} />
}

// Helper function to extract app ID from both normal and rewind paths
function extractAppIdFromPath(path: string): string {
	// For /Apps/bitcoin or /Backups/xxx/Apps/bitcoin, extract "bitcoin"
	const pattern = new RegExp(`${APPS_PATH}/([^/]+)`)
	const match = path.match(pattern)
	return match?.[1] || ''
}
