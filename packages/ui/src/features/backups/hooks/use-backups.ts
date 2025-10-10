import {keepPreviousData} from '@tanstack/react-query'
import {useEffect, useRef, useState} from 'react'
import {toast} from 'sonner'

import {trpcReact, type RouterOutput} from '@/trpc/trpc'

import {getUserFriendlyErrorMessage} from '../utils/error-messages'

export type BackupDestination =
	| {type: 'nas'; host: string; rootPath: string} // e.g. /Network/<host>
	| {type: 'external'; mountpoint: string} // partition mountpoint

export type SetupBackupInput = {
	destination: BackupDestination
	folder: string
	encryptionPassword: string
}

export type BackupRepository = RouterOutput['backups']['getRepositories'][number]

export type Backup = RouterOutput['backups']['listBackups'][number]

export function useBackups(options?: {repositoriesEnabled?: boolean}) {
	const utils = trpcReact.useUtils()

	const {
		data: repositories,
		isLoading: isLoadingRepositories,
		refetch: refetchRepositories,
	} = trpcReact.backups.getRepositories.useQuery(undefined, {
		placeholderData: keepPreviousData,
		staleTime: 15_000,
		enabled: options?.repositoriesEnabled ?? true,
	})

	// Individual mutations
	const createRepoMutation = trpcReact.backups.createRepository.useMutation()
	const backupMutation = trpcReact.backups.backup.useMutation()
	const forgetRepoMutation = trpcReact.backups.forgetRepository.useMutation()
	const connectToRepoMutation = trpcReact.backups.connectToExistingRepository.useMutation()

	// Pending state so the wizards have access to it to show loading indicators throughout the flow
	const [isSettingUpBackup, setIsSettingUpBackup] = useState(false)
	const [isForgettingRepository, setIsForgettingRepository] = useState(false)
	const [isBackingUp, setIsBackingUp] = useState(false)

	// Create a repository at the selected folder and immediately start a backup.
	const setupBackup = async (input: SetupBackupInput) => {
		const path = input.folder
		const password = input.encryptionPassword?.trim() ?? ''

		setIsSettingUpBackup(true)
		try {
			// Create repository
			const repositoryId = await createRepoMutation.mutateAsync({path, password})

			// Start first backup (don't wait for completion so we can close the wizard and progress will be shown elsewhere)
			backupNow(repositoryId).catch(() => {})

			// Keep queries fresh
			await utils.backups.getRepositories.invalidate()

			return {repositoryId, path}
		} catch (error: any) {
			const userFriendlyMessage = getUserFriendlyErrorMessage(error)
			toast.error(userFriendlyMessage)
			throw error
		} finally {
			setIsSettingUpBackup(false)
		}
	}

	// Connect to an existing repository at the selected folder and immediately start a backup.
	const connectExistingRepository = async (input: {path: string; password: string}) => {
		const path = input.path
		const password = input.password?.trim() ?? ''

		try {
			const repositoryId = await connectToRepoMutation.mutateAsync({path, password})

			// Start first backup (don't wait)
			backupNow(repositoryId).catch(() => {})

			// invalidate repositories to keep data fresh across views
			await utils.backups.getRepositories.invalidate()
			return {repositoryId, path}
		} catch (error: any) {
			const userFriendlyMessage = getUserFriendlyErrorMessage(error)
			toast.error(userFriendlyMessage)
			throw error
		}
	}

	// Manually trigger a backup for a known repository.
	const backupNow = async (repositoryId: string) => {
		setIsBackingUp(true)
		try {
			await backupMutation.mutateAsync({repositoryId})
			// No success toast since we show progress indicators throughout the UI (floating island, wizards, etc.)
		} catch (error: any) {
			const userFriendlyMessage = getUserFriendlyErrorMessage(error)
			toast.error(userFriendlyMessage)
			throw error
		} finally {
			setIsBackingUp(false)
		}
	}

	// Forget a repository and refresh the repositories list.
	const forgetRepository = async (repositoryId: string) => {
		setIsForgettingRepository(true)
		try {
			await forgetRepoMutation.mutateAsync({repositoryId})
			await utils.backups.getRepositories.invalidate()
			// No success toast since we show progress indicators throughout the UI (floating island, wizards, etc.)
		} catch (error: any) {
			const userFriendlyMessage = getUserFriendlyErrorMessage(error)
			toast.error(userFriendlyMessage)
			throw error
		} finally {
			setIsForgettingRepository(false)
		}
	}

	return {
		// setup flow
		setupBackup,
		isSettingUpBackup,
		connectExistingRepository,
		isConnectingExisting: connectToRepoMutation.isPending,

		// repos
		repositories,
		isLoadingRepositories,
		refetchRepositories,

		// manual backup trigger
		backupNow,
		forgetRepository,
		isForgettingRepository,
		isBackingUp,
	}
}

// Convenience wrappers for queries

export function useBackupProgress(refetchIntervalMs = 1000) {
	const utils = trpcReact.useUtils()
	const previousProgressRef = useRef<Array<{repositoryId: string; percent: number}>>([])

	const query = trpcReact.backups.backupProgress.useQuery(undefined, {
		refetchInterval: refetchIntervalMs,
	})

	// Detect when backups complete and invalidate relevant queries
	useEffect(() => {
		const currentProgress = query.data ?? []
		const previousProgress = previousProgressRef.current

		// Check if any backup completed (disappeared from progress array)
		const hasCompletedBackups = previousProgress.length > 0 && currentProgress.length < previousProgress.length

		if (hasCompletedBackups) {
			// Invalidate queries that should be refreshed after backup completion
			utils.backups.getRepositories.invalidate()
			utils.backups.listBackups.invalidate()
			utils.backups.getRepositorySize.invalidate()
		}

		// Update the ref for next comparison
		previousProgressRef.current = currentProgress
	}, [query.data, utils])

	return query
}

export function useRestoreStatus(refetchIntervalMs = 500) {
	return trpcReact.backups.restoreStatus.useQuery(undefined, {
		refetchInterval: refetchIntervalMs,
	})
}

export function useRepositorySize(repositoryId: string | undefined, options?: {enabled?: boolean; staleTime?: number}) {
	return trpcReact.backups.getRepositorySize.useQuery(
		{repositoryId: repositoryId || ''},
		{
			enabled: Boolean(repositoryId) && (options?.enabled ?? true),
			staleTime: options?.staleTime ?? 15_000,
		},
	)
}

export function useRepositoryBackups(
	repositoryId: string | undefined,
	options?: {enabled?: boolean; staleTime?: number},
) {
	return trpcReact.backups.listBackups.useQuery(
		{repositoryId: repositoryId || ''},
		{
			enabled: Boolean(repositoryId) && (options?.enabled ?? true),
			placeholderData: keepPreviousData,
			staleTime: options?.staleTime ?? 15_000,
		},
	)
}

export function useRestoreBackup() {
	const mutation = trpcReact.backups.restoreBackup.useMutation()

	const restoreBackup = async (backupId: string) => {
		try {
			return await mutation.mutateAsync({backupId})
		} catch (error: any) {
			const userFriendlyMessage = getUserFriendlyErrorMessage(error)
			toast.error(userFriendlyMessage)
			throw error
		}
	}

	return {
		...mutation,
		restoreBackup,
	}
}

export function useConnectToRepository() {
	const mutation = trpcReact.backups.connectToExistingRepository.useMutation()
	const [isConnecting, setIsConnecting] = useState(false)

	const connectToRepository = async (input: {path: string; password: string}) => {
		setIsConnecting(true)
		try {
			return await mutation.mutateAsync(input)
		} catch (error: any) {
			const userFriendlyMessage = getUserFriendlyErrorMessage(error)
			toast.error(userFriendlyMessage)
			throw error
		} finally {
			setIsConnecting(false)
		}
	}

	return {
		...mutation,
		connectToRepository,
		isPending: isConnecting,
	}
}

export function useMountBackup() {
	const mutation = trpcReact.backups.mountBackup.useMutation()

	const mountBackup = async (backupId: string) => {
		try {
			return await mutation.mutateAsync({backupId})
		} catch (error: any) {
			const userFriendlyMessage = getUserFriendlyErrorMessage(error)
			toast.error(userFriendlyMessage)
			throw error
		}
	}

	return {
		...mutation,
		mountBackup,
	}
}

export function useUnmountBackup() {
	const mutation = trpcReact.backups.unmountBackup.useMutation()

	const unmountBackup = async (directoryName: string) => {
		try {
			await mutation.mutateAsync({directoryName})
		} catch (error: any) {
			// Silent failure for unmount operations
			// Don't show error toast - unmount is cleanup, not user-facing action
			console.warn('Unmount failed:', error.message)
		}
	}

	return {
		...mutation,
		unmountBackup,
	}
}
