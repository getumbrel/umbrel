import {StateCreator} from 'zustand'

import {ClipboardSlice} from '@/features/files/store/slices/clipboard-slice'
import {DragAndDropSlice} from '@/features/files/store/slices/drag-and-drop-slice'
import {NewFolderSlice} from '@/features/files/store/slices/new-folder-slice'
import {SelectionSlice} from '@/features/files/store/slices/selection-slice'
import {FileSystemItem} from '@/features/files/types'

export type ViewerMode = 'preview' | 'open' | null
export type ActiveViewerMode = Exclude<ViewerMode, null>
// Unsaved changes hold the viewer on its file: the guard asks what to do with them, and is handed what was held up to
// carry on with once they're saved or discarded
type ViewerNavigationGuard = (resume: () => void) => void

// ←/→ walk the listing one file at a time, ↑/↓ a row of the icon grid
export type ViewerStep = 'previous' | 'next' | 'up' | 'down'
export const ARROW_STEPS: Partial<Record<string, ViewerStep>> = {
	ArrowLeft: 'previous',
	ArrowRight: 'next',
	ArrowUp: 'up',
	ArrowDown: 'down',
}
// The listing the viewer was opened from knows the order of its files (and
// the grid's columns), so it is the one that moves the viewer along
export type ViewerStepper = {
	step: (step: ViewerStep) => void
	canStep: (step: ViewerStep) => boolean
}

export interface FileViewerSlice {
	viewerItem: FileSystemItem | null
	viewerMode: ViewerMode
	viewerNavigationGuard: ViewerNavigationGuard | null
	viewerStepper: ViewerStepper | null
	setViewerItem: (item: FileSystemItem | null, mode?: ViewerMode) => boolean
	// Runs `leave`, which takes the viewer away (to a folder, say), once nothing holds it
	leaveViewer: (leave: () => void) => void
	setViewerNavigationGuard: (guard: ViewerNavigationGuard | null) => void
	setViewerStepper: (stepper: ViewerStepper | null) => void
}

export const createFileViewerSlice: StateCreator<
	FileViewerSlice & SelectionSlice & ClipboardSlice & NewFolderSlice & DragAndDropSlice,
	[],
	[],
	FileViewerSlice
> = (set, get) => ({
	viewerItem: null,
	viewerMode: null,
	viewerNavigationGuard: null,
	viewerStepper: null,
	setViewerItem: (item, mode) => {
		const {viewerItem, viewerNavigationGuard} = get()
		// Another file or none, once the guard lets it (a file stepped to is selected in the listing too)
		if (viewerItem && item?.path !== viewerItem.path && viewerNavigationGuard) {
			viewerNavigationGuard(() => {
				if (get().setViewerItem(item, mode) && item) get().setSelectedItems([item])
			})
			return false
		}

		set({viewerItem: item, viewerMode: item ? (mode ?? 'open') : null})
		return true
	},
	leaveViewer: (leave) => {
		const {viewerItem, viewerNavigationGuard} = get()
		if (viewerItem && viewerNavigationGuard) viewerNavigationGuard(leave)
		else leave()
	},
	setViewerNavigationGuard: (guard) => set({viewerNavigationGuard: guard}),
	setViewerStepper: (stepper) => set({viewerStepper: stepper}),
})
