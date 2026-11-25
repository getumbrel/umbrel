import {ClipboardPaste, CloudDownload, FilePlus2, FolderPlus, Upload} from 'lucide-react'
import {useEffect, useLayoutEffect, useMemo, useRef} from 'react'
import {useTranslation} from 'react-i18next'
import {TbWorldPlus} from 'react-icons/tb'
import {useNavigate as useRouterNavigate} from 'react-router-dom'

import {toast} from '@/components/ui/toast'
import {CloudBanner} from '@/features/files/components/cloud-banner'
import {Listing} from '@/features/files/components/listing'
import {
	useSetActionsBarConfig,
	type BarAction,
} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {EmptyStateDirectory, EmptyStateNetwork} from '@/features/files/components/listing/directory-listing/empty-state'
import {UploadInput} from '@/features/files/components/shared/upload-input'
import {cloudSyncForPath, useCloudSyncs} from '@/features/files/hooks/use-cloud'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useHomePath} from '@/features/files/hooks/use-home-path'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useNewFolder} from '@/features/files/hooks/use-new-folder'
import {useIsFilesEmbedded, useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FilesStore} from '@/features/files/store/use-files-store'
import {isValidCloudDestination} from '@/features/files/utils/cloud'
import {getFilesErrorMessage} from '@/features/files/utils/error-messages'
import {dashboardAuthHeaders} from '@/modules/auth/http-auth'
import {trpcReact} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'

export function DirectoryListing() {
	const {t} = useTranslation()
	const {
		currentPath,
		uiPath,
		isBrowsingApps,
		isBrowsingMachines,
		isBrowsingExternalStorage,
		isViewingExternalDrives,
		isViewingNetworkDevices,
		isViewingNetworkShares,
		isBrowsingNetworkStorage,
		navigateToDirectory,
	} = useNavigate()
	const isEmbedded = useIsFilesEmbedded()
	const isReadOnly = useIsFilesReadOnly()
	const setActionsBarConfig = useSetActionsBarConfig()
	const {listing, isLoading, error, fetchMoreItems, fetchAllItems} = useListDirectory(currentPath)
	const routerNavigate = useRouterNavigate()
	const linkToDialog = useLinkToDialog()
	const homePath = useHomePath()

	// The backend's writable operation on the current directory gates every
	// write affordance here (new folder, new file, upload, paste, file drop),
	// e.g. cloud mirrors and backup snapshots; mutations stay guarded
	// server-side either way
	const isWritable = listing?.operations.includes('writable') ?? false

	// Grab the potential "new folder" item from store
	const newFolder = useFilesStore((state: FilesStore) => state.newFolder)

	// Merge new folder (if any) at the top of the list
	const items = newFolder ? [newFolder, ...(listing?.items || [])] : listing?.items || []

	// For "Paste" command
	const {pasteItemsFromClipboard} = useFilesOperations()
	// A value, not the store's getter, so the menus re-render when something is copied
	const hasItemsInClipboard = useFilesStore((state: FilesStore) => state.clipboardItems.length > 0)

	// For "New Folder"
	const {startNewFolder} = useNewFolder()

	// For "Upload"
	const uploadInputRef = useRef<HTMLInputElement | null>(null)
	const handleUploadClick = () => {
		if (isReadOnly || !isWritable) return
		uploadInputRef.current?.click()
	}

	// For "New Text File"
	const utils = trpcReact.useUtils()
	const setViewerItem = useFilesStore((s) => s.setViewerItem)
	const startNewTextFile = async () => {
		if (isReadOnly || !isWritable) return
		const baseName = t('files-action.new-text-file-name')
		const ext = '.txt'
		let name = baseName + ext
		// Find a unique name
		const existingNames = new Set((listing?.items ?? []).map((item) => item.name))
		if (existingNames.has(name)) {
			let index = 2
			while (existingNames.has(`${baseName} (${index})${ext}`)) index++
			name = `${baseName} (${index})${ext}`
		}
		const filePath = currentPath + '/' + name
		try {
			// Create empty file via upload endpoint
			const response = await fetch(`/api/files/upload?path=${encodeURIComponent(filePath)}&collision=keep-both`, {
				method: 'POST',
				body: '',
				headers: {...dashboardAuthHeaders(), 'Content-Type': 'text/plain; charset=utf-8'},
			})
			if (!response.ok) {
				const {error: message} = await response.json().catch(() => ({error: response.statusText}))
				toast.error(t('files-error.create-file', {message: getFilesErrorMessage(message || response.statusText)}), {
					area: 'files',
				})
				return
			}
			// `keep-both` means the server may have picked a different name than we guessed
			// (our uniqueness check only sees the loaded page of the listing), so the
			// response path is the only authoritative one
			const {path: createdPath} = (await response.json()) as {path: string}
			await utils.files.list.invalidate({path: currentPath})
			// The editor derives read-only from `operations`, so they have to be real
			// before its first render — it seeds `isEditing` from them once and never remounts.
			// Fall back to the parent's operations (known writable, we checked above) so a
			// hiccup here opens an editable file rather than silently opening nothing.
			const operations = await utils.files.pathOperations
				.fetch({path: createdPath})
				.catch(() => listing?.operations ?? [])
			// Open the new file in the editor
			setViewerItem({
				name: createdPath.split('/').pop() ?? name,
				path: createdPath,
				type: 'text/plain',
				size: 0,
				modified: Date.now(),
				operations,
			})
		} catch {
			// Silently fail — the file listing will show the new file if it was created
		}
	}

	// Cloud context: the current directory may be a download destination
	// (its listing shows a status banner) or an empty candidate for one
	const {data: clouds} = useCloudSyncs()
	const currentDirCloud = cloudSyncForPath(clouds, currentPath)
	const canDownloadFromCloudHere =
		!isEmbedded &&
		!isLoading &&
		!error &&
		(listing?.items ?? []).length === 0 &&
		!currentDirCloud &&
		isValidCloudDestination(currentPath, homePath)

	// Filter out items that are currently uploading to prevent them from being selected via marquee selection or keyboard shortcuts.
	// The same array until the items change: what holds on to it (the keyboard, the marquee) starts over when it does.
	const listedItems = listing?.items
	const selectableItems = useMemo(() => (listedItems ?? []).filter((item) => !item.isUploading), [listedItems])

	// Disable actions while loading or on error; only hide the path bar on error
	const disableActions = Boolean(isLoading || error)
	const hidePath = Boolean(error)

	// In embedded contexts (e.g., Rewind), if the current directory doesn't exist in a snapshot,
	// we automatically fall back to the nearest existing parent.
	// We use useLayoutEffect to navigate before paint to avoid a visible flicker of the error screen ("No such file or folder").
	useLayoutEffect(() => {
		if (!isEmbedded || !error) return
		// climb the logical UI path to the nearest existing parent
		const logicalBase = uiPath.startsWith('/Apps') ? '/Apps' : '/Home'
		const lastSlash = uiPath.lastIndexOf('/')
		const parentUi = lastSlash > 0 ? uiPath.slice(0, lastSlash) : logicalBase
		if (parentUi && parentUi !== uiPath) navigateToDirectory(parentUi)
	}, [isEmbedded, error, uiPath, navigateToDirectory])

	// What can be done to this folder. The bar draws its pills from these, a
	// phone its + menu, and the menu on empty space its first items.
	// - At /Network (devices view): add a device
	// - Where drives and shares are listed: nothing
	// - Elsewhere: upload, new folder, new text file, paste
	// Write actions are disabled for read-only directories.
	const openAddNetworkShare = () => routerNavigate(linkToDialog('files-add-network-share'))
	const openCloudAdd = () => routerNavigate(linkToDialog('files-cloud-add', {destination: currentPath}))
	const paste = () => void pasteItemsFromClipboard({toDirectory: currentPath})
	const actions: BarAction[] = isReadOnly
		? []
		: isViewingNetworkDevices
			? [
					{
						id: 'add-network-device',
						label: t('files-action.add-network-device'),
						icon: TbWorldPlus,
						onSelect: openAddNetworkShare,
						disabled: disableActions,
						pill: true,
					},
				]
			: isViewingExternalDrives || isViewingNetworkShares
				? []
				: [
						{
							id: 'upload',
							label: t('files-action.upload'),
							icon: Upload,
							onSelect: handleUploadClick,
							disabled: disableActions || !isWritable,
							pill: true,
						},
						{
							id: 'new-folder',
							label: t('files-action.new-folder'),
							icon: FolderPlus,
							onSelect: startNewFolder,
							disabled: disableActions || !isWritable,
							pill: t('files-folder'),
						},
						{
							id: 'new-text-file',
							label: t('files-action.new-text-file'),
							icon: FilePlus2,
							onSelect: () => void startNewTextFile(),
							disabled: disableActions || !isWritable,
						},
						{
							id: 'paste',
							label: t('files-action.paste'),
							icon: ClipboardPaste,
							onSelect: paste,
							disabled: disableActions || !hasItemsInClipboard || !isWritable,
							shortcut: '⌘V',
						},
						...(canDownloadFromCloudHere
							? [{id: 'cloud', label: t('files-cloud.download-here'), icon: CloudDownload, onSelect: openCloudAdd}]
							: []),
					]

	// The actions are built from this render's state (the folder to paste
	// into, whether there's anything to paste), so anything they read is a
	// dependency, or they keep acting on the folder they were built for
	useEffect(() => {
		setActionsBarConfig({
			actions,
			hidePath,
			hideSearch: isBrowsingApps || isBrowsingMachines || isBrowsingExternalStorage || isBrowsingNetworkStorage,
			// The drives of /External are places to go into, not things to act on
			selectable: !isViewingExternalDrives,
		})
	}, [
		currentPath,
		hasItemsInClipboard,
		disableActions,
		isReadOnly,
		isWritable,
		hidePath,
		canDownloadFromCloudHere,
		isBrowsingApps,
		isBrowsingMachines,
		isBrowsingExternalStorage,
		isViewingExternalDrives,
		isViewingNetworkDevices,
		isViewingNetworkShares,
		isBrowsingNetworkStorage,
	])

	return (
		<>
			<UploadInput ref={uploadInputRef} disabled={isReadOnly || !isWritable} />
			<Listing
				items={items}
				hiddenRenamedPaths={listing?.hiddenRenamedPaths}
				totalItems={listing?.totalFiles}
				truncatedAt={listing?.truncatedAt}
				totalSize={listing?.size}
				selectableItems={selectableItems}
				isLoading={isLoading}
				error={error}
				hasMore={listing?.hasMore ?? false}
				onLoadMore={fetchMoreItems}
				onLoadAll={fetchAllItems}
				enableFileDrop={!isViewingExternalDrives && !isViewingNetworkDevices && !isViewingNetworkShares}
				CustomEmptyView={isViewingNetworkDevices ? EmptyStateNetwork : EmptyStateDirectory}
				topBanner={!isEmbedded ? <CloudBanner path={currentPath} /> : undefined}
			/>
		</>
	)
}
