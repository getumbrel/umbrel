import {useEffect, useMemo, useState} from 'react'

import {useBackups, useMountBackup, useRepositoryBackups, useUnmountBackup} from '@/features/backups/hooks/use-backups'
import type {Backup, BackupRepository} from '@/features/backups/hooks/use-backups'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {trpcReact} from '@/trpc/trpc'

type ViewState = 'preflight' | 'browsing' | 'switching-snapshot' | 'restoring'

export function useRewind({overlayOpen, repoOpen}: {overlayOpen: boolean; repoOpen: boolean}) {
	const [view, setView] = useState<ViewState>('preflight')
	const [mountedDir, setMountedDir] = useState<string | null>(null)
	const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null)
	const [selectedBackupId, setSelectedBackupId] = useState<string>('current')
	const [pendingRepoId, setPendingRepoId] = useState<string | null>(null)

	const {repositories: repositoriesRaw} = useBackups({repositoriesEnabled: repoOpen || overlayOpen})
	const listBackupsQ = useRepositoryBackups(selectedRepoId || undefined, {
		enabled: overlayOpen && !!selectedRepoId,
		staleTime: 10_000,
	})
	const mountBackupM = useMountBackup()
	const unmountBackupM = useUnmountBackup()
	const utils = trpcReact.useUtils()
	const {copyItems} = useFilesOperations()
	const selectedItems = useFilesStore((s) => s.selectedItems)
	const resetInteractionState = useFilesStore((s) => s.resetInteractionState)

	// repos/backups
	const repositories = useMemo(() => (repositoriesRaw as BackupRepository[]) || [], [repositoriesRaw])
	const backupsRaw = useMemo(() => (listBackupsQ.data as Backup[]) || [], [listBackupsQ.data])
	const backupsForTimeline = useMemo(() => {
		const items = backupsRaw.map((b) => ({id: b.id as string, time: b.time as number})).sort((a, b) => a.time - b.time)
		return [...items, {id: 'current', time: Date.now()}]
	}, [backupsRaw])
	const activeIndex = useMemo(
		() => backupsForTimeline.findIndex((b) => b.id === selectedBackupId),
		[backupsForTimeline, selectedBackupId],
	)
	const earliestDateLabel = useMemo(() => {
		if (!backupsRaw.length) return null
		return new Date(backupsRaw[0].time).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		})
	}, [backupsRaw])

	// preflight dialog auto-select
	useEffect(() => {
		if ((overlayOpen || repoOpen) && !selectedRepoId) {
			const first = repositories[0]
			if (first) setSelectedRepoId(first.id)
		}
	}, [overlayOpen, repoOpen, selectedRepoId, repositories])

	useEffect(() => {
		if (repoOpen && !pendingRepoId) {
			const first = repositories[0]
			if (first) setPendingRepoId(first.id)
		}
	}, [repoOpen, pendingRepoId, repositories])

	// TODO: check if we still need this logic after we make the umbreld kopia queue change
	/**
	 * Attempt to detect if the requested snapshot is ALREADY mounted from a previous session
	 * and can be reused without calling the backend again.
	 *
	 * How it works:
	 * - The backend names mount directories using the snapshot's ISO time string
	 *   (e.g., 2025-09-17T04:51:51.039Z)
	 * - Given a backup id, we find its time and derive the expected directory name
	 * - We then probe `/Backups/<dir>/Home` via files.list; if it succeeds, the bind mounts exist
	 * - Returns that directory name on success, or null if not mounted
	 */
	const getExistingMountedDirForSnapshot = async (targetId: string): Promise<string | null> => {
		const match = (backupsRaw as any[]).find((b) => b.id === targetId)
		if (!match) return null
		const directoryName = new Date(match.time).toISOString()
		try {
			await utils.files.list.fetch({
				path: `/Backups/${directoryName}/Home`,
				limit: 1,
				sortBy: 'name',
				sortOrder: 'ascending',
			} as any)
			return directoryName
		} catch {
			return null
		}
	}

	const unmountIfNeeded = async () => {
		if (!mountedDir) return
		try {
			await unmountBackupM.mutateAsync({directoryName: mountedDir})
		} finally {
			setMountedDir(null)
		}
	}

	const selectSnapshot = async (targetId: string) => {
		// We intentionally clear interaction state when switching snapshots.
		// This avoids carrying over selection or an open viewer from a previous snapshot into the next one
		resetInteractionState()
		setSelectedBackupId(targetId)
		setView('switching-snapshot')

		// If this snapshot already has a leftover mount, reuse it
		if (targetId !== 'current') {
			const existingDir = await getExistingMountedDirForSnapshot(targetId)
			if (existingDir) {
				setMountedDir(existingDir)
				setView('browsing')
				return
			}
		}

		await unmountIfNeeded()
		if (targetId !== 'current') {
			const dir = await mountBackupM.mutateAsync({backupId: targetId})
			setMountedDir(dir)
		}
		setView('browsing')
	}

	const canRecover = useMemo(() => {
		if (!mountedDir) return false
		if (selectedBackupId === 'current') return false
		if (!selectedItems.length) return false
		const baseHome = `/Backups/${mountedDir}/Home`
		const baseApps = `/Backups/${mountedDir}/Apps`
		return selectedItems.every((i) => i.path.startsWith(baseHome) || i.path.startsWith(baseApps))
	}, [mountedDir, selectedBackupId, selectedItems])

	return {
		// view
		view,
		setView,

		// entities
		repositories,
		backupsRaw,
		backupsForTimeline,
		activeIndex,
		earliestDateLabel,

		// selection
		selectedRepoId,
		setSelectedRepoId,
		pendingRepoId,
		setPendingRepoId,
		selectedBackupId,
		setSelectedBackupId,

		// mounting
		mountedDir,
		selectSnapshot,
		unmountIfNeeded,

		// restore helpers
		copyItems,
		canRecover,
	}
}
