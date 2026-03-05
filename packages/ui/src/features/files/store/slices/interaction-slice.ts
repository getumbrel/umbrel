import {StateCreator} from 'zustand'

import {ClipboardSlice} from '@/features/files/store/slices/clipboard-slice'
import {DragAndDropSlice} from '@/features/files/store/slices/drag-and-drop-slice'
import {FileViewerSlice} from '@/features/files/store/slices/file-viewer-slice'
import {NewFolderSlice} from '@/features/files/store/slices/new-folder-slice'
import {SelectionSlice} from '@/features/files/store/slices/selection-slice'

// Slice for user interaction state spanning multiple slices (selection, viewer, DnD, etc.)
export interface InteractionSlice {
	resetInteractionState: () => void
}

export const createInteractionSlice: StateCreator<
	InteractionSlice & SelectionSlice & ClipboardSlice & NewFolderSlice & DragAndDropSlice & FileViewerSlice,
	[],
	[],
	InteractionSlice
> = (_set, get) => ({
	resetInteractionState: () => {
		get().setSelectedItems([])
		get().setViewerItem(null)
		get().setIsSelectingOnMobile(false)
		get().clearDraggedItems()
	},
})
