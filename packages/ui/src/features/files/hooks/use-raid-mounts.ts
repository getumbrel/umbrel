import {useTranslation} from 'react-i18next'

import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useShares} from '@/features/files/hooks/use-shares'
import {trpcReact} from '@/trpc/trpc'
import type {RouterOutput} from '@/trpc/trpc'

export type RaidMount = RouterOutput['files']['raidMounts'][number]

/**
 * Linux RAID (mdadm) array mounts exposed to Files under /Raid.
 * Read-only listing: arrays are created and managed in Storage Manager.
 */
export function useRaidMounts() {
	const {t} = useTranslation()
	const {navigateToDirectory, currentPath} = useNavigate()
	const {isPathShared} = useShares()
	const mountsQ = trpcReact.files.raidMounts.useQuery(undefined, {
		refetchInterval: 15_000,
		retry: false,
	})

	return {
		mounts: mountsQ.data ?? [],
		isLoading: mountsQ.isLoading,
		error: mountsQ.error,
		isPathShared,
		currentPath,
		navigateToDirectory,
		t,
	}
}
