import {StateCreator} from 'zustand'

import {ClipboardSlice} from '@/features/files/store/slices/clipboard-slice'
import {DragAndDropSlice} from '@/features/files/store/slices/drag-and-drop-slice'
import {FileViewerSlice} from '@/features/files/store/slices/file-viewer-slice'
import {NewFolderSlice} from '@/features/files/store/slices/new-folder-slice'
import type {FileSystemItem} from '@/features/files/types'

// What a touch screen's sheet of actions is about: the one item that was
// held, or everything selected (opened from the bar while selecting)
export type ActionSheet = 'item' | 'selection' | null

export interface SelectionSlice {
	selectedItems: FileSystemItem[]
	// Selection mode, where there is no pointer to select with: entered from
	// the Select button and held until Done. Tapping an item selects it
	// instead of opening it.
	isSelectingOnMobile: boolean
	actionSheet: ActionSheet
	// Selects everything in the listing on screen, which is the one that knows what that is
	selectAllHandler: (() => void) | null
	// Select all has been asked for in a folder that isn't all loaded yet: the
	// selection holds what is loaded and the rest is on its way. Nothing acts
	// on the selection meanwhile, as it is short of what was asked for.
	isSelectingAll: boolean

	setSelectedItems: (items: FileSystemItem[]) => void
	setIsSelectingOnMobile: (isSelecting: boolean) => void
	// Brings up the actions for one held item (which becomes the selection for as long as the sheet is up) …
	openItemActionSheet: (item: FileSystemItem) => void
	// … or for everything selected
	openSelectionActionSheet: () => void
	closeActionSheet: () => void
	setSelectAllHandler: (handler: (() => void) | null) => void
	setIsSelectingAll: (isSelectingAll: boolean) => void
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
	actionSheet: null,
	setSelectedItems: (items) => {
		set({selectedItems: items})
	},

	openItemActionSheet: (item) => set({selectedItems: [item], actionSheet: 'item'}),
	openSelectionActionSheet: () => set({actionSheet: 'selection'}),
	closeActionSheet: () => set({actionSheet: null}),
	selectAllHandler: null,
	setSelectAllHandler: (handler) => set({selectAllHandler: handler}),
	isSelectingAll: false,
	setIsSelectingAll: (isSelectingAll) => set({isSelectingAll}),

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
