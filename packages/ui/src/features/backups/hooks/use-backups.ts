import {keepPreviousData} from '@tanstack/react-query'
import {useEffect, useRef, useState} from 'react'

import {toast} from '@/components/ui/toast'
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

// Every backup repository has been created with its encryption password
// trimmed, so every call that creates, connects to or restores from one trims
// it the same way. Otherwise a password pasted with a stray space could set up
// a backup but never restore it.
export function normalizeEncryptionPassword(password: string) {
	return password.trim()
}

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

	// Create a repository at the selected folder and immediately start a backup.
	const setupBackup = async (input: SetupBackupInput) => {
		const path = input.folder
		const password = normalizeEncryptionPassword(input.encryptionPassword ?? '')

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
			toast.error(userFriendlyMessage, {area: 'settings'})
			throw error
		} finally {
			setIsSettingUpBackup(false)
		}
	}

	// Connect to an existing repository at the selected folder and immediately start a backup.
	const connectExistingRepository = async (input: {path: string; password: string}) => {
		const path = input.path
		const password = normalizeEncryptionPassword(input.password ?? '')

		try {
			const repositoryId = await connectToRepoMutation.mutateAsync({path, password})

			// Start first backup (don't wait)
			backupNow(repositoryId).catch(() => {})

			// invalidate repositories to keep data fresh across views
			await utils.backups.getRepositories.invalidate()
			return {repositoryId, path}
		} catch (error: any) {
			const userFriendlyMessage = getUserFriendlyErrorMessage(error)
			toast.error(userFriendlyMessage, {area: 'settings'})
			throw error
		}
	}

	// Triggers a backup for a repository.
	// UI components should use `useTriggerBackupForRepo` so that loading state is isolated.
	const backupNow = async (repositoryId: string) => {
		try {
			await backupMutation.mutateAsync({repositoryId})
			// No success toast since we show progress indicators throughout the UI (floating island, wizards, etc.)
		} catch (error: any) {
			const userFriendlyMessage = getUserFriendlyErrorMessage(error)
			toast.error(userFriendlyMessage, {area: 'settings'})
			throw error
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
			toast.error(userFriendlyMessage, {area: 'settings'})
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

		// repository management
		forgetRepository,
		isForgettingRepository,
	}
}

// Convenience wrappers for queries

/**
 * Keeps the backup-progress cache current from the event bus. umbreld pushes
 * the whole in-progress list on every change (a backup starting, each percent,
 * completion), so nothing needs to poll while idle — and polling every second
 * forever kept every page's query consumers re-rendering. Mount once for the
 * desktop (FloatingIslandContainer), owner only: members can't listen to it.
 */
export function useBackupProgressLiveUpdates({enabled = true}: {enabled?: boolean} = {}) {
	const utils = trpcReact.useUtils()

	trpcReact.eventBus.listen.useSubscription(
		{event: 'backups:backup-progress'},
		{
			enabled,
			// Refetch on every (re)connect so a dropped websocket can't leave the
			// progress UI frozen on a stale snapshot (onStarted fires on reconnect too)
			onStarted: () => utils.backups.backupProgress.invalidate(),
			onData: (data) =>
				utils.backups.backupProgress.setData(undefined, data as RouterOutput['backups']['backupProgress']),
			onError: (error) => console.error('backups:backup-progress subscription error', error),
		},
	)
}

// Events can be missed, so the event-driven queries still poll slowly while idle
const IDLE_SAFETY_POLL_MS = 30_000

export function useBackupProgress(refetchIntervalMs = 1000) {
	const utils = trpcReact.useUtils()
	const previousProgressRef = useRef<Array<{repositoryId: string; percent: number}>>([])

	const query = trpcReact.backups.backupProgress.useQuery(undefined, {
		// The event bus keeps this current (see useBackupProgressLiveUpdates), but
		// events can be missed, so keep polling: every second while a backup is in
		// flight, and a slow check while idle so a missed start still surfaces
		refetchInterval: (query) => (query.state.data?.length ? refetchIntervalMs : IDLE_SAFETY_POLL_MS),
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

	// Cap progress percentages at 100% as sometimes the backend
	// reports progress percentages greater than 100%.
	// TODO: remove this once the backend is fixed.
	const cappedData = query.data?.map((progress) => ({
		...progress,
		percent: Math.min(progress.percent, 100),
	}))

	return {
		...query,
		data: cappedData,
	}
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
			toast.error(userFriendlyMessage, {area: 'settings'})
			throw error
		}
	}

	return {
		...mutation,
		restoreBackup,
	}
}

// A caller that shows the error itself, next to the password, turns the toast off
export function useConnectToRepository({toastErrors = true}: {toastErrors?: boolean} = {}) {
	const mutation = trpcReact.backups.connectToExistingRepository.useMutation()
	const [isConnecting, setIsConnecting] = useState(false)

	const connectToRepository = async (input: {path: string; password: string}) => {
		setIsConnecting(true)
		try {
			return await mutation.mutateAsync({...input, password: normalizeEncryptionPassword(input.password)})
		} catch (error: any) {
			if (toastErrors) toast.error(getUserFriendlyErrorMessage(error), {area: 'settings'})
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
			toast.error(userFriendlyMessage, {area: 'settings'})
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

// Triggers a backup for a single repository.
// Use in UI components to isolate loading state per component (e.g., a button)
export function useTriggerBackupForRepo(repositoryId: string) {
	const utils = trpcReact.useUtils()
	const mutation = trpcReact.backups.backup.useMutation({
		onSuccess: () => {
			// Refresh repositories after triggering a backup
			utils.backups.getRepositories.invalidate()
		},
		onError: (error: any) => {
			const userFriendlyMessage = getUserFriendlyErrorMessage(error)
			toast.error(userFriendlyMessage, {area: 'settings'})
		},
	})

	const triggerBackup = () => mutation.mutate({repositoryId})

	return {
		triggerBackup,
		isPending: mutation.isPending,
	}
}
