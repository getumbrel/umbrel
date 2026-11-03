import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {DialogPortal, DialogTitle} from '@/components/ui/dialog'
import {
	ImmersiveDialog,
	ImmersiveDialogContent,
	ImmersiveDialogOverlay,
	immersiveDialogTitleClass,
} from '@/components/ui/immersive-dialog'
import {deviceInfoToHostEnvironment} from '@/hooks/use-device-info'
import {trpcReact} from '@/trpc/trpc'

import {getDeviceHealth, StorageDevice} from '../hooks/use-storage'
import {formatStorageSize} from '../utils'
import {SsdHealthDialog, useSsdHealthDialog} from './dialogs/ssd-health-dialog'
import {DriveIcon, HardDriveIcon, SsdChip} from './list-manager/drive-visuals'
import {OtherDrives, StorageMigrationDescription} from './other-drives'
import {StorageDonutChart} from './storage-donut-chart'
import {StorageModeDisplay} from './storage-mode-display'
import {StorageReadError} from './storage-page'
import {StorageStats} from './storage-stats'
import {UsbDrives} from './usb-drives'

// Storage manager for devices without a storage pool: Umbrel Home, Raspberry Pi, and
// custom hardware running from a single drive. There is nothing to configure, so this
// showcases what the device has - Full Storage mode, the drive itself with health
// access when we can see it, and how much of it is used.
export default function SingleDriveStorageManager({devices}: {devices: StorageDevice[]}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	// Only hardware identity is needed here; OS-version and capacity requests must
	// not delay or change the explanation of the storage setup.
	const deviceInfoQ = trpcReact.systemNg.device.getIdentity.useQuery()
	const hostEnvironment = deviceInfoToHostEnvironment(deviceInfoQ.data)

	// The boot drive when it is visible to us (NVMe/SATA - Umbrel Home, custom PCs).
	// SD, USB, and eMMC system drives are outside the internal NVMe/SATA inventory.
	const bootDrive = devices.find((device) => device.isSystemDrive)
	// Other internal drives (an old data disk left in a custom PC): not usable for storage
	// without a pool, but still worth showing for health/SMART visibility
	const otherDrives = devices.filter((device) => !device.isSystemDrive && device.id)

	// Used/total for the disk umbrelOS (and all data) lives on
	const diskUsageQ = trpcReact.system.systemDiskUsage.useQuery()
	const totalBytes = diskUsageQ.data?.size ?? bootDrive?.size ?? 0
	const storageSizeLabel = diskUsageQ.data || bootDrive ? formatStorageSize(totalBytes) : '—'
	const usedBytes = diskUsageQ.data?.totalUsed ?? 0
	const freeBytes = Math.max(0, totalBytes - usedBytes)
	// A failed query would otherwise render a healthy, completely empty drive - keep the
	// skeletons up instead and let react-query's refetches recover
	const isLoading = diskUsageQ.isLoading

	const healthDialog = useSsdHealthDialog()
	const healthDialogDevice = devices.find((device) => device.id === healthDialog.selectedDevice?.deviceId)

	const isRaspberryPi = hostEnvironment === 'raspberry-pi'

	// Why FailSafe is out of reach on a single-drive device, shown in the mode info dialog.
	// Umbrel Home and Raspberry Pi simply lack the slots; generic x86 devices with free
	// slots get pointed at the reinstall path (umbrelOS boots from this same drive, so
	// FailSafe needs a dedicated boot drive plus fresh storage drives).
	const isLimitedSlotDevice = hostEnvironment === 'umbrel-home' || isRaspberryPi
	const canOfferSetupGuidance = !!deviceInfoQ.data && !isLimitedSlotDevice && hostEnvironment !== 'docker-container'
	const failsafeUnavailableReason = [
		t('storage-manager.mode.failsafe-unavailable-single-drive'),
		...(canOfferSetupGuidance ? [t('storage-manager.mode.failsafe-unavailable-single-drive-generic')] : []),
	].join(' ')

	// The parent confirmed there is no pool. A system drive outside the internal
	// inventory, or an unavailable capacity reading, does not change that setup.
	let otherDrivesDescription: React.ReactNode
	if (deviceInfoQ.isLoading) {
		otherDrivesDescription = <div aria-hidden='true' className='h-16' />
	} else if (!deviceInfoQ.data) {
		otherDrivesDescription = <p>{t('storage-manager.other-drives.device-info-unavailable')}</p>
	} else if (hostEnvironment === 'umbrel-home') {
		otherDrivesDescription = <p>{t('storage-manager.other-drives.home')}</p>
	} else if (isRaspberryPi) {
		otherDrivesDescription = <p>{t('storage-manager.other-drives.pi')}</p>
	} else if (hostEnvironment === 'docker-container') {
		otherDrivesDescription = <p>{t('storage-manager.other-drives.container')}</p>
	} else {
		otherDrivesDescription = (
			<StorageMigrationDescription
				variant='single-drive'
				hasMixedDrives={devices.some((d) => d.type === 'ssd') && devices.some((d) => d.type === 'hdd')}
			/>
		)
	}

	const artwork = bootDrive ? (
		bootDrive.type === 'hdd' ? (
			<HardDriveIcon led={getDeviceHealth(bootDrive).hasWarning ? 'red' : 'green'} />
		) : (
			<SsdChip
				sizeLabel={formatStorageSize(bootDrive.size)}
				led={getDeviceHealth(bootDrive).hasWarning ? 'red' : 'none'}
			/>
		)
	) : isRaspberryPi ? (
		<DriveIcon />
	) : (
		<SsdChip sizeLabel={storageSizeLabel} />
	)

	const driveCard = (
		<div
			onClick={bootDrive ? () => healthDialog.openDialog(bootDrive) : undefined}
			className={
				bootDrive
					? 'flex w-full cursor-pointer items-center gap-4 rounded-12 bg-white/5 p-4 text-left transition-colors hover:bg-white/10'
					: 'flex w-full items-center gap-4 rounded-12 bg-white/5 p-4 text-left'
			}
		>
			{artwork}
			<div className='min-w-0 flex-1'>
				<div className='truncate text-[15px] font-medium text-white'>
					{bootDrive ? bootDrive.name : t('storage-manager.boot-storage')}
				</div>
				{/* The drive's own size, like every drive card, and the same size as its chip.
				    The usable capacity is in the stats below. */}
				<div className='truncate text-13 text-white/50'>
					{bootDrive ? `${formatStorageSize(bootDrive.size)} · ${bootDrive.serial}` : storageSizeLabel}
				</div>
			</div>
		</div>
	)

	return (
		<ImmersiveDialog
			open={true}
			onOpenChange={(isOpen) => {
				if (!isOpen) {
					navigate('/settings', {preventScrollReset: true})
				}
			}}
		>
			<DialogPortal>
				<ImmersiveDialogOverlay />
				<ImmersiveDialogContent
					aria-describedby={undefined}
					size='md'
					short
					showScroll
					style={{
						backgroundColor: 'rgba(8, 8, 8, 0.5)',
						backdropFilter: 'blur(80px)',
						boxShadow: '0px 32px 32px 0px #00000052, inset 1px 1px 1px 0px #FFFFFF14',
					}}
				>
					<div className='flex h-full flex-col gap-6'>
						<DialogTitle asChild className={immersiveDialogTitleClass}>
							<h1>{t('storage-manager')}</h1>
						</DialogTitle>

						{/* Mode - full width above the drive/stats columns */}
						<div className='flex flex-col gap-2.5'>
							<span className='text-13 font-semibold text-white/50'>{t('storage-manager.mode')}</span>
							<StorageModeDisplay
								value='storage'
								canEnableFailsafe
								// SSD copy only when we can actually see an SSD boot drive - SD-card and
								// USB boots (Pi) have no visible boot drive and get the generic wording
								copyVariant={bootDrive?.type === 'ssd' ? 'ssd' : 'drive'}
								failsafeUnavailableReason={failsafeUnavailableReason}
							/>
						</div>

						<div className='flex flex-col gap-6 pt-2 md:flex-1 md:flex-row md:items-stretch'>
							{/* Left: the drive */}
							<div className='flex min-w-0 flex-1 flex-col gap-6 md:justify-center'>
								<div className='flex flex-col gap-2.5'>
									<div className='flex flex-col gap-1'>
										<span className='text-13 font-semibold text-white/50'>{t('storage-manager.single-drive')}</span>
										<p className='text-13 leading-snug text-white/40'>
											{t('storage-manager.single-drive.description')}
										</p>
									</div>
									{driveCard}
								</div>

								<OtherDrives
									drives={otherDrives}
									description={otherDrivesDescription}
									onHealthClick={(device) => healthDialog.openDialog(device)}
								/>
								<UsbDrives />
							</div>

							{/* Right: donut chart and stats, aligned to the top of the drive column */}
							<div className='flex flex-col items-center gap-4 md:w-[240px] md:shrink-0 md:pt-6'>
								{diskUsageQ.isError ? (
									<StorageReadError
										onRetry={() => {
											void diskUsageQ.refetch()
										}}
										retrying={diskUsageQ.isFetching}
									/>
								) : (
									<>
										<StorageDonutChart
											used={usedBytes / 1e12}
											// The chart expects total usable capacity, not free space - the used
											// arc is drawn as a fraction of it
											available={totalBytes / 1e12}
											failsafe={0}
											wasted={0}
											usedBytes={usedBytes}
											isLoading={isLoading}
										/>
										<StorageStats
											isLoading={isLoading}
											totalCapacityBytes={totalBytes}
											availableBytes={freeBytes}
											failsafeOverheadBytes={0}
											wastedBytes={0}
											totalLabel={t('storage-manager.total-capacity')}
											availableLabel={t('storage-manager.free-space')}
										/>
									</>
								)}
								{diskUsageQ.isError && (
									<p className='text-center text-13 leading-snug text-white/50'>
										{t('storage-manager.usage-unavailable')}
									</p>
								)}
							</div>
						</div>
					</div>
				</ImmersiveDialogContent>
			</DialogPortal>

			{healthDialogDevice && (
				<SsdHealthDialog
					device={healthDialogDevice}
					open={healthDialog.open}
					onOpenChange={healthDialog.onOpenChange}
				/>
			)}
		</ImmersiveDialog>
	)
}
