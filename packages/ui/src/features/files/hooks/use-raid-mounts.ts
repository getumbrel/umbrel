import {useTranslation} from 'react-i18next'
import {FaEject} from 'react-icons/fa6'

import {toast} from '@/components/ui/toast'
import {getActiveAppsUsingStoragePaths, showStorageInUseDialog} from '@/features/files/components/storage-in-use'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useShares} from '@/features/files/hooks/use-shares'
import {getFilesErrorMessage} from '@/features/files/utils/error-messages'
import {useConfirmation} from '@/providers/confirmation'
import {trpcReact} from '@/trpc/trpc'
import type {RouterError, RouterOutput} from '@/trpc/trpc'

export type RaidMount = RouterOutput['files']['raidMounts'][number]

/**
 * Linux RAID (mdadm) array mounts exposed to Files under /Raid.
 * Arrays are created and managed in Storage Manager; here we can unmount (eject)
 * them safely, which also drops their persisted fstab entry.
 */
export function useRaidMounts() {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()
	const confirm = useConfirmation()
	const {navigateToDirectory, currentPath} = useNavigate()
	const {isPathShared} = useShares()
	const appsQ = trpcReact.apps.list.useQuery()

	const mountsQ = trpcReact.files.raidMounts.useQuery(undefined, {
		refetchInterval: 15_000,
		retry: false,
	})

	const {mutateAsync: ejectRaid, isPending: isEjecting} = trpcReact.files.unmountRaidMount.useMutation({
		onMutate: async (input) => {
			// Cancel the sidebar query we're about to optimistically update
			await utils.files.raidMounts.cancel()

			// Snapshot for rollback, and remember the virtual path so we can
			// navigate away if the user was browsing inside this array
			const previousMounts = utils.files.raidMounts.getData()
			const mountPath = previousMounts?.find((mount) => mount.device === input.device)?.path ?? '/Raid'
			utils.files.raidMounts.setData(undefined, (old) => old?.filter((mount) => mount.device !== input.device))

			return {previousMounts, mountPath}
		},
		onSuccess: (_, __, context) => {
			if (currentPath.startsWith(context?.mountPath ?? '')) navigateToDirectory('/Home')
		},
		onError: (error: RouterError, _, context) => {
			if (context?.previousMounts) utils.files.raidMounts.setData(undefined, context.previousMounts)
			const ejectPath = context?.mountPath ?? '/Raid'
			// Being blocked because an app is using the array gets a dialog listing
			// the apps so the user knows what to stop before ejecting again
			if (error.message.includes('[storage-in-use-by-apps]')) {
				showStorageInUseDialog({
					confirm,
					t,
					title: t('files-raid.eject-blocked-title'),
					description: t('files-raid.eject-blocked-description'),
					fallbackMessage: getFilesErrorMessage(error.message),
					storagePath: ejectPath,
					storageName: t('files-raid.title'),
					apps: getActiveAppsUsingStoragePaths(appsQ.data, [ejectPath]),
				})
			} else {
				toast.error(t('files-error.eject-disk', {message: getFilesErrorMessage(error.message)}), {
					area: 'files',
				})
			}
		},
		onSettled: () => {
			utils.files.raidMounts.invalidate()
		},
	})

	return {
		mounts: mountsQ.data ?? [],
		isLoading: mountsQ.isLoading,
		error: mountsQ.error,
		ejectRaid,
		isEjecting,
		isPathShared,
		currentPath,
		navigateToDirectory,
		t,
	}
}
