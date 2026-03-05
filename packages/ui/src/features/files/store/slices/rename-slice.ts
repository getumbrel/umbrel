import {StateCreator} from 'zustand'

import {ClipboardSlice} from '@/features/files/store/slices/clipboard-slice'
import {DragAndDropSlice} from '@/features/files/store/slices/drag-and-drop-slice'
import {FileViewerSlice} from '@/features/files/store/slices/file-viewer-slice'
import {NewFolderSlice} from '@/features/files/store/slices/new-folder-slice'
import {SelectionSlice} from '@/features/files/store/slices/selection-slice'

export interface RenameSlice {
	// Path of the file/folder that is currently being renamed.
	renamingItemPath: string | null
	setRenamingItemPath: (path: string | null) => void
}

export const createRenameSlice: StateCreator<
	SelectionSlice & ClipboardSlice & NewFolderSlice & DragAndDropSlice & FileViewerSlice & RenameSlice,
	[],
	[],
	RenameSlice
> = (set) => ({
	renamingItemPath: null,
	setRenamingItemPath: (path) => set({renamingItemPath: path}),
})
