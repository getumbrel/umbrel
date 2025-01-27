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
	toggleIsSelectingOnMobile: () => void
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

	toggleIsSelectingOnMobile: () => {
		const newIsSelecting = !get().isSelectingOnMobile
		set({
			isSelectingOnMobile: newIsSelecting,
		})
		if (!newIsSelecting) {
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
