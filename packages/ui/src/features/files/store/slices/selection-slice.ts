import {StateCreator} from 'zustand'

import {ClipboardSlice} from '@/features/files/store/slices/clipboard-slice'
import {DragAndDropSlice} from '@/features/files/store/slices/drag-and-drop-slice'
import {FileViewerSlice} from '@/features/files/store/slices/file-viewer-slice'
import {NewFolderSlice} from '@/features/files/store/slices/new-folder-slice'
import type {FileSystemItem} from '@/features/files/types'

export interface SelectionSlice {
	selectedItems: FileSystemItem[]
	isSelectingOnMobile: boolean

	setSelectedItems: (items: FileSystemItem[]) => void
	setIsSelectingOnMobile: (isSelecting: boolean) => void
	clearSelectedItems: () => void
	isItemSelected: (item: FileSystemItem) => boolean
}

export const createSelectionSlice: StateCreator<
	SelectionSlice & ClipboardSlice & NewFolderSlice & DragAndDropSlice & FileViewerSlice,
	[],
	[],
	SelectionSlice
> = (set, get) => ({
	selectedItems: [],
	isSelectingOnMobile: false,
	setSelectedItems: (items) => {
		set({selectedItems: items})
	},

	setIsSelectingOnMobile: (isSelecting: boolean) => {
		set({isSelectingOnMobile: isSelecting})
		if (!isSelecting) {
			get().clearSelectedItems()
		}
	},

	clearSelectedItems: () => {
		set({selectedItems: []})
	},

	isItemSelected: (item: FileSystemItem) => {
		return get().selectedItems.some((i) => i.path === item.path)
	},
})
