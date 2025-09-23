import {keepPreviousData} from '@tanstack/react-query'
import {useState} from 'react'
import {toast} from 'sonner'

import {trpcReact, type RouterOutput} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

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

	// Pending state so the wizards have access to it to show loading indicators throughout the flow
	const [isSettingUpBackup, setIsSettingUpBackup] = useState(false)

	// Create a repository at the selected folder and immediately start a backup.
	const setupBackup = async (input: SetupBackupInput) => {
		const path = input.folder
		const password = input.encryptionPassword?.trim() ?? ''

		if (!path) {
			const msg = t('Please choose a folder')
			toast.error(msg)
			throw new Error(msg)
		}
		if (!password) {
			const msg = t('Password is required')
			toast.error(msg)
			throw new Error(msg)
		}

		setIsSettingUpBackup(true)
		try {
			// Create repository
			const repositoryId = await createRepoMutation.mutateAsync({path, password})

			if (!repositoryId) {
				const msg = t('Unable to locate repository after creation')
				toast.error(msg)
				throw new Error(msg)
			}

			// Start first backup (don't wait for completion so we can close the wizard and progress will be shown elsewhere)
			backupMutation.mutateAsync({repositoryId}).catch((error) => {
				// We allow wizard to close show error toast
				const message = error?.message ?? t('Unknown error')
				toast.error(t('Failed to start initial backup: {{message}}', {message}))
			})

			// Keep queries fresh
			await utils.backups.getRepositories.invalidate()

			return {repositoryId, path}
		} catch (error: any) {
			const message = error?.message ?? t('Unknown error')
			toast.error(t('backups-setup.error', {message}))
			throw error
		} finally {
			setIsSettingUpBackup(false)
		}
	}

	// Manually trigger a backup for a known repository.
	const backupNow = async (repositoryId: string) => {
		try {
			await backupMutation.mutateAsync({repositoryId})
			// No success toast since we show progress indicators throughout the UI (floating island, wizards, etc.)
		} catch (error: any) {
			const message = error?.message ?? t('Unknown error')
			toast.error(t('Failed to start backup: {{message}}', {message}))
			throw error
		}
	}

	// Forget a repository and refresh the repositories list.
	const forgetRepository = async (repositoryId: string) => {
		try {
			await forgetRepoMutation.mutateAsync({repositoryId})
			await utils.backups.getRepositories.invalidate()
			// No success toast since we show progress indicators throughout the UI (floating island, wizards, etc.)
		} catch (error: any) {
			const message = error?.message ?? t('Unknown error')
			toast.error(t('Failed to remove repository: {{message}}', {message}))
			throw error
		}
	}

	return {
		// setup flow
		setupBackup,
		isSettingUpBackup,

		// repos
		repositories,
		isLoadingRepositories,
		refetchRepositories,

		// manual backup trigger
		backupNow,
		forgetRepository,
	}
}

// Convenience wrappers for queries

export function useBackupProgress(refetchIntervalMs = 1000) {
	return trpcReact.backups.backupProgress.useQuery(undefined, {
		refetchInterval: refetchIntervalMs,
	})
}

export function useRestoreProgress(refetchIntervalMs = 500) {
	return trpcReact.backups.restoreProgress.useQuery(undefined, {
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
	return trpcReact.backups.restoreBackup.useMutation()
}

export function useConnectToRepository() {
	return trpcReact.backups.connectToExistingRepository.useMutation()
}

export function useMountBackup() {
	return trpcReact.backups.mountBackup.useMutation()
}

export function useUnmountBackup() {
	return trpcReact.backups.unmountBackup.useMutation()
}
