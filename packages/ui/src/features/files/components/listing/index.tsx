import {FolderX} from 'lucide-react'
import {ComponentType, useRef} from 'react'
import {TbLoader} from 'react-icons/tb'

import {Card} from '@/components/ui/card'
import {ActionsBar} from '@/features/files/components/listing/actions-bar'
import {FileItem} from '@/features/files/components/listing/file-item'
import {ListingBody} from '@/features/files/components/listing/listing-body'
import {ListingContextMenu} from '@/features/files/components/listing/listing-context-menu'
import {ListingFooter} from '@/features/files/components/listing/listing-footer'
import {MarqueeSelection} from '@/features/files/components/listing/marquee-selection'
import {Droppable} from '@/features/files/components/shared/drag-and-drop'
import {FileUploadDropZone} from '@/features/files/components/shared/file-upload-drop-zone'
import {useFilesKeyboardShortcuts} from '@/features/files/hooks/use-files-keyboard-shortcuts'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import type {FileSystemItem} from '@/features/files/types'
import {t} from '@/utils/i18n'

export interface ListingProps {
	items: FileSystemItem[] // array of items to display
	selectableItems?: FileSystemItem[] // array of items that are selectable, eg. for keyboard shortcuts we want to ignore uploading items
	isLoading: boolean // if the items are still loading
	error?: unknown // if there is an error loading the items
	totalItems: number // total number of items (not just the ones on the current page)
	CustomEmptyView?: ComponentType // custom empty placeholder component
	additionalContextMenuItems?: React.ReactNode // additional items for the context menu
	enableFileDrop?: boolean // if file upload drop zone is enabled
	additionalDesktopActions?: React.ReactNode // additional actions in the ActionsBar for the desktop view
	additionalMobileActions?: React.ReactNode // additional dropdown items in the ActionsBar for the mobile view
}

function ListingContent({
	items,
	totalItems,
	scrollAreaRef,
	isLoading,
	error,
	isEmpty,
	CustomEmptyView,
}: {
	items: FileSystemItem[]
	totalItems: number
	scrollAreaRef: React.RefObject<HTMLDivElement>
	isLoading: boolean
	error: unknown
	isEmpty: boolean
	CustomEmptyView?: ComponentType
}) {
	return (
		<Card className='h-[calc(100svh-214px)] !p-0 !pt-4 lg:h-[calc(100vh-300px)]'>
			{(() => {
				if (isLoading) return <LoadingView />
				if (error) return <ErrorView error={error} />
				if (isEmpty) return CustomEmptyView ? <CustomEmptyView /> : <EmptyView />

				return (
					<>
						<ListingBody scrollAreaRef={scrollAreaRef}>
							{items.map((item) => (
								<FileItem key={getItemKey(item)} item={item} items={items} />
							))}
						</ListingBody>
						<ListingFooter totalItems={totalItems} />
					</>
				)
			})()}
		</Card>
	)
}

export function Listing({
	items,
	selectableItems = [],
	isLoading,
	error,
	totalItems,
	CustomEmptyView,
	additionalContextMenuItems,
	additionalDesktopActions,
	additionalMobileActions,
	enableFileDrop = true,
}: ListingProps) {
	const isTouchDevice = useIsTouchDevice()
	const scrollAreaRef = useRef<HTMLDivElement>(null)
	const {currentPath} = useNavigate()

	useFilesKeyboardShortcuts({items: selectableItems})

	const isEmpty = !isLoading && items.length === 0

	const content = (
		<div className='flex flex-col gap-3 lg:gap-6'>
			<ActionsBar
				hidePath={Boolean(isLoading || error)}
				DesktopActions={additionalDesktopActions}
				ExtraMobileDropdownItems={additionalMobileActions}
			/>
			<ListingContent
				items={items}
				totalItems={totalItems}
				scrollAreaRef={scrollAreaRef}
				isLoading={isLoading}
				error={error}
				isEmpty={isEmpty}
				CustomEmptyView={CustomEmptyView}
			/>
		</div>
	)

	// For touch devices, disable marquee selection + file upload drop zone and droppable
	if (isTouchDevice) {
		return <div className='relative flex h-full flex-col outline-none'>{content}</div>
	}

	// For desktop, wrap in marquee selection, optionally enable file upload drop zone and droppable
	const wrappedContent = <ListingContextMenu menuItems={additionalContextMenuItems}>{content}</ListingContextMenu>

	return (
		<MarqueeSelection scrollAreaRef={scrollAreaRef} items={selectableItems}>
			{enableFileDrop ? (
				<FileUploadDropZone>
					<Droppable
						id={`files-listing-${currentPath}`}
						path={currentPath}
						className='relative flex h-full flex-col outline-none'
						dropOverClassName='bg-transparent'
					>
						{wrappedContent}
					</Droppable>
				</FileUploadDropZone>
			) : (
				wrappedContent
			)}
		</MarqueeSelection>
	)
}

function ErrorView({error}: {error: unknown}) {
	const message = error instanceof Error ? error.message : t('files-listing.error')

	return (
		<div className='flex h-full items-center justify-center p-4 text-center'>
			{/* TODO: use error codes once the backend supports them */}
			{message.startsWith('ENOENT') || message.startsWith('Cannot map') ? (
				<div className='flex flex-col items-center gap-2'>
					<FolderX className='h-6 w-6 opacity-50' />
					<span className='text-12 text-white/40'>{t('files-listing.no-such-file')}</span>
				</div>
			) : (
				<span className='text-12 text-white/40'>{message}</span>
			)}
		</div>
	)
}

function LoadingView() {
	return (
		<div className='flex h-full items-center justify-center p-4'>
			<TbLoader className='white h-6 w-6 animate-spin opacity-50 shadow-sm' aria-label={t('files-listing.loading')} />
		</div>
	)
}

function EmptyView() {
	return (
		<div className='flex h-full items-center justify-center p-4 text-center'>
			<div className='text-12 text-white/40'>{t('files-listing.empty')}</div>
		</div>
	)
}

function getItemKey(item: FileSystemItem): string {
	const isUploading = 'isUploading' in item && item.isUploading
	return `${item.path}${isUploading ? '-uploading' : ''}`
}
