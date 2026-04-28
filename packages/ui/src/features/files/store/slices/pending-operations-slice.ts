import {StateCreator} from 'zustand'

import {ClipboardSlice} from '@/features/files/store/slices/clipboard-slice'
import {DragAndDropSlice} from '@/features/files/store/slices/drag-and-drop-slice'
import {FileViewerSlice} from '@/features/files/store/slices/file-viewer-slice'
import {InteractionSlice} from '@/features/files/store/slices/interaction-slice'
import {NewFolderSlice} from '@/features/files/store/slices/new-folder-slice'
import {RenameSlice} from '@/features/files/store/slices/rename-slice'
import {SelectionSlice} from '@/features/files/store/slices/selection-slice'
import type {FileSystemItem} from '@/features/files/types'

// 'removing' = item will disappear (trash, delete, restore)
// 'processing' = item is being worked on (extract, compress)
export type PendingType = 'removing' | 'processing'

export interface PendingOperationsSlice {
	pendingPaths: Map<string, PendingType>
	addPendingPaths: (paths: string[], type: PendingType) => void
	removePendingPaths: (paths: string[]) => void

	// Optimistic items expected to arrive at a destination (e.g. drag-and-drop move)
	incomingItems: FileSystemItem[]
	addIncomingItems: (items: FileSystemItem[]) => void
	removeIncomingItems: (paths: string[]) => void
}

export const createPendingOperationsSlice: StateCreator<
	SelectionSlice &
		ClipboardSlice &
		NewFolderSlice &
		DragAndDropSlice &
		FileViewerSlice &
		RenameSlice &
		InteractionSlice &
		PendingOperationsSlice,
	[],
	[],
	PendingOperationsSlice
> = (set) => ({
	pendingPaths: new Map(),

	addPendingPaths: (paths, type) => {
		set((state) => {
			const next = new Map(state.pendingPaths)
			for (const path of paths) {
				next.set(path, type)
			}
			return {pendingPaths: next}
		})
	},

	removePendingPaths: (paths) => {
		set((state) => {
			const next = new Map(state.pendingPaths)
			for (const path of paths) {
				next.delete(path)
			}
			return {pendingPaths: next}
		})
	},

	incomingItems: [],

	addIncomingItems: (items) => {
		set((state) => ({incomingItems: [...state.incomingItems, ...items]}))
	},

	removeIncomingItems: (paths) => {
		const pathSet = new Set(paths)
		set((state) => ({incomingItems: state.incomingItems.filter((item) => !pathSet.has(item.path))}))
	},
})
