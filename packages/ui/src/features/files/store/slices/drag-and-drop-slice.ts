import {StateCreator} from 'zustand'

import {ClipboardSlice} from '@/features/files/store/slices/clipboard-slice'
import {FileViewerSlice} from '@/features/files/store/slices/file-viewer-slice'
import {NewFolderSlice} from '@/features/files/store/slices/new-folder-slice'
import {SelectionSlice} from '@/features/files/store/slices/selection-slice'
import {FileSystemItem} from '@/features/files/types'

export interface DragAndDropSlice {
	draggedItems: FileSystemItem[]
	setDraggedItems: (items: FileSystemItem[]) => void
	clearDraggedItems: () => void
}

export const createDragAndDropSlice: StateCreator<
	DragAndDropSlice & SelectionSlice & ClipboardSlice & NewFolderSlice & FileViewerSlice,
	[],
	[],
	DragAndDropSlice
> = (set) => ({
	draggedItems: [],
	setDraggedItems: (items) => set({draggedItems: items}),
	clearDraggedItems: () => set({draggedItems: []}),
})
