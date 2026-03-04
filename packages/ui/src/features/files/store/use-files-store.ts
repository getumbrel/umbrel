import {create} from 'zustand'

import {ClipboardSlice, createClipboardSlice} from '@/features/files/store/slices/clipboard-slice'
import {createDragAndDropSlice, DragAndDropSlice} from '@/features/files/store/slices/drag-and-drop-slice'
import {createFileViewerSlice, FileViewerSlice} from '@/features/files/store/slices/file-viewer-slice'
import {createInteractionSlice, InteractionSlice} from '@/features/files/store/slices/interaction-slice'
import {createNewFolderSlice, NewFolderSlice} from '@/features/files/store/slices/new-folder-slice'
import {createRenameSlice, RenameSlice} from '@/features/files/store/slices/rename-slice'
import {createSelectionSlice, SelectionSlice} from '@/features/files/store/slices/selection-slice'

export type FilesStore = SelectionSlice &
	ClipboardSlice &
	NewFolderSlice &
	DragAndDropSlice &
	FileViewerSlice &
	RenameSlice &
	InteractionSlice

export const useFilesStore = create<FilesStore>()((...a) => ({
	...createSelectionSlice(...a),
	...createClipboardSlice(...a),
	...createNewFolderSlice(...a),
	...createDragAndDropSlice(...a),
	...createFileViewerSlice(...a),
	...createRenameSlice(...a),
	...createInteractionSlice(...a),
}))
