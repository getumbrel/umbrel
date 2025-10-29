import React, {useEffect, useState} from 'react'
import {BsTrash2} from 'react-icons/bs'
import {IoPlay} from 'react-icons/io5'

import backupsIcon from '@/features/backups/assets/backups-icon.png'
import {AppsIcon} from '@/features/files/assets/apps-icon'
import externalStorageIcon from '@/features/files/assets/external-storage-icon.png'
import {HomeIcon} from '@/features/files/assets/home-icon'
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
	FILE_TYPE_MAP,
	HOME_PATH,
	IMAGE_EXTENSIONS_WITH_IMAGE_THUMBNAILS,
	RECENTS_PATH,
	TRASH_PATH,
	VIDEO_EXTENSIONS_WITH_IMAGE_THUMBNAILS,
} from '@/features/files/constants'
import {useNetworkDeviceType} from '@/features/files/hooks/use-network-device-type'
import {useNetworkStorage} from '@/features/files/hooks/use-network-storage'
import {useShares} from '@/features/files/hooks/use-shares'
import type {FileSystemItem} from '@/features/files/types'
import {splitFileName} from '@/features/files/utils/format-filesystem-name'
import {isDirectoryANetworkDevice} from '@/features/files/utils/is-directory-a-network-device-or-share'
import {isDirectoryAnExternalDrivePartition} from '@/features/files/utils/is-directory-an-external-drive-partition'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

interface FileItemIcon {
	item: FileSystemItem
	onlySVG?: boolean
	className?: string
	useAnimatedIcon?: boolean
	isHovered?: boolean
}

export const FileItemIcon = ({item, onlySVG, className, useAnimatedIcon = false, isHovered = false}: FileItemIcon) => {
	const {isPathShared} = useShares()
	const isShared = isPathShared(item.path)

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

	// External storage icon if the user directly navigates to umbrel.local/files/External
	if (item.type === 'directory' && isDirectoryAnExternalDrivePartition(item.path)) {
		return <img src={externalStorageIcon} alt={t('external-drive')} className={className} draggable={false} />
	}

	// Network share icon when browsing /Network
	if (item.type === 'directory' && isDirectoryANetworkDevice(item.path)) {
		return <NetworkDeviceIcon path={item.path} className={className} />
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
		return <img src={networkIcon} alt='Network' className={className + 'w-auto'} draggable={false} />
	}

	// Network share for sidebar and pathbar
	if (item.type === 'network-share') {
		return <NetworkDeviceIcon path={item.path} className={className} />
	}

	// Folder
	if (item.type === 'directory') {
		if (onlySVG) {
			return <SimpleFolderIcon className={className} />
		}

		return (
			<div className='relative'>
				<FolderIcon className={className} path={item.path} useAnimatedIcon={useAnimatedIcon} isHovered={isHovered} />
				{isAppFolder ? <AppFolderBottomIcon appId={extractAppIdFromPath(item.path)} /> : null}

				{/* we add it here because only folders can be shared */}
				{isShared ? (
					<div className='absolute left-0 top-0 flex size-1/2 max-h-8 min-h-[0.9rem] min-w-[0.9rem] max-w-8 translate-x-[-30%] translate-y-[-20%] items-center justify-center rounded-full border border-white/15 bg-gradient-to-b from-brand to-[color-mix(in_srgb,hsl(var(--color-brand))_80%,black_20%)] shadow-md'>
						<SharedFolderBadge className='size-4/5' />
					</div>
				) : null}
			</div>
		)
	}

	// Unknown file
	if (
		!item.type ||
		!FILE_TYPE_MAP[item.type as keyof typeof FILE_TYPE_MAP] ||
		!FILE_TYPE_MAP[item.type as keyof typeof FILE_TYPE_MAP].thumbnail
	) {
		return <UnknownFileThumbnail type={item.type || ''} className={className} />
	}

	// Get the thumbnail component
	const Thumbnail = FILE_TYPE_MAP[item.type as keyof typeof FILE_TYPE_MAP].thumbnail as unknown as React.ComponentType<{
		className?: string
	}>

	const {extension} = splitFileName(item.name)
	// Image file
	if (extension && IMAGE_EXTENSIONS_WITH_IMAGE_THUMBNAILS.has(extension.toLowerCase())) {
		return <ImageThumbnail item={item} fallback={Thumbnail} className={className} />
	}

	// Video file
	if (extension && VIDEO_EXTENSIONS_WITH_IMAGE_THUMBNAILS.has(extension.toLowerCase())) {
		return <VideoThumbnail item={item} fallback={Thumbnail} className={className} />
	}

	// All other supported file types
	return <Thumbnail className={className} />
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
	if (path === HOME_PATH) {
		return <HomeIcon className={className} />
	}
	if (path === TRASH_PATH) {
		return <BsTrash2 className={className} />
	}
	if (path === RECENTS_PATH) {
		return <RecentsIcon className={className} />
	}
	if (path === APPS_PATH) {
		return <AppsIcon className={className} />
	}

	const FolderComponent = useAnimatedIcon ? AnimatedFolderIcon : SimpleFolderIcon

	if (path === `${HOME_PATH}/Videos`) {
		return useAnimatedIcon ? (
			<FolderComponent className={className} overlayIcon={VideosIcon} isHovered={isHovered} />
		) : (
			<FolderComponent className={className} overlayIcon={VideosIcon} />
		)
	}
	if (path === `${HOME_PATH}/Downloads`) {
		return useAnimatedIcon ? (
			<FolderComponent className={className} overlayIcon={DownloadsIcon} isHovered={isHovered} />
		) : (
			<FolderComponent className={className} overlayIcon={DownloadsIcon} />
		)
	}
	if (path === `${HOME_PATH}/Documents`) {
		return useAnimatedIcon ? (
			<FolderComponent className={className} overlayIcon={DocumentsIcon} isHovered={isHovered} />
		) : (
			<FolderComponent className={className} overlayIcon={DocumentsIcon} />
		)
	}
	if (path === `${HOME_PATH}/Photos`) {
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
			className={`absolute bottom-0 right-0 flex h-1/2 max-h-8 min-h-5 w-1/2 min-w-5 max-w-8 translate-x-[16%] translate-y-[10%] items-center justify-center overflow-hidden rounded-[25%] border border-white/15 object-contain shadow-md md:min-h-[0.9rem] md:min-w-[0.9rem] ${
				!loaded || error ? 'opacity-0' : 'opacity-100'
			}`}
		/>
	)
}

// Thumbnail component with on‑demand fetch
function useOnDemandThumbnail(item: FileSystemItem) {
	const [url, setUrl] = useState<string | undefined>(item.thumbnail)

	const getThumbnailMutation = trpcReact.files.getThumbnail.useMutation()

	// Reset state when the file item changes
	useEffect(() => {
		setUrl(item.thumbnail)
	}, [item.path, item.thumbnail])

	useEffect(() => {
		if (url !== undefined) return

		getThumbnailMutation.mutateAsync({path: item.path}).then((res) => {
			if (res) {
				setUrl(res)
			}
		})
	}, [url, item.path])

	return {thumbnailUrl: url}
}

const Thumbnail = ({
	item,
	fallback: Fallback,
	className,
	overlay,
}: {
	item: FileSystemItem
	fallback: React.ComponentType<{className?: string}>
	className?: string
	overlay?: React.ReactNode
}) => {
	const {thumbnailUrl} = useOnDemandThumbnail(item)

	// Track if the image failed to load so we can gracefully fall back to the
	// default thumbnail component
	const [hadError, setHadError] = useState(false)

	// Reset the error flag whenever the thumbnail url or file changes
	useEffect(() => {
		setHadError(false)
	}, [thumbnailUrl, item.path])

	const imageNode =
		thumbnailUrl && !hadError ? (
			<img
				src={thumbnailUrl}
				alt={item.name}
				onError={() => setHadError(true)}
				className={`rounded-sm object-contain ${className || ''}`}
			/>
		) : null

	const content = imageNode ?? <Fallback className={className} />

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
const ImageThumbnail = (props: {
	item: FileSystemItem
	fallback: React.ComponentType<{className?: string}>
	className?: string
}) => <Thumbnail {...props} />

// Video thumbnail
const VideoThumbnail = ({
	item,
	fallback,
	className,
}: {
	item: FileSystemItem
	fallback: React.ComponentType<{className?: string}>
	className?: string
}) => (
	<Thumbnail
		item={item}
		fallback={fallback}
		className={className}
		overlay={
			<div className='absolute left-1/2 top-1/2 flex h-full w-full -translate-x-1/2 -translate-y-1/2 items-center justify-center'>
				<IoPlay className='h-1/3 w-1/3 text-white shadow-md' />
			</div>
		}
	/>
)

// Component to render network device icon with Umbrel detection
const NetworkDeviceIcon = ({path, className}: {path: string; className?: string}) => {
	const {doesHostHaveMountedShares} = useNetworkStorage()
	const {deviceType, isLoading} = useNetworkDeviceType(path)

	const isMounted = doesHostHaveMountedShares(path)

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
