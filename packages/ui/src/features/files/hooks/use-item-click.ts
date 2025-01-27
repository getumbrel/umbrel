import {SUPPORTED_ARCHIVE_EXTRACT_EXTENSIONS} from '@/features/files/constants'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {FileSystemItem} from '@/features/files/types'

export const useItemClick = () => {
	const {selectedItems, setSelectedItems, isSelectingOnMobile, setViewerItem} = useFilesStore()
	const {extractSelectedItems} = useFilesOperations()
	const {navigateToDirectory} = useNavigate()
	const isTouchDevice = useIsTouchDevice()

	const handleClick = (e: React.MouseEvent, item: FileSystemItem, items: FileSystemItem[]) => {
		if (isTouchDevice) {
			return handleClickOnMobile(item)
		}
		return handleClickOnDesktop(e, item, items)
	}

	const handleClickOnMobile = (item: FileSystemItem) => {
		// if not selecting, mimic a double click
		if (!isSelectingOnMobile) {
			return handleDoubleClick(item)
		}

		// if selecting on mobile, toggle the item's selection
		if (selectedItems.some((selectedItem: FileSystemItem) => selectedItem.path === item.path)) {
			return setSelectedItems(selectedItems.filter((i: FileSystemItem) => i.path !== item.path))
		}
		return setSelectedItems([...selectedItems, item])
	}

	const handleClickOnDesktop = (e: React.MouseEvent, item: FileSystemItem, items: FileSystemItem[]) => {
		e.stopPropagation()

		// Disable selection if item is uploading
		if ('isUploading' in item && item.isUploading) return

		// if no items are selected, select the clicked item
		if (selectedItems.length === 0) {
			return setSelectedItems([item])
		}

		// if no modifiers are pressed, select the clicked item
		if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
			return setSelectedItems([item])
		}

		// if cmd or ctrl key is pressed, toggle the clicked item's selection
		if (e.metaKey || e.ctrlKey) {
			let newSelectedItems = Array.from(selectedItems)
			if (newSelectedItems.some((selectedItem: FileSystemItem) => selectedItem.path === item.path)) {
				newSelectedItems = newSelectedItems.filter((i: FileSystemItem) => i.path !== item.path)
			} else {
				newSelectedItems = [...selectedItems, item]
			}
			return setSelectedItems(newSelectedItems)
		}

		// if shift key is pressed, select a range of items
		if (e.shiftKey) {
			// get indices for range selection
			const lastSelectedItem = selectedItems[selectedItems.length - 1]
			const lastSelectedIndex = items.findIndex((i: FileSystemItem) => i.path === lastSelectedItem.path)
			const clickedIndex = items.findIndex((i: FileSystemItem) => i.path === item.path)

			// determine range bounds
			const start = Math.min(lastSelectedIndex, clickedIndex)
			const end = Math.max(lastSelectedIndex, clickedIndex)

			// get items in range
			const itemsInRange = items.slice(start, end + 1)

			// combine existing selections with the new range, removing duplicates
			const combinedItems = [...selectedItems, ...itemsInRange]
			const uniqueItems = Array.from(new Map(combinedItems.map((item) => [item.path, item])).values())
			return setSelectedItems(uniqueItems)
		}
	}

	const handleDoubleClick = (item: FileSystemItem) => {
		// if touch device and the user is selecting, do nothing
		if (isTouchDevice && isSelectingOnMobile) {
			return
		}

		// disable double click if the item is uploading
		if ('isUploading' in item && item.isUploading) {
			return
		}

		// if the item is a directory, navigate to it
		if (item.type === 'directory') {
			return navigateToDirectory(item.path)
		}

		// if the item is an archive file, extract it
		if (SUPPORTED_ARCHIVE_EXTRACT_EXTENSIONS.some((ext) => item.name.toLowerCase().endsWith(ext))) {
			return extractSelectedItems()
		}

		// else set the item as the viewer item
		// the viewer will either render it, or show a download dialog if it's not supported
		setViewerItem(item)
	}

	return {
		handleClick,
		handleDoubleClick,
	}
}
