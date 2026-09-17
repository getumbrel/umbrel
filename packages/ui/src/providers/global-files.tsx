import React, {createContext, useContext, useState} from 'react'

import {transfers} from '@/features/files/transfers/transfers'
import {useTransfersEffects} from '@/features/files/transfers/use-transfers'
import type {RouterOutput} from '@/trpc/trpc'
import {trpcReact} from '@/trpc/trpc'

// Types
interface AudioState {
	path: string | null
	name: string | null
}

// ---------------- Long-running filesystem operations ----------------
// Copy and move currently (could be extended to other operations, such as archive and unarchive)
// Used for the operations floating island, and the rewind restore progress dialog
type OperationProgress = RouterOutput['files']['operationProgress'][number]
export type OperationsInProgress = OperationProgress[]

interface GlobalFilesContextValue {
	// Audio
	audio: AudioState
	setAudio: React.Dispatch<React.SetStateAction<AudioState>>

	// Uploads go through the Files transfer queue (see features/files/transfers).
	// Returns the ids of the queued items so a caller can follow one to its end.
	startUpload: (files: File[] | FileList, destinationPath: string) => string[]

	// Long-running filesystem operations (copy, move, archive, etc.)
	operations: OperationsInProgress
}

// Create the context
const GlobalFilesContext = createContext<GlobalFilesContextValue | null>(null)

// The Provider
export function GlobalFilesProvider({children}: {children: React.ReactNode}) {
	const utils = trpcReact.useUtils()

	// Collision prompts, listing refreshes and the leave-page guard for the
	// transfer queue live here so they run exactly once, app-wide
	useTransfersEffects()

	// -- 1. Audio state
	const [audio, setAudio] = useState<AudioState>({path: null, name: null})

	// -- 2. Operations-in-progress state (copy and move currently)
	const [operations, setOperations] = useState<OperationsInProgress>([])

	// Subscribe to "files:operation-progress" events that stream progress of copy/move
	// operations. The server scopes the stream to the current account's operations.
	trpcReact.eventBus.listen.useSubscription(
		{event: 'files:operation-progress'},
		{
			onData(data) {
				// data is an array of operations currently in progress
				setOperations(data as OperationsInProgress)
			},
			onError(err) {
				// The next successful subscription starts with an authoritative
				// snapshot. Clear now so a dead stream cannot leave stale progress.
				setOperations([])
				console.error('eventBus.listen(files:operation-progress) subscription error', err)
			},
		},
	)

	// Refresh a member's shared paths the moment the owner shares or unshares a
	// path with them (the server only streams changes affecting this account).
	// The owner's own UI already refreshes via its mutations' onSuccess.
	const userQ = trpcReact.user.get.useQuery()
	trpcReact.eventBus.listen.useSubscription(
		{event: 'files:member-shares:change'},
		{
			enabled: userQ.data?.role === 'member',
			onData() {
				utils.files.sharedWithMe.invalidate()
				utils.files.list.invalidate()
			},
			onError(err) {
				console.error('eventBus.listen(files:member-shares:change) subscription error', err)
			},
		},
	)
	// Refresh the owner's network storage state as soon as a share mounts or
	// disconnects; the 15s poll only covers changes the backend cannot announce.
	trpcReact.eventBus.listen.useSubscription(
		{event: 'files:network-storage:change'},
		{
			enabled: userQ.data?.role === 'owner',
			onData() {
				utils.files.listNetworkShares.invalidate()
				utils.files.list.invalidate({path: '/Network'})
			},
			onError(err) {
				console.error('eventBus.listen(files:network-storage:change) subscription error', err)
			},
		},
	)

	const startUpload = (files: File[] | FileList, destinationPath: string) =>
		transfers.enqueueUploads(files instanceof FileList ? Array.from(files) : files, destinationPath).itemIds

	// Finally, compile the context value:
	const value: GlobalFilesContextValue = {
		// audio
		audio,
		setAudio,

		// uploads
		startUpload,

		// operations progress
		operations,
	}

	return <GlobalFilesContext value={value}>{children}</GlobalFilesContext>
}

// A simple custom hook to consume it
export function useGlobalFiles() {
	const ctx = useContext(GlobalFilesContext)
	if (!ctx) {
		throw new Error('useGlobalFiles must be used within <GlobalFilesProvider>')
	}
	return ctx
}
