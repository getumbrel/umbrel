import React, {createContext, useContext, useRef, useState} from 'react'
import {FileWithPath} from 'react-dropzone'
import {toast} from 'sonner'

import type {FileSystemItem} from '@/features/files/types'
import {trpcReact} from '@/trpc/trpc'

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

interface GlobalFilesContextValue {
	// Audio
	audio: AudioState
	setAudio: React.Dispatch<React.SetStateAction<AudioState>>

	// Uploads
	uploadingItems: FileSystemItem[]
	uploadStats: UploadStats
	startUpload: (files: File[] | FileList, destinationPath: string) => void
	cancelUpload: (tempId: string) => void
}

// Create the context
const GlobalFilesContext = createContext<GlobalFilesContextValue | null>(null)

// Utility function for upload calculations
const calculateUploadStats = (items: FileSystemItem[]): UploadStats => {
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
			totalUploaded: acc.totalUploaded + ((item.size ?? 0) * (item.progress ?? 0)) / 100,
			totalSize: acc.totalSize + (item.size ?? 0),
		}),
		{totalSpeed: 0, totalUploaded: 0, totalSize: 0},
	)

	// Calculate total progress based on bytes uploaded vs total bytes
	const totalProgress = totalSize > 0 ? (totalUploaded / totalSize) * 100 : 0

	let eta = '-'
	if (totalSpeed > 0) {
		const remaining = totalSize - totalUploaded
		const secondsRemaining = Math.round(remaining / totalSpeed)

		if (secondsRemaining >= 0 && Number.isFinite(secondsRemaining)) {
			if (secondsRemaining < 60) eta = `${secondsRemaining}s`
			else if (secondsRemaining < 3600) eta = `${Math.round(secondsRemaining / 60)}m`
			else {
				const hours = Math.floor(secondsRemaining / 3600)
				const minutes = Math.round((secondsRemaining % 3600) / 60)
				eta = `${hours}hr ${minutes}m`
			}
		}
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
	const utils = trpcReact.useContext()

	// Directory creation mutation
	const createDirectory = trpcReact.files.createDirectory.useMutation({
		onError: (error) => {
			toast.error(`Failed to create folder: ${error.message}`)
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
			const name = dir.split('/').pop()!
			const parentPath = dir.slice(0, -name.length - 1)
			await createDirectory.mutateAsync({path: parentPath, name})
		}
	}

	// -- 1. Audio state
	const [audio, setAudio] = useState<AudioState>({path: null, name: null})

	// -- 2. Uploads state
	const [uploadingItems, setUploadingItems] = useState<FileSystemItem[]>([])
	const [uploadStats, setUploadStats] = useState<UploadStats>(calculateUploadStats([]))
	const activeXHRsRef = useRef<Map<string, XMLHttpRequest>>(new Map())
	const MAX_CONCURRENT = 2
	const UPDATE_INTERVAL = 1000

	// Start one or more uploads
	const startUpload = async (files: FileList | FileWithPath[], destinationPath: string) => {
		if (!files || (files instanceof FileList && files.length === 0) || (Array.isArray(files) && files.length === 0)) {
			return
		}

		try {
			const fileArray = files instanceof FileList ? Array.from(files) : files
			const timestamp = new Date().toISOString()

			// Add all uploading items at once
			const newItems: FileSystemItem[] = fileArray.map((file: File | FileWithPath) => {
				const name = file.name
				const path = 'path' in file ? `${destinationPath}${file.path}` : `${destinationPath}/${file.name}`
				const tempId = `upload-${path}`
				const type = file.type || 'file'
				const size = file.size
				const created = timestamp
				const modified = timestamp

				return {
					tempId,
					name,
					path,
					type,
					size,
					ops: 0,
					created,
					modified,
					isUploading: true,
					progress: 0,
					speed: 0,
				}
			})

			setUploadingItems((prev) => {
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
			let activeUploads: Promise<void>[] = []

			for (let i = 0; i < fileArray.length; i++) {
				if (activeUploads.length >= MAX_CONCURRENT) {
					await Promise.race(activeUploads)
				}

				const uploadPromise = new Promise<void>((resolve) => {
					const item = newItems[i]
					const file = fileArray[i]

					const formData = new FormData()
					formData.append('path', item.path.slice(0, -item.name.length))
					formData.append(`file-${i}`, file)

					const xhr = new XMLHttpRequest()
					xhr.open('POST', '/api/files/upload')

					activeXHRsRef.current.set(item.tempId ?? '', xhr)

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
								const speed = (bytesUploaded / timeElapsed) * 1000
								const progress = Math.round((e.loaded / e.total) * 100)

								setUploadingItems((prev) => {
									// Only update if the item still exists
									if (!prev.some((u) => u.tempId === item.tempId)) return prev

									const updated = prev.map((u) =>
										u.tempId === item.tempId ? {...u, progress, speed, isUploading: true} : u,
									)
									// Calculate stats using the updated items
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
						activeXHRsRef.current.delete(item.tempId ?? '')
						if (xhr.status >= 200 && xhr.status < 300) {
							setUploadingItems((prev) => {
								const updated = prev.filter((u) => u.tempId !== item.tempId)
								setUploadStats(calculateUploadStats(updated))
								return updated
							})
							await utils.files.list.invalidate({path: destinationPath})
						} else {
							setUploadingItems((prev) => {
								const updated = prev.map((u) =>
									u.tempId === item.tempId ? {...u, isUploading: false, progress: 0, speed: 0} : u,
								)
								setUploadStats(calculateUploadStats(updated))
								return updated
							})
						}
						activeUploads = activeUploads.filter((p) => p !== uploadPromise)
						resolve()
					}

					xhr.onerror = () => {
						activeXHRsRef.current.delete(item.tempId ?? '')
						setUploadingItems((prev) => {
							const updated = prev.map((u) =>
								u.tempId === item.tempId ? {...u, isUploading: false, progress: 0, speed: 0} : u,
							)
							setUploadStats(calculateUploadStats(updated))
							return updated
						})
						activeUploads = activeUploads.filter((p) => p !== uploadPromise)
						resolve()
					}

					xhr.onabort = () => {
						activeXHRsRef.current.delete(item.tempId ?? '')
						setUploadingItems((prev) => {
							const updated = prev.filter((u) => u.tempId !== item.tempId)
							setUploadStats(calculateUploadStats(updated))
							return updated
						})
						activeUploads = activeUploads.filter((p) => p !== uploadPromise)
						resolve()
					}

					xhr.send(formData)
				})

				activeUploads.push(uploadPromise)
			}

			await Promise.all(activeUploads)
		} catch (error: any) {
			setUploadingItems([])
			toast.error(`Failed to upload files: ${error.message}`)
		}
	}

	const cancelUpload = (tempId: string) => {
		const xhr = activeXHRsRef.current.get(tempId)
		if (xhr) {
			xhr.abort()
			activeXHRsRef.current.delete(tempId)
		}
	}

	// Finally, compile your context value:
	const value: GlobalFilesContextValue = {
		// audio
		audio,
		setAudio,

		// uploads
		uploadingItems,
		uploadStats,
		startUpload,
		cancelUpload,
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
