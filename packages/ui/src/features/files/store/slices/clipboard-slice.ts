import {StateCreator} from 'zustand'

import {DragAndDropSlice} from '@/features/files/store/slices/drag-and-drop-slice'
import {FileViewerSlice} from '@/features/files/store/slices/file-viewer-slice'
import {NewFolderSlice} from '@/features/files/store/slices/new-folder-slice'
import {SelectionSlice} from '@/features/files/store/slices/selection-slice'
import type {FileSystemItem} from '@/features/files/types'
import {canPerformFileOperation} from '@/features/files/utils/file-capabilities'
import {withoutSearchResult} from '@/features/files/utils/without-search-result'

type ClipboardMode = 'copy' | 'cut' | null

export interface ClipboardSlice {
	clipboardItems: FileSystemItem[]
	clipboardMode: ClipboardMode

	copyItemsToClipboard: () => void
	cutItemsToClipboard: () => void

	hasItemsInClipboard: () => boolean
	clearClipboard: () => void
	isItemInClipboard: (item: FileSystemItem) => boolean
}

export const createClipboardSlice: StateCreator<
	ClipboardSlice & SelectionSlice & NewFolderSlice & DragAndDropSlice & FileViewerSlice,
	[],
	[],
	ClipboardSlice
> = (set, get) => ({
	clipboardItems: [],
	clipboardMode: null,

	copyItemsToClipboard: () => {
		const items = Array.from(get().selectedItems)
		if (!items.length) {
			return get().clearClipboard()
		}
		const copyableItems = items.filter((item) => canPerformFileOperation(item, 'copy'))
		set({clipboardItems: copyableItems.map(withoutSearchResult), clipboardMode: 'copy'})
	},

	cutItemsToClipboard: () => {
		const items = Array.from(get().selectedItems)
		if (!items.length) {
			return get().clearClipboard()
		}
		const movableItems = items.filter((item) => canPerformFileOperation(item, 'move'))
		set({clipboardItems: movableItems.map(withoutSearchResult), clipboardMode: 'cut'})
	},

	hasItemsInClipboard: () => {
		return get().clipboardItems.length > 0
	},

	clearClipboard: () => {
		set({clipboardItems: [], clipboardMode: null})
	},

	isItemInClipboard: (item: FileSystemItem) => {
		return get().clipboardItems.some((i) => i.path === item.path)
	},
})
