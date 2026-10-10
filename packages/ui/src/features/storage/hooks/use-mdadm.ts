import {RouterOutput, trpcReact} from '@/trpc/trpc'

export type MdadmStatus = RouterOutput['hardware']['mdadm']['getStatus']
export type MdadmArray = MdadmStatus['arrays'][number]
export type MdadmLevel = '0' | '1' | '5' | '6' | '10'

export const MDADM_LEVELS: Array<{value: MdadmLevel; minDevices: number; descriptionKey: string}> = [
	{value: '0', minDevices: 2, descriptionKey: 'storage-manager.mdadm.level-0-description'},
	{value: '1', minDevices: 2, descriptionKey: 'storage-manager.mdadm.level-1-description'},
	{value: '5', minDevices: 3, descriptionKey: 'storage-manager.mdadm.level-5-description'},
	{value: '6', minDevices: 4, descriptionKey: 'storage-manager.mdadm.level-6-description'},
	{value: '10', minDevices: 4, descriptionKey: 'storage-manager.mdadm.level-10-description'},
]

export function useMdadm() {
	const statusQ = trpcReact.hardware.mdadm.getStatus.useQuery(undefined, {
		refetchInterval: 10_000,
		retry: false,
	})
	const supportedQ = trpcReact.hardware.mdadm.isSupported.useQuery(undefined, {retry: false})

	const createMut = trpcReact.hardware.mdadm.create.useMutation({
		onSuccess: () => statusQ.refetch(),
	})
	const addMut = trpcReact.hardware.mdadm.addDevice.useMutation({
		onSuccess: () => statusQ.refetch(),
	})
	const removeMut = trpcReact.hardware.mdadm.removeDevice.useMutation({
		onSuccess: () => statusQ.refetch(),
	})
	const failMut = trpcReact.hardware.mdadm.failDevice.useMutation({
		onSuccess: () => statusQ.refetch(),
	})
	const stopMut = trpcReact.hardware.mdadm.stop.useMutation({
		onSuccess: () => statusQ.refetch(),
	})
	const assembleMut = trpcReact.hardware.mdadm.assembleScan.useMutation({
		onSuccess: () => statusQ.refetch(),
	})

	return {
		status: statusQ.data,
		isLoading: statusQ.isLoading || supportedQ.isLoading,
		error: statusQ.error,
		supported: supportedQ.data ?? statusQ.data?.supported ?? false,
		exists: statusQ.data?.exists ?? false,
		arrays: statusQ.data?.arrays ?? [],
		refetch: () => statusQ.refetch(),
		createAsync: createMut.mutateAsync,
		isCreating: createMut.isPending,
		createError: createMut.error,
		addAsync: addMut.mutateAsync,
		isAdding: addMut.isPending,
		removeAsync: removeMut.mutateAsync,
		isRemoving: removeMut.isPending,
		failAsync: failMut.mutateAsync,
		isFailing: failMut.isPending,
		stopAsync: stopMut.mutateAsync,
		isStopping: stopMut.isPending,
		assembleAsync: assembleMut.mutateAsync,
		isAssembling: assembleMut.isPending,
	}
}
