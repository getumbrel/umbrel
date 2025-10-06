import {useEffect, useState} from 'react'

import type {BackupRepository} from '@/features/backups/hooks/use-backups'
import {BACKUP_FILE_NAME} from '@/features/backups/utils/filepath-helpers'
import {trpcReact} from '@/trpc/trpc'

export type ExistingRepoStatus = 'none' | 'exists-not-configured' | 'already-configured'

export function useExistingBackupDetection(folder: string | undefined, repositories: BackupRepository[] | undefined) {
	const utils = trpcReact.useUtils()
	const [status, setStatus] = useState<ExistingRepoStatus>('none')
	const [repositoryPath, setRepositoryPath] = useState<string | undefined>(undefined)

	// Detect whether the selected folder contains an Umbrel backup repository and
	// whether that repository is already configured on this Umbrel.
	useEffect(() => {
		let cancelled = false
		async function detect() {
			// If no folder is selected, reset state and exit early
			if (!folder) {
				if (!cancelled) {
					setStatus('none')
					setRepositoryPath(undefined)
				}
				return
			}
			try {
				// Build the expected repository path once
				// TODO: In the future we could consider replacing this list-based existence check with a dedicated files.stat/files.exists endpoint
				const normalizedFolder = folder.replace(/\/+$/, '')
				const repoPath = `${normalizedFolder}/${BACKUP_FILE_NAME}`
				if (!cancelled) setRepositoryPath(repoPath)

				// 1) First, check if this repository is already configured locally
				const isAlreadyConfigured = (repositories || []).some((r) => r.path === repoPath)
				if (isAlreadyConfigured) {
					if (!cancelled) setStatus('already-configured')
					return
				}

				// 2) Otherwise, directly attempt to list the constructed repo path.
				// If it succeeds, the repo folder exists (even if empty).
				await utils.files.list.fetch({path: repoPath, limit: 1, sortBy: 'name', sortOrder: 'ascending'})
				if (!cancelled) setStatus('exists-not-configured')
			} catch {
				// On any error (e.g., permission or transient listing error), fall back
				// to a neutral state rather than blocking the flow
				if (!cancelled) {
					setStatus('none')
					setRepositoryPath(undefined)
				}
			}
		}
		void detect()
		return () => {
			// Prevent state updates if the component unmounts while the async work is in flight
			cancelled = true
		}
	}, [folder, repositories, utils.files.list])

	return {status, repositoryPath}
}
