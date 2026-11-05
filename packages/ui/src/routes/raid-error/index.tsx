import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {Navigate} from 'react-router-dom'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {Button} from '@/components/ui/button'
import {toast} from '@/components/ui/toast'
import {StorageDeviceCard} from '@/features/storage/components/storage-device-card'
import {StorageHeader, StorageNotice, StoragePage, StorageReadError} from '@/features/storage/components/storage-page'
import {deviceInfoToHostEnvironment} from '@/hooks/use-device-info'
import {OnboardingPage} from '@/layouts/bare/onboarding-page'
import {primaryButtonProps, secondaryButtonClasss} from '@/layouts/bare/shared'
import {useGlobalSystemState} from '@/providers/global-system-state'
import {SsdHealthDialog, useSsdHealthDialog} from '@/routes/onboarding/raid/ssd-health-dialog'
import {SsdSlot, SsdTray} from '@/routes/onboarding/raid/ssd-tray'
import {formatSize, getDeviceHealth} from '@/routes/onboarding/raid/use-raid-setup'
import {LanguageDropdown} from '@/routes/settings/_components/language-dropdown'
import {trpcReact} from '@/trpc/trpc'

export default function RaidErrorScreen() {
	const {t} = useTranslation()
	const [showShutdownDialog, setShowShutdownDialog] = useState(false)
	const [showFactoryResetDialog, setShowFactoryResetDialog] = useState(false)
	const mountFailureQ = trpcReact.hardware.raid.checkRaidMountFailure.useQuery(undefined, {retry: false})
	const raidDevicesQ = trpcReact.hardware.raid.checkRaidMountFailureDevices.useQuery(undefined, {
		enabled: mountFailureQ.data === true,
		retry: false,
	})
	const devicesQ = trpcReact.hardware.internalStorage.getDevices.useQuery(undefined, {
		enabled: mountFailureQ.data === true,
		retry: false,
	})
	const identityQ = trpcReact.systemNg.device.getIdentity.useQuery(undefined, {
		enabled: mountFailureQ.data === true,
		retry: false,
	})
	const isUmbrelPro = deviceInfoToHostEnvironment(identityQ.data) === 'umbrel-pro'
	const healthDialog = useSsdHealthDialog()
	const {restart, shutdown, isPowerActionPending} = useGlobalSystemState()
	const factoryResetMut = trpcReact.system.factoryReset.useMutation({
		onError: (error) => {
			toast.error(t('raid-error.factory-reset-failed'), {area: 'umbrelos', description: error.message})
		},
	})
	const busy = isPowerActionPending || factoryResetMut.isPending
	const refreshing = mountFailureQ.isFetching || raidDevicesQ.isFetching || devicesQ.isFetching || identityQ.isFetching
	const retry = () => {
		void mountFailureQ.refetch()
		if (mountFailureQ.data === true) {
			void raidDevicesQ.refetch()
			void devicesQ.refetch()
			void identityQ.refetch()
		}
	}
	if (mountFailureQ.data === false && !mountFailureQ.isError) return <Navigate to='/' replace />

	const members = raidDevicesQ.data ?? []
	const memberIds = new Set(members.map((member) => member.name))
	const detected = (devicesQ.data ?? []).filter(
		(device) => !device.isSystemDrive || (device.id && memberIds.has(device.id)),
	)
	const rows = [
		...members.map((member) => ({
			id: member.name,
			member,
			device: detected.find((device) => device.id === member.name),
		})),
		...detected
			.filter((device) => !device.id || !memberIds.has(device.id))
			.map((device) => ({id: device.id ?? device.device, device, member: undefined})),
	]
	const loading = mountFailureQ.isLoading || devicesQ.isLoading || raidDevicesQ.isLoading
	const checkError = mountFailureQ.error ?? devicesQ.error ?? raidDevicesQ.error ?? identityQ.error
	// Slots are only an illustration. The list above preserves every configured and
	// detected drive, including missing members and Pro devices without a known slot.
	const traySlots: (SsdSlot | null)[] = [1, 2, 3, 4].map((slot) => {
		const device = detected.find((device) => device.slot === slot)
		if (!device) return null
		return {
			size: formatSize(device.size),
			hasWarning:
				getDeviceHealth(device).hasWarning ||
				members.some((member) => member.name === device.id && member.isOk === false),
		}
	})

	const header = (
		<StorageHeader
			title={t(mountFailureQ.isError ? 'storage-status.unavailable-title' : 'raid-error.title')}
			subTitle={mountFailureQ.data === true ? t('raid-error.description') : undefined}
		/>
	)

	return (
		<OnboardingPage>
			<StoragePage
				footer={
					<>
						<div className='flex flex-wrap gap-3'>
							<button {...primaryButtonProps} onClick={retry} disabled={refreshing || busy}>
								{t('storage-status.check-again')}
							</button>
							{mountFailureQ.data === true && (
								<>
									<button className={secondaryButtonClasss} onClick={() => restart()} disabled={busy}>
										{t('restart')}
									</button>
									<button className={secondaryButtonClasss} onClick={() => setShowShutdownDialog(true)} disabled={busy}>
										{t('shut-down')}
									</button>
								</>
							)}
						</div>
						<LanguageDropdown />
					</>
				}
			>
				{loading ? (
					<>
						{header}
						<div className='min-h-40' aria-busy='true' aria-label={t('loading')} />
					</>
				) : (
					<>
						<div className='flex min-w-0 flex-col gap-6 md:flex-row'>
							<div className='flex min-w-0 flex-1 flex-col gap-3'>
								<div className='mb-2'>{header}</div>
								{checkError && <StorageReadError detail={checkError.message} />}
								{rows.map(({id, member, device}) => (
									<StorageDeviceCard
										key={id}
										device={device}
										fallbackType={isUmbrelPro ? 'ssd' : undefined}
										identifier={id}
										role={member ? t('storage-status.data-drive') : undefined}
										status={
											!device
												? t(devicesQ.isError ? 'storage-status.unknown' : 'storage-status.not-detected')
												: member
													? raidDevicesQ.isError
														? t('storage-status.unknown')
														: member.isOk === false
															? t('storage-status.pool-unavailable')
															: t('storage-status.detected')
													: t('storage-status.connected')
										}
										onDetails={
											device ? () => healthDialog.openDialog(device, isUmbrelPro ? device.slot : undefined) : undefined
										}
									/>
								))}
								{!checkError && rows.length === 0 && (
									<StorageNotice tone='neutral'>{t('storage-status.no-drives')}</StorageNotice>
								)}
								{mountFailureQ.data === true && (
									<p className='text-13 leading-relaxed text-white/50'>{t('raid-error.connection-help')}</p>
								)}
								{mountFailureQ.data === true && (
									<details className='mt-4 text-13 text-white/40'>
										<summary className='w-fit cursor-pointer transition-colors hover:text-white/70'>
											{t('raid-error.reset-options')}
										</summary>
										<div className='mt-3 flex flex-col items-start gap-3'>
											<p className='max-w-[600px] leading-relaxed'>{t('raid-error.reset-help')}</p>
											<Button size='sm' onClick={() => setShowFactoryResetDialog(true)} disabled={busy}>
												{t('factory-reset')}
											</Button>
										</div>
									</details>
								)}
							</div>
							{/* The photo's trailing shadow should not add empty scroll space. */}
							{isUmbrelPro && (
								<div
									className='hidden aspect-[511/560] w-[50%] shrink-0 self-start overflow-hidden md:-mr-12 md:block'
									style={{maskImage: 'linear-gradient(to bottom, black 97%, transparent 100%)'}}
								>
									<SsdTray
										slots={traySlots}
										onHealthClick={(index) => {
											const device = detected.find((device) => device.slot === index + 1)
											if (device) healthDialog.openDialog(device, device.slot)
										}}
									/>
								</div>
							)}
						</div>
					</>
				)}
			</StoragePage>
			{healthDialog.selectedDevice && (
				<SsdHealthDialog
					device={healthDialog.selectedDevice.device}
					slotNumber={healthDialog.selectedDevice.slotNumber}
					open={healthDialog.open}
					onOpenChange={healthDialog.onOpenChange}
				/>
			)}
			{/* Shutdown confirmation dialog */}
			<AlertDialog open={showShutdownDialog} onOpenChange={setShowShutdownDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('raid-error.shutdown-dialog.title')}</AlertDialogTitle>
						<AlertDialogDescription>{t('raid-error.shutdown-dialog.description')}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction
							variant='destructive'
							onClick={(e) => {
								e.preventDefault()
								shutdown()
							}}
							disabled={busy}
						>
							{t('shut-down')}
						</AlertDialogAction>
						<AlertDialogCancel disabled={busy}>{t('cancel')}</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Factory reset confirmation dialog */}
			<AlertDialog open={showFactoryResetDialog} onOpenChange={setShowFactoryResetDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('raid-error.factory-reset-dialog.title')}</AlertDialogTitle>
						<AlertDialogDescription>{t('raid-error.factory-reset-dialog.description')}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction
							variant='destructive'
							onClick={(e) => {
								e.preventDefault()
								factoryResetMut.mutate({})
							}}
							disabled={busy}
						>
							{t('factory-reset')}
						</AlertDialogAction>
						<AlertDialogCancel disabled={busy}>{t('cancel')}</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</OnboardingPage>
	)
}
