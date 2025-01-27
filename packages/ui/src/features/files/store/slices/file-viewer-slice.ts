import {StateCreator} from 'zustand'

import {ClipboardSlice} from '@/features/files/store/slices/clipboard-slice'
import {DragAndDropSlice} from '@/features/files/store/slices/drag-and-drop-slice'
import {NewFolderSlice} from '@/features/files/store/slices/new-folder-slice'
import {SelectionSlice} from '@/features/files/store/slices/selection-slice'
import {FileSystemItem} from '@/features/files/types'

export interface FileViewerSlice {
	viewerItem: FileSystemItem | null
	setViewerItem: (item: FileSystemItem | null) => void
}

export const createFileViewerSlice: StateCreator<
	FileViewerSlice & SelectionSlice & ClipboardSlice & NewFolderSlice & DragAndDropSlice,
	[],
	[],
	FileViewerSlice
> = (set) => ({
	viewerItem: null,
	setViewerItem: (item) => set({viewerItem: item}),
})
