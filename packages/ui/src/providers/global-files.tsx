import React, {createContext, useCallback, useContext, useRef, useState} from 'react'
import {FileWithPath} from 'react-dropzone'
import {AiOutlineFileExclamation} from 'react-icons/ai'
import {toast} from 'sonner'

import type {FileSystemItem} from '@/features/files/types'
import {splitFileName} from '@/features/files/utils/format-filesystem-name'
import {useConfirmation} from '@/providers/confirmation'
import type {RouterOutput} from '@/trpc/trpc'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
import {secondsToEta} from '@/utils/seconds-to-eta'

// Types
interface AudioState {
	path: string | null
	name: string | null
}

interface UploadStats {
	totalProgress: number
	totalSpeed: number
	totalUploaded: number
	totalSize: number
	eta: string
}

// Extend FileSystemItem for upload-specific states
type UploadStatus = 'uploading' | 'collided' | 'retrying' | 'error' | 'cancelled'
interface UploadingFileSystemItem extends FileSystemItem {
	status: UploadStatus
	// progress, speed, etc. are already optional in FileSystemItem
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

	// Uploads
	uploadingItems: UploadingFileSystemItem[]
	uploadStats: UploadStats
	startUpload: (files: File[] | FileList, destinationPath: string) => void
	cancelUpload: (tempId: string) => void

	// Long-running filesystem operations (copy, move, archive, etc.)
	operations: OperationsInProgress
}

// Create the context
const GlobalFilesContext = createContext<GlobalFilesContextValue | null>(null)

// Utility function for upload calculations
const calculateUploadStats = (items: UploadingFileSystemItem[]): UploadStats => {
	if (items.length === 0) {
		return {
			totalProgress: 0,
			totalSpeed: 0,
			totalUploaded: 0,
			totalSize: 0,
			eta: '-',
		}
	}

	const {totalSpeed, totalUploaded, totalSize} = items.reduce(
		(acc, item) => ({
			totalSpeed: acc.totalSpeed + (item.speed || 0),
			// Only include non-skipped items in progress calculation
			totalUploaded:
				acc.totalUploaded +
				(item.status !== 'cancelled' && item.size && item.progress ? (item.size * item.progress) / 100 : 0),
			totalSize: acc.totalSize + (item.status !== 'cancelled' ? (item.size ?? 0) : 0),
		}),
		{totalSpeed: 0, totalUploaded: 0, totalSize: 0},
	)

	// Calculate total progress based on bytes uploaded vs total bytes
	const totalProgress = totalSize > 0 ? (totalUploaded / totalSize) * 100 : 0

	let eta = '-'
	if (totalSpeed > 0) {
		const remaining = totalSize - totalUploaded
		const secondsRemaining = Math.round(remaining / totalSpeed)
		eta = secondsToEta(secondsRemaining)
	}

	// Handle case where totalSize becomes 0 due to cancellations
	if (totalSize === 0 && items.some((item) => item.status === 'cancelled')) {
		return {totalProgress: 100, totalSpeed: 0, totalUploaded: 0, totalSize: 0, eta: '-'}
	}

	return {
		totalProgress,
		totalSpeed,
		totalUploaded,
		totalSize,
		eta,
	}
}

// The Provider
export function GlobalFilesProvider({children}: {children: React.ReactNode}) {
	const utils = trpcReact.useUtils()
	const confirm = useConfirmation()

	// Directory creation mutation
	const createDirectory = trpcReact.files.createDirectory.useMutation({
		onError: (error) => {
			toast.error(t('files-error.upload', {message: error.message}))
			throw error // Re-throw to handle in the calling function
		},
	})

	// Utility to create all required directories
	const createRequiredDirectories = async (files: FileList | FileWithPath[], destinationPath: string) => {
		const fileArray = files instanceof FileList ? Array.from(files) : files
		const directories = new Set<string>()

		// Collect all unique directory paths
		for (const file of fileArray) {
			const filePath = ('path' in file ? file.path : file.name) as string
			const parts = filePath.split('/')

			// Remove the file name (last part)
			parts.pop()

			// Build directory paths
			let currentPath = destinationPath
			for (const part of parts) {
				if (part) {
					currentPath = `${currentPath}/${part}`
					directories.add(currentPath)
				}
			}
		}

		// Sort directories by depth to create parent directories first
		const sortedDirs = Array.from(directories).sort((a, b) => {
			return a.split('/').length - b.split('/').length
		})

		// Create directories sequentially
		for (const dir of sortedDirs) {
			// const name = dir.split('/').pop()! // Unused
			// const parentPath = dir.slice(0, -name.length - 1) // Unused
			await createDirectory.mutateAsync({path: dir})
		}
	}

	// -- 1. Audio state
	const [audio, setAudio] = useState<AudioState>({path: null, name: null})

	// -- 2. Uploads state
	const [uploadingItems, setUploadingItems] = useState<UploadingFileSystemItem[]>([])
	const [uploadStats, setUploadStats] = useState<UploadStats>(calculateUploadStats([]))
	const activeXHRsRef = useRef<Map<string, XMLHttpRequest>>(new Map())

	// -- 3. Operations-in-progress state (copy and move currently)
	const [operations, setOperations] = useState<OperationsInProgress>([])

	// Subscribe to "files:operation-progress" events that stream progress of copy/move operations
	trpcReact.eventBus.listen.useSubscription(
		{event: 'files:operation-progress'},
		{
			onData(data) {
				// data is an array of operations currently in progress
				setOperations(data as OperationsInProgress)
			},
			onError(err) {
				console.error('eventBus.listen(files:operation-progress) subscription error', err)
			},
		},
	)
	const collisionQueueRef = useRef<Map<string, {item: UploadingFileSystemItem; file: File | FileWithPath}>>(new Map())
	const isConfirmationActiveRef = useRef(false) // Prevent multiple simultaneous prompts
	const applyDecisionToAllRef = useRef<'replace' | 'keep-both' | 'skip' | null>(null)
	const batchIdRef = useRef<string | null>(null) // Identify items belonging to the same batch

	const MAX_CONCURRENT = 2
	const UPDATE_INTERVAL = 1000

	// --- Upload Helper Functions (Declare before use in callbacks) ---

	// Helper to update item state
	const updateItemState = useCallback((tempId: string, updates: Partial<UploadingFileSystemItem>) => {
		setUploadingItems((prev) => {
			const updated = prev.map((item) => (item.tempId === tempId ? {...item, ...updates} : item))
			// Only recalculate stats if something actually changed that affects them
			if (
				updates.progress !== undefined ||
				updates.speed !== undefined ||
				updates.status !== undefined ||
				updates.size !== undefined
			) {
				setUploadStats(calculateUploadStats(updated))
			}
			return updated
		})
	}, [])

	// Helper to remove item
	const removeItem = useCallback((tempId: string) => {
		setUploadingItems((prev) => {
			const updated = prev.filter((item) => item.tempId !== tempId)
			setUploadStats(calculateUploadStats(updated))
			return updated
		})
		activeXHRsRef.current.delete(tempId)
	}, [])

	// Helper to finalize upload for an item
	const finalizeUpload = useCallback(
		async (tempId: string, destinationPath: string) => {
			removeItem(tempId)
			await utils.files.list.invalidate({path: destinationPath})
		},
		[removeItem, utils.files.list],
	)

	// Function to process the next item in the collision queue
	// Need to declare processNextCollision before uploadFile because uploadFile calls it.
	// Need to declare uploadFile before processNextCollision because processNextCollision calls it.
	// This mutual dependency requires forward declaration.

	const uploadFileRef = useRef<typeof uploadFileInternal>()
	const processNextCollisionRef = useRef<typeof processNextCollisionInternal>()

	// Define the internal functions
	const uploadFileInternal = useCallback(
		(
			item: UploadingFileSystemItem,
			file: File | FileWithPath,
			collisionStrategy: 'error' | 'replace' | 'keep-both' = 'error',
		) => {
			const tempId = item.tempId!
			const destinationPath = item.path.substring(0, item.path.lastIndexOf('/'))

			// Use processNextCollisionRef.current inside
			const currentProcessNextCollision = processNextCollisionRef.current

			updateItemState(tempId, {
				status: collisionStrategy === 'error' ? 'uploading' : 'retrying',
				speed: 0,
				progress: collisionStrategy === 'error' ? 0 : undefined,
			})

			const xhr = new XMLHttpRequest()
			activeXHRsRef.current.set(tempId, xhr)

			const uploadUrl = `/api/files/upload?path=${encodeURIComponent(item.path)}&collision=${collisionStrategy}`
			xhr.open('POST', uploadUrl)

			let lastLoaded = 0
			let lastTime = Date.now()
			let lastUpdate = Date.now()

			xhr.upload.onprogress = (e) => {
				if (e.lengthComputable) {
					const now = Date.now()
					const timeSinceLastUpdate = now - lastUpdate

					if (timeSinceLastUpdate >= UPDATE_INTERVAL) {
						const timeElapsed = now - lastTime
						const bytesUploaded = e.loaded - lastLoaded
						// Prevent division by zero and ensure speed is non-negative
						const speed = timeElapsed > 0 ? Math.max(0, (bytesUploaded / timeElapsed) * 1000) : 0
						const progress = Math.round((e.loaded / e.total) * 100)

						// Only update if the item still exists and is uploading/retrying
						setUploadingItems((prev) => {
							const currentItem = prev.find((u) => u.tempId === tempId)
							if (!currentItem || (currentItem.status !== 'uploading' && currentItem.status !== 'retrying')) return prev

							const updated = prev.map((u) =>
								u.tempId === tempId ? {...u, progress, speed, status: currentItem.status} : u,
							)
							setUploadStats(calculateUploadStats(updated))
							return updated
						})

						lastLoaded = e.loaded
						lastTime = now
						lastUpdate = now
					}
				}
			}

			xhr.onload = async () => {
				activeXHRsRef.current.delete(tempId)
				if (xhr.status >= 200 && xhr.status < 300) {
					// Success, finalize (remove item from list, invalidate cache)
					finalizeUpload(tempId, destinationPath)
				} else {
					const isCollision = xhr.responseText?.includes('[destination-already-exists]')

					if (isCollision && collisionStrategy === 'error') {
						// Add to collision queue and mark state
						updateItemState(tempId, {status: 'collided', progress: 0, speed: 0})
						collisionQueueRef.current.set(tempId, {item: {...item, status: 'collided'}, file}) // Store the file too for retry
						// Use the batchId associated with this upload
						const currentBatchId = batchIdRef.current
						if (currentBatchId && currentProcessNextCollision) {
							currentProcessNextCollision(currentBatchId)
						} else {
							console.error(
								'Collision detected but cannot process queue (missing batchId or processNextCollision ref).',
							)
						}
					} else {
						// General error or failed retry
						updateItemState(tempId, {status: 'error', isUploading: false, progress: 0, speed: 0})
						toast.error(t('files-error.upload', {message: `${item.name}: ${xhr.statusText || 'Upload failed'}`}))
					}
				}
			}

			xhr.onerror = () => {
				activeXHRsRef.current.delete(tempId)
				// Network error or similar
				updateItemState(tempId, {status: 'error', isUploading: false, progress: 0, speed: 0})
				toast.error(t('files-error.upload', {message: `Network error during upload of ${item.name}`}))
			}

			xhr.onabort = () => {
				// Only remove if manually aborted via cancelUpload, not internal retries/queueing
				if (!collisionQueueRef.current.has(tempId)) {
					// Check if it's not waiting for collision resolution
					activeXHRsRef.current.delete(tempId)
					removeItem(tempId) // Remove from UI on explicit cancel
				}
			}

			xhr.send(file) // Send the raw file object
		},
		[updateItemState, finalizeUpload, removeItem],
	) // Removed processNextCollision from deps here

	const processNextCollisionInternal = useCallback(
		async (currentBatchId: string) => {
			if (isConfirmationActiveRef.current || collisionQueueRef.current.size === 0) {
				return
			}
			// Use uploadFileRef.current inside
			const currentUploadFile = uploadFileRef.current
			if (!currentUploadFile) {
				return // Cannot proceed without uploadFile
			}

			const nextCollisionEntry = Array.from(collisionQueueRef.current.entries())[0]
			const [tempId, {item, file}] = nextCollisionEntry

			// If a batch decision exists, apply it
			if (applyDecisionToAllRef.current) {
				collisionQueueRef.current.delete(tempId)
				const decision = applyDecisionToAllRef.current
				if (decision === 'skip') {
					removeItem(tempId)
				} else {
					// Retry upload with the chosen strategy
					currentUploadFile(item, file, decision)
				}
				// Process next immediately if applyToAll was used
				requestAnimationFrame(() => processNextCollisionRef.current?.(currentBatchId))
				return
			}

			isConfirmationActiveRef.current = true
			const fromName = splitFileName(item.name).name
			const destinationPath = item.path.split('/').slice(0, -1).join('/')
			const destinationName = destinationPath.split('/').pop() || 'destination' // Extract destination folder name

			try {
				const result = await confirm({
					title: t('files-collision.title', {itemName: fromName, destinationName}),
					message: t('files-collision.message'),
					actions: [
						{label: t('files-collision.action.keep-both'), value: 'keep-both', variant: 'primary'},
						{label: t('files-collision.action.replace'), value: 'replace', variant: 'default'},
						{label: t('files-collision.action.skip'), value: 'skip', variant: 'default'},
					],
					showApplyToAll: collisionQueueRef.current.size > 1, // Show if more than one item is waiting
					icon: AiOutlineFileExclamation,
				})

				collisionQueueRef.current.delete(tempId) // Remove current item before processing decision
				isConfirmationActiveRef.current = false

				const userDecision = result.actionValue as 'replace' | 'keep-both' | 'skip'

				if (result.applyToAll) {
					applyDecisionToAllRef.current = userDecision
				}

				if (userDecision === 'skip') {
					removeItem(tempId)
				} else {
					// Retry upload with the chosen strategy
					currentUploadFile(item, file, userDecision)
				}

				// Trigger processing next collision after a short delay
				// Use requestAnimationFrame to ensure state updates have likely propagated
				// Pass the current function ref to avoid stale closure issues if needed, though direct call should be fine
				requestAnimationFrame(() => processNextCollisionRef.current?.(currentBatchId))
			} catch (error) {
				// User dismissed the dialog
				isConfirmationActiveRef.current = false
				collisionQueueRef.current.delete(tempId) // Remove current item

				// Treat dismissal as 'skip' for the current item
				removeItem(tempId)

				// If Apply to All was potentially checked, set the batch decision to skip
				if (collisionQueueRef.current.size > 0) {
					// Only set if others are waiting
					applyDecisionToAllRef.current = 'skip'
					const remainingItems = Array.from(collisionQueueRef.current.keys())
					remainingItems.forEach((id) => {
						removeItem(id)
						collisionQueueRef.current.delete(id)
					})
				}
			}
		},
		[confirm, removeItem],
	) // Removed uploadFile and processNextCollision dependencies

	// Assign the refs after declaration
	uploadFileRef.current = uploadFileInternal
	processNextCollisionRef.current = processNextCollisionInternal

	// --- End Upload Helper Functions ---

	// Start one or more uploads
	const startUpload = async (files: FileList | FileWithPath[], destinationPath: string) => {
		if (!files || (files instanceof FileList && files.length === 0) || (Array.isArray(files) && files.length === 0)) {
			return
		}

		// Reset batch-specific state for this new upload operation
		const currentBatchId = `batch-${Date.now()}-${Math.random()}`
		batchIdRef.current = currentBatchId // Set the current batch ID
		applyDecisionToAllRef.current = null // Reset apply-to-all decision
		collisionQueueRef.current.clear() // Clear any leftovers from previous batches (shouldn't happen ideally)
		isConfirmationActiveRef.current = false // Ensure confirmation is not locked

		try {
			const fileArray = files instanceof FileList ? Array.from(files) : files

			// Add all uploading items at once
			const newItems: UploadingFileSystemItem[] = fileArray.map((file: File | FileWithPath) => {
				const name = file.name
				// Ensure path always starts with / and handles potential double slashes
				const cleanDestinationPath = destinationPath.endsWith('/') ? destinationPath.slice(0, -1) : destinationPath
				const filePathInDest =
					'path' in file && file.path ? (file.path.startsWith('/') ? file.path : `/${file.path}`) : `/${file.name}`
				const path = `${cleanDestinationPath}${filePathInDest}`

				const tempId = `upload-${path}-${Date.now()}` // Add timestamp for potential retries
				const type = file.type || 'file'
				const size = file.size
				const modified = Date.now()
				const thumbnail = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined

				return {
					tempId,
					name,
					path,
					type,
					size,
					thumbnail,
					operations: [],
					modified,
					isUploading: true,
					status: 'uploading',
					progress: 0,
					speed: 0,
				}
			})

			setUploadingItems((prev) => {
				// Filter out potential duplicates from previous unfinished batches if any? Or rely on tempId.
				const updated = [...prev, ...newItems]
				setUploadStats(calculateUploadStats(updated))
				return updated
			})

			// First create all required directories
			// We do this so that the user can start browsing the directories
			// to see upload progress within them
			// TODO: This is a hack, and won't scale well for a large number of directories
			// or deeply nested directories. We should just let the backend create the directories
			// And as soon as an uploaded file with a directory has been uploaded, we can render the directory
			await createRequiredDirectories(fileArray, destinationPath)
			// Invalidate the list query, and start the upload
			await utils.files.list.invalidate({path: destinationPath})

			// Process uploads with concurrency control
			let activeUploadCount = 0
			const uploadQueue = [...newItems.map((item, index) => ({item, file: fileArray[index]}))] // Queue of {item, file} pairs

			const processQueue = () => {
				while (uploadQueue.length > 0 && activeUploadCount < MAX_CONCURRENT) {
					activeUploadCount++
					const {item, file} = uploadQueue.shift()!

					// Wrap the uploadFile call in a promise that resolves when the upload finishes (success, error, collision queue)
					// or is aborted (external cancellation).
					// We need this to manage concurrency correctly.
					new Promise<void>((resolve) => {
						// Use .then/.catch/.finally on the uploadFile call
						// Use the ref to call the function
						Promise.resolve(uploadFileRef.current?.(item, file, 'error'))
							.catch((err) => {
								console.error('Error during uploadFile execution:', err)
								// Ensure state is updated even if uploadFile itself throws unexpectedly
								updateItemState(item.tempId!, {status: 'error', progress: 0, speed: 0})
							})
							.finally(() => {
								activeUploadCount--
								resolve() // Signal completion for concurrency management
								processQueue() // Attempt to process next in queue
							})
					})
				}
			}

			processQueue() // Start processing the queue
		} catch (error: any) {
			// Error during directory creation or initial setup
			setUploadingItems([]) // Clear queue on setup failure
			toast.error(t('files-error.upload', {message: `Failed to start upload process: ${error.message}`}))
		}
	}

	const cancelUpload = (tempId: string) => {
		const xhr = activeXHRsRef.current.get(tempId)
		if (xhr) {
			xhr.abort() // This triggers the xhr.onabort handler in uploadFile
			activeXHRsRef.current.delete(tempId)
		} else {
			// If not actively uploading (e.g., waiting in collision queue), just remove state
			setUploadingItems((prev) => {
				const updated = prev.filter((item) => item.tempId !== tempId)
				setUploadStats(calculateUploadStats(updated))
				return updated
			})
			// Also remove from collision queue if it's there
			collisionQueueRef.current.delete(tempId)
		}
	}

	// Finally, compile the context value:
	const value: GlobalFilesContextValue = {
		// audio
		audio,
		setAudio,

		// uploads
		uploadingItems,
		uploadStats,
		startUpload,
		cancelUpload,

		// operations progress
		operations,
	}

	return <GlobalFilesContext.Provider value={value}>{children}</GlobalFilesContext.Provider>
}

// A simple custom hook to consume it
export function useGlobalFiles() {
	const ctx = useContext(GlobalFilesContext)
	if (!ctx) {
		throw new Error('useGlobalFiles must be used within <GlobalFilesProvider>')
	}
	return ctx
}
