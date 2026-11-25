import {FolderLock, FolderX} from 'lucide-react'
import {ComponentType, useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'

import {Card} from '@/components/ui/card'
import {useSetListingSummary} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {ListingAndFileItemContextMenu} from '@/features/files/components/listing/listing-and-file-item-context-menu'
import {ListingBody} from '@/features/files/components/listing/listing-body'
import {Droppable} from '@/features/files/components/shared/drag-and-drop'
import {FileUploadDropZone} from '@/features/files/components/shared/file-upload-drop-zone'
import {useFilesKeyboardShortcuts} from '@/features/files/hooks/use-files-keyboard-shortcuts'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import {useIsFilesEmbedded, useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {getFilesErrorMessage} from '@/features/files/utils/error-messages'
import {cn} from '@/lib/utils'
import {DockSpacer} from '@/modules/desktop/dock'

export interface ListingProps {
	items: FileSystemItem[] // array of items to display
	hiddenRenamedPaths?: string[]
	totalItems?: number // total number of items in the listing
	truncatedAt?: number // if the listing is truncated at this number
	totalSize?: number | null // how much the folder holds, where it is known
	isSearch?: boolean // the items are the results of a search
	selectableItems?: FileSystemItem[] // array of items that are selectable, eg. for keyboard shortcuts we want to ignore uploading items
	isLoading: boolean // if the items are still loading
	error?: unknown // if there is an error loading the items
	hasMore: boolean // if there are more items to load
	onLoadMore: () => Promise<boolean> // callback to load more items (removed startIndex)
	onLoadAll?: () => Promise<boolean> // loads everything there is left to load; resolves true once it has
	CustomEmptyView?: ComponentType // custom empty placeholder component
	enableFileDrop?: boolean // if file upload drop zone is enabled
	topBanner?: React.ReactNode // optional banner rendered above the listing (e.g. cloud status)
}

// What fills the listing: its items, or why there are none to show. In Files
// itself it stands straight on the sheet and runs down to its bottom edge,
// beneath the dock. Embedded in Rewind it keeps the card it has always had.
function ListingContent({
	items,
	selectableItems,
	hiddenRenamedPaths,
	hasMore,
	onLoadMore,
	onLoadAll,
	scrollAreaRef,
	isLoading,
	error,
	isEmpty,
	CustomEmptyView,
}: {
	items: FileSystemItem[]
	selectableItems: FileSystemItem[]
	hiddenRenamedPaths?: string[]
	hasMore: boolean
	onLoadMore: () => Promise<boolean>
	onLoadAll?: () => Promise<boolean>
	scrollAreaRef: React.RefObject<HTMLDivElement | null>
	isLoading: boolean
	error: unknown
	isEmpty: boolean
	CustomEmptyView?: ComponentType
}) {
	const isEmbedded = useIsFilesEmbedded()

	const content = (() => {
		// Whatever stands in for the items sits in what can be seen of the
		// listing, above the dock
		if (isLoading || error || isEmpty)
			return (
				<div className='flex h-full flex-col'>
					<div className='min-h-0 flex-1'>
						{isLoading ? (
							<LoadingView />
						) : error ? (
							<ErrorView error={error} />
						) : CustomEmptyView ? (
							<CustomEmptyView />
						) : (
							<EmptyView />
						)}
					</div>
					{!isEmbedded && <DockSpacer className='low:hidden' />}
				</div>
			)

		return (
			<ListingBody
				scrollAreaRef={scrollAreaRef}
				items={items}
				selectableItems={selectableItems}
				hiddenRenamedPaths={hiddenRenamedPaths}
				hasMore={hasMore}
				isLoading={isLoading}
				onLoadMore={onLoadMore}
				onLoadAll={onLoadAll}
			/>
		)
	})()

	if (isEmbedded) return <Card className='relative min-h-0 flex-1 rounded-24 bg-white/4 !p-0 !pt-4'>{content}</Card>
	// Below the desktop layout the rows run to the sheet's edges, as a phone's lists do
	return <div className='relative min-h-0 flex-1 max-sm:-mx-3'>{content}</div>
}

export function Listing({
	items,
	hiddenRenamedPaths,
	totalItems = 0,
	truncatedAt,
	totalSize,
	isSearch = false,
	selectableItems = [],
	isLoading,
	error,
	hasMore = false,
	onLoadMore = async () => false,
	onLoadAll,
	CustomEmptyView,
	enableFileDrop = true,
	topBanner,
}: ListingProps) {
	const isTouchDevice = useIsTouchDevice()
	// The scroll area only mounts with items to show; the listing is always there
	const listingRef = useRef<HTMLDivElement>(null)
	const scrollAreaRef = useRef<HTMLDivElement>(null)
	const {currentPath} = useNavigate()
	const isReadOnly = useIsFilesReadOnly()
	const {preferences} = usePreferences()

	useFilesKeyboardShortcuts({
		items: selectableItems,
		hiddenRenamedPaths,
		// Whether there is more of the listing to look through than is loaded, and how to get it
		hasMore: hasMore && !!onLoadAll,
		onLoadAll,
		listingRef,
		scrollAreaRef,
		view: preferences?.view ?? 'list',
	})

	const isEmpty = !isLoading && items.length === 0
	const isEmbedded = useIsFilesEmbedded()

	// Something selected the moment it was made (a new folder) was selected as
	// the listing first drew it, ahead of the server, with nothing yet known of
	// what can be done to it. When the server's own entry arrives the selection
	// takes it, so the bar and the keyboard can offer to trash or rename it
	// without it having to be clicked again.
	useEffect(() => {
		const {selectedItems, setSelectedItems} = useFilesStore.getState()
		if (!selectedItems.some((item) => item.capabilitiesPending)) return
		const listed = new Map(items.map((item) => [item.path, item]))
		let caughtUp = false
		const next = selectedItems.map((item) => {
			const entry = listed.get(item.path)
			if (!item.capabilitiesPending || !entry || entry.capabilitiesPending) return item
			caughtUp = true
			return entry
		})
		if (caughtUp) setSelectedItems(next)
	}, [items])

	// The bar counts what the listing holds, once it is known
	const setSummary = useSetListingSummary()
	const hasSummary = !isLoading && !error
	useEffect(() => {
		setSummary(hasSummary ? {count: totalItems, truncatedAt, size: totalSize, isSearch} : undefined)
	}, [setSummary, hasSummary, totalItems, truncatedAt, totalSize, isSearch])
	useEffect(() => () => setSummary(undefined), [setSummary])

	// Selecting everything is the listing's to do: it knows what it holds. In
	// a folder longer than what is loaded, that means loading the rest first.
	// What is loaded is selected at once, so the rows answer the key, and the
	// rest joins it when it arrives. Until then the store says the selection
	// is short of what was asked for, and nothing acts on it (see
	// useItemActions).
	const setSelectAllHandler = useFilesStore((state) => state.setSelectAllHandler)
	const latestRef = useRef({selectableItems, hasMore, onLoadAll})
	latestRef.current = {selectableItems, hasMore, onLoadAll}
	// The part selected while the rest loads, for as long as that is still the selection
	const [selectedAhead, setSelectedAhead] = useState<FileSystemItem[] | null>(null)
	useEffect(() => {
		const selectAll = () => {
			const {selectableItems, hasMore, onLoadAll} = latestRef.current
			const {setSelectedItems, setIsSelectingAll} = useFilesStore.getState()
			setSelectedItems(selectableItems)
			if (!hasMore || !onLoadAll) return
			setIsSelectingAll(true)
			setSelectedAhead(selectableItems)
			// One that can't be loaded leaves what is selected as it is
			void onLoadAll().then((loaded) => !loaded && setSelectedAhead(null))
		}
		setSelectAllHandler(selectAll)
		return () => {
			if (useFilesStore.getState().selectAllHandler === selectAll) setSelectAllHandler(null)
		}
	}, [setSelectAllHandler])
	useEffect(() => {
		if (selectedAhead === null) return
		const {selectedItems, setSelectedItems} = useFilesStore.getState()
		// Something else has been selected since (or Files has moved on, which
		// clears the selection): that stands
		if (selectedItems !== selectedAhead) return setSelectedAhead(null)
		if (!hasMore) {
			setSelectedItems(selectableItems)
			return setSelectedAhead(null)
		}
		// Selecting something else meanwhile calls it off
		return useFilesStore.subscribe((state) => {
			if (state.selectedItems !== selectedAhead) setSelectedAhead(null)
		})
	}, [selectedAhead, hasMore, selectableItems])
	const isSelectingAll = selectedAhead !== null
	useEffect(() => {
		if (!isSelectingAll) return
		return () => useFilesStore.getState().setIsSelectingAll(false)
	}, [isSelectingAll])

	const content = (
		// Wrap in a flex column to ensure the context menu works. The column carries the
		// listing's height, which Files' layout gives it, so a top banner shrinks
		// the listing instead of pushing it past the sheet. The embedded (Rewind) explorer keeps
		// the original height so snapshots render unchanged.
		<div
			ref={listingRef}
			className={cn(
				'flex flex-col',
				isEmbedded ? 'h-[calc(100svh-226px-var(--safe-top))] lg:h-[calc(100vh-312px)]' : 'h-full',
			)}
		>
			{topBanner}
			<ListingContent
				items={items}
				selectableItems={selectableItems}
				hiddenRenamedPaths={hiddenRenamedPaths}
				hasMore={hasMore}
				onLoadMore={onLoadMore}
				onLoadAll={onLoadAll}
				scrollAreaRef={scrollAreaRef}
				isLoading={isLoading}
				error={error}
				isEmpty={isEmpty}
				CustomEmptyView={CustomEmptyView}
			/>
		</div>
	)

	// A touch screen has no pointer to right-click or drop files with: a held
	// item brings up its own sheet of actions (see FileItem), and the bar's +
	// adds to the folder. (Selecting with a drag is the list's own: a box for a
	// mouse, a finger drawn across the items for touch. See VirtualizedList.)
	if (isTouchDevice) return content

	// if read-only, return the content without the context menu
	const contentWithContextMenu = !isReadOnly ? (
		<ListingAndFileItemContextMenu>{content}</ListingAndFileItemContextMenu>
	) : (
		content
	)

	// For desktop, enable file upload drop zone and droppable
	return (
		<div className='relative size-full'>
			{/* if read-only, return the content without the file upload drop zone */}
			{enableFileDrop && !isReadOnly ? (
				<FileUploadDropZone>
					<Droppable
						id={`files-listing-${currentPath}`}
						path={currentPath}
						className='relative flex h-full flex-col outline-hidden'
						dropOverClassName='bg-transparent'
					>
						{contentWithContextMenu}
					</Droppable>
				</FileUploadDropZone>
			) : (
				contentWithContextMenu
			)}
		</div>
	)
}

function ErrorView({error}: {error: unknown}) {
	const {t} = useTranslation()
	const message = error instanceof Error ? error.message : t('files-listing.error')

	const isNotFound =
		message.startsWith('ENOENT') ||
		message.startsWith('Cannot map') ||
		message.includes('[does-not-exist]') ||
		message.includes('[source-not-exists]') ||
		message.includes('[invalid-path]') ||
		message.startsWith('EIO')

	// A member following an owner's link: same calm state as a missing folder, not raw backend text
	const isForbidden = message.includes('[forbidden]')
	const Icon = isForbidden ? FolderLock : FolderX

	return (
		<StateView
			icon={<Icon className='size-9 text-white/30' strokeWidth={1.5} />}
			title={
				isForbidden
					? t('files-backend-error.forbidden')
					: isNotFound
						? t('files-listing.no-such-file')
						: getFilesErrorMessage(message)
			}
		/>
	)
}

// Most folders answer before a spinner could be read, so it holds back a
// moment: only a listing that really is slow shows one
function LoadingView() {
	const {t} = useTranslation()
	return (
		<div className='flex h-full items-center justify-center p-4 motion-safe:animate-in motion-safe:duration-300 motion-safe:fill-mode-backwards motion-safe:[animation-delay:300ms] motion-safe:fade-in'>
			<TbLoader className='size-6 animate-spin text-white/50' aria-label={t('files-listing.loading')} />
		</div>
	)
}

function EmptyView() {
	const {t} = useTranslation()
	return <StateView title={t('files-listing.empty')} />
}

// What a listing says when it has nothing to list: a picture where there is
// one, a line saying why, and under it whatever would change that
export function StateView({
	icon,
	title,
	description,
	children,
}: {
	icon?: React.ReactNode
	title: string
	description?: string
	children?: React.ReactNode
}) {
	return (
		<div className='flex h-full flex-col items-center justify-center gap-4 p-6 text-center'>
			{icon}
			<div className='flex max-w-xs flex-col gap-1'>
				<p className='text-15 leading-tight font-medium -tracking-2 text-white/75'>{title}</p>
				{description && <p className='text-13 leading-snug -tracking-2 text-white/45'>{description}</p>}
			</div>
			{children}
		</div>
	)
}
