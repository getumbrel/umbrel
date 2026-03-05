import {StateCreator} from 'zustand'

import {ClipboardSlice} from '@/features/files/store/slices/clipboard-slice'
import {DragAndDropSlice} from '@/features/files/store/slices/drag-and-drop-slice'
import {FileViewerSlice} from '@/features/files/store/slices/file-viewer-slice'
import {SelectionSlice} from '@/features/files/store/slices/selection-slice'
import type {FileSystemItem} from '@/features/files/types'

export interface NewFolderSlice {
	newFolder: (FileSystemItem & {isNew: boolean}) | null

	setNewFolder: (newFolder: (FileSystemItem & {isNew: boolean}) | null) => void
}

export const createNewFolderSlice: StateCreator<
	NewFolderSlice & SelectionSlice & ClipboardSlice & DragAndDropSlice & FileViewerSlice,
	[],
	[],
	NewFolderSlice
> = (set) => ({
	newFolder: null,

	setNewFolder: (newFolder) => {
		set({
			newFolder,
		})
	},
})
