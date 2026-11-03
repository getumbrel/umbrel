import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {DialogPortal, DialogTitle} from '@/components/ui/dialog'
import {
	ImmersiveDialog,
	ImmersiveDialogContent,
	ImmersiveDialogOverlay,
	immersiveDialogTitleClass,
} from '@/components/ui/immersive-dialog'
import {primaryButtonProps} from '@/layouts/bare/shared'

import {raidStatusLabels, type RaidStatus, type StorageDevice} from '../hooks/use-storage'
import {SsdHealthDialog, useSsdHealthDialog} from './dialogs/ssd-health-dialog'
import {PoolDataErrorBanner} from './pool-data-error-banner'
import {StorageDeviceCard} from './storage-device-card'
import {StorageNotice, StorageReadError} from './storage-page'
import {UsbDrives} from './usb-drives'

// A failed read or an unidentifiable/unavailable pool has no reliable capacity or
// add/swap plan. Keep its members visible without guessing a media-specific layout.
export function StorageUnavailable({
	loading,
	error,
	pool,
	devices = [],
	fallbackType,
	onRetry,
	retrying,
}: {
	loading?: boolean
	error?: {message: string} | null
	pool?: RaidStatus
	devices?: StorageDevice[]
	fallbackType?: StorageDevice['type']
	onRetry: () => void
	retrying: boolean
}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const health = useSsdHealthDialog()
	const selectedDevice = devices.find((device) => device.id === health.selectedDevice?.deviceId)
	const members: {id: string; status?: NonNullable<RaidStatus['devices']>[number]['status']}[] = [
		...(pool?.devices ?? []),
		...(pool?.accelerator?.devices ?? []),
	]
	const acceleratorIds = new Set(pool?.accelerator?.devices?.map((member) => member.id) ?? [])
	const liveMember = [...(pool?.devices ?? []), ...(pool?.accelerator?.devices ?? [])].find(
		(member) => member.id === selectedDevice?.id,
	)
	const memberIds = new Set(members.map((member) => member.id))
	const rows = [
		...members.map((member) => ({id: member.id, member, device: devices.find((device) => device.id === member.id)})),
		...devices
			.filter((device) => !device.id || !memberIds.has(device.id))
			.map((device) => ({id: device.id ?? device.device, member: undefined, device})),
	]
	return (
		<ImmersiveDialog
			open
			onOpenChange={(open) => {
				if (!open) navigate('/settings', {preventScrollReset: true})
			}}
		>
			<DialogPortal>
				<ImmersiveDialogOverlay />
				<ImmersiveDialogContent
					size='md'
					showScroll
					aria-describedby={undefined}
					style={{
						backgroundColor: 'rgba(8, 8, 8, 0.5)',
						backdropFilter: 'blur(80px)',
						boxShadow: '0px 32px 32px 0px #00000052, inset 1px 1px 1px 0px #FFFFFF14',
					}}
				>
					<div className='flex min-h-[300px] flex-col gap-6'>
						<DialogTitle asChild className={immersiveDialogTitleClass}>
							<h1>{t('storage-manager')}</h1>
						</DialogTitle>
						{loading ? (
							<div className='h-56' aria-busy='true' aria-label={t('loading')} />
						) : error ? (
							<StorageReadError onRetry={onRetry} retrying={retrying} detail={error.message} />
						) : (
							<>
								<StorageNotice tone='danger'>{t('storage-status.pool-help')}</StorageNotice>
								<PoolDataErrorBanner errorCount={pool?.dataErrors} />
								<div className='flex min-w-0 flex-col gap-3'>
									{rows.map(({id, member, device}) => (
										<StorageDeviceCard
											key={id}
											device={device}
											fallbackType={fallbackType}
											identifier={id}
											role={
												member
													? t(acceleratorIds.has(id) ? 'storage-status.accelerator' : 'storage-status.data-drive')
													: undefined
											}
											status={
												!device
													? t('storage-status.not-detected')
													: member
														? member.status
															? t(raidStatusLabels[member.status])
															: t('storage-status.unknown')
														: device.isSystemDrive
															? t('storage-manager.system-drive')
															: t('storage-status.connected')
											}
											onDetails={device ? () => health.openDialog(device, device.slot) : undefined}
										/>
									))}
								</div>
								<button
									{...primaryButtonProps}
									className={`${primaryButtonProps.className} self-start`}
									onClick={onRetry}
									disabled={retrying}
								>
									{t('storage-status.check-again')}
								</button>
								<UsbDrives />
							</>
						)}
					</div>
				</ImmersiveDialogContent>
			</DialogPortal>
			{selectedDevice && (
				<SsdHealthDialog
					device={selectedDevice}
					raidDevice={
						liveMember
							? {
									...selectedDevice,
									raidStatus: liveMember.status,
									readErrors: liveMember.readErrors,
									writeErrors: liveMember.writeErrors,
									checksumErrors: liveMember.checksumErrors,
								}
							: undefined
					}
					slotNumber={health.selectedDevice?.slotNumber}
					open={health.open}
					onOpenChange={health.onOpenChange}
				/>
			)}
		</ImmersiveDialog>
	)
}
