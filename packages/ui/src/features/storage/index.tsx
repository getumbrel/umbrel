// Settings > Storage Manager. The screens are in manager/ and single-drive.tsx: this gives
// them umbreld. Hardware with storage of its own gets Storage Manager. Hardware that keeps
// everything on the drive it starts from gets the single-drive view. And when umbreld can't
// say what the storage is, the drives are listed and nothing is guessed.

import type {TFunction} from 'i18next'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {links} from '@/constants/links'
import {useQueryParams} from '@/hooks/use-query-params'
import {useTemperatureUnit} from '@/hooks/use-temperature-unit'
import {useGlobalSystemState} from '@/providers/global-system-state'
import {trpcReact} from '@/trpc/trpc'

import {missingDrive, toDrive} from './from-umbreld'
import {RaidStatus, raidStatusLabels, StorageDevice} from './hooks/use-storage'
import {toSingleHost} from './hooks/use-storage-headline'
import {useStorageManager} from './hooks/use-storage-manager'
import {useUsbDrives} from './hooks/use-usb-drives'
import {StorageManager} from './manager/manager'
import {Drive} from './model'
import {SingleDriveManager, StorageUnreadable} from './single-drive'
import {getPoolDeviceType, recommendedSsdSizeLabel} from './utils'

const DOWNLOAD_URL = 'https://umbrel.com/downloads'

export default function StorageManagerDialog() {
	const {restart, shutdown} = useGlobalSystemState()
	return <ConnectedStorageManager onShutdown={() => shutdown()} onRestart={() => restart()} />
}

// Storage Manager on whatever umbreld it is given: the real one in Settings, a pretend one in
// the storage lab
export function ConnectedStorageManager({onShutdown, onRestart}: {onShutdown: () => void; onRestart: () => void}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const manager = useStorageManager()
	const [temperatureUnit] = useTemperatureUnit()
	const usb = useUsbDrives()
	const memorySizeQ = trpcReact.system.memorySize.useQuery()
	const close = () => navigate('/settings', {preventScrollReset: true})
	const openBackups = () => navigate('/settings/backups')
	const {raid, devices, state} = manager

	if (manager.loading || manager.error) {
		return (
			<StorageUnreadable
				reason='no-answer'
				loading={manager.loading}
				detail={manager.error?.message}
				retrying={manager.retrying}
				onRetry={manager.retry}
				onClose={close}
				temperatureUnit={temperatureUnit}
			/>
		)
	}

	// No storage was ever set up: everything is on the drive umbrelOS starts from
	if (!manager.isPro && raid && !raid.exists && !raid.name) {
		return (
			<SingleDrive
				devices={devices ?? []}
				usb={usb}
				onClose={close}
				onOpenBackups={openBackups}
				temperatureUnit={temperatureUnit}
			/>
		)
	}

	// A storage that is set up but not running, or one whose drives can't be told apart as SSDs
	// or hard drives, has no layout or plan that could be vouched for
	if (!state) {
		return (
			<StorageUnreadable
				reason='unidentified'
				drives={listDrives(raid, devices ?? [], manager.isPro, t)}
				retrying={manager.retrying}
				onRetry={manager.retry}
				onClose={close}
				temperatureUnit={temperatureUnit}
			/>
		)
	}

	return (
		<StorageManager
			state={state}
			run={manager.run}
			onClose={close}
			onShutdown={onShutdown}
			onRestart={onRestart}
			onOpenBackups={openBackups}
			usb={usb}
			temperatureUnit={temperatureUnit}
			// On the rare failure, recommend from the middle of the memory range instead of nothing
			recommendedSsdSize={memorySizeQ.isLoading ? undefined : recommendedSsdSizeLabel(memorySizeQ.data ?? 16 * 2 ** 30)}
			supportUrl={links.support}
		/>
	)
}

// Every drive umbreld can list, with what is known of its part in the storage
function listDrives(raid: RaidStatus | undefined, devices: StorageDevice[], isPro: boolean, t: TFunction) {
	const members = raid?.devices ?? []
	const accelerators = raid?.accelerator?.devices ?? []
	const kind = getPoolDeviceType(raid, devices) ?? (isPro ? 'ssd' : 'hdd')
	const attached = devices.filter((device): device is StorageDevice & {id: string} => !!device.id)
	const listed: {drive: Drive; role?: string; state?: string}[] = []
	for (const member of [...members, ...accelerators]) {
		const device = attached.find((candidate) => candidate.id === member.id)
		const isAccelerator = accelerators.includes(member)
		listed.push({
			drive: device
				? toDrive(device, member)
				: missingDrive(member.id, isAccelerator ? 'ssd' : kind, (member as {size?: number}).size),
			role: t(isAccelerator ? 'storage-status.accelerator' : 'storage-status.data-drive'),
			state: device ? t(raidStatusLabels[member.status]) : undefined,
		})
	}
	const inStorage = new Set([...members, ...accelerators].map((member) => member.id))
	for (const device of attached) {
		if (inStorage.has(device.id)) continue
		listed.push({
			drive: toDrive(device),
			state: t(device.isSystemDrive ? 'storage-manager.system-drive' : 'storage-status.connected'),
		})
	}
	return listed
}

// Storage Manager for devices without storage of their own: Umbrel Home, Raspberry Pi, a
// container, and other hardware running from a single drive
function SingleDrive({
	devices,
	usb,
	onClose,
	onOpenBackups,
	temperatureUnit,
}: {
	devices: StorageDevice[]
	usb: ReturnType<typeof useUsbDrives>
	onClose: () => void
	onOpenBackups: () => void
	temperatureUnit: 'c' | 'f'
}) {
	const navigate = useNavigate()
	const {addLinkSearchParams} = useQueryParams()
	// Only what the machine is matters here. Its capacity is asked for separately, so that a slow
	// or failed answer can't change the explanation of the setup.
	const identityQ = trpcReact.systemNg.device.getIdentity.useQuery()
	const diskUsageQ = trpcReact.system.systemDiskUsage.useQuery()
	const host = toSingleHost(identityQ.data)
	const attached = devices.filter((device): device is StorageDevice & {id: string} => !!device.id)
	// The drive umbrelOS runs from, when umbreld can see it: NVMe and SATA, not microSD or USB
	const boot = attached.find((device) => device.isSystemDrive)
	const usage = diskUsageQ.data ? {total: diskUsageQ.data.size, used: diskUsageQ.data.totalUsed} : undefined

	return (
		<SingleDriveManager
			host={host}
			drive={boot ? toDrive(boot) : undefined}
			others={attached.filter((device) => !device.isSystemDrive).map((device) => toDrive(device))}
			usage={usage}
			usageFailed={diskUsageQ.isError && !diskUsageQ.isFetching}
			onRetryUsage={() => void diskUsageQ.refetch()}
			usb={usb}
			onOpenBackups={onOpenBackups}
			onViewUsage={() => navigate({search: addLinkSearchParams({dialog: 'live-usage', 'live-usage-tab': 'storage'})})}
			onClose={onClose}
			temperatureUnit={temperatureUnit}
			supportUrl={links.support}
			downloadUrl={DOWNLOAD_URL}
		/>
	)
}
