import {useState} from 'react'
import {useTranslation} from 'react-i18next'

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
import {StorageDeviceCard} from '@/features/storage/components/storage-device-card'
import {Layout, primaryButtonProps, secondaryButtonClasss} from '@/layouts/bare/shared'
import {Progress} from '@/modules/bare/progress'
import {RaidError} from '@/routes/onboarding/raid/raid-error'
import {ReturnToStart} from '@/routes/onboarding/raid/return-to-start'

import {SsdHealthDialog, useSsdHealthDialog} from '../raid/ssd-health-dialog'
import {StorageDevice} from '../raid/use-raid-setup'
import {useRecoverExistingInstall} from '../raid/use-recover-existing-install'
import {ModalShell, StepHeader} from './components'

// HDD-flow variant of the Pro recovery screen: same backend flow and copy, rendered in
// the HDD onboarding's modal card with drive rows instead of the Pro SSD tray.
export function HddRecoverExistingInstall({
	devices,
	onSetUpAsNew,
}: {
	devices: StorageDevice[]
	onSetUpAsNew: () => void
}) {
	const {t} = useTranslation()
	const healthDialog = useSsdHealthDialog()
	const [showSetUpAsNewDialog, setShowSetUpAsNewDialog] = useState(false)
	const {
		handleRestore,
		restoreRequested,
		restoreFailed,
		errorMessage,
		outcomeUnknown,
		showWaitNotice,
		checkStatus,
		checking,
	} = useRecoverExistingInstall()

	const setUpAsNewDialog = (
		<AlertDialog open={showSetUpAsNewDialog} onOpenChange={setShowSetUpAsNewDialog}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t('onboarding.raid.recovery.set-up-new-dialog.title')}</AlertDialogTitle>
					<AlertDialogDescription>{t('onboarding.raid.recovery.set-up-new-dialog.description')}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction onClick={onSetUpAsNew}>
						{t('onboarding.raid.recovery.set-up-new-dialog.confirm')}
					</AlertDialogAction>
					<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)

	// Restore in progress: the device reboots and the hook redirects to `/` when it's back.
	// Same restoring cover as the SSD RAID recovery flow.
	if (restoreRequested && !restoreFailed) {
		return (
			<Layout
				title={t(
					outcomeUnknown ? 'onboarding.raid.recovery.confirming.title' : 'onboarding.raid.recovery.restoring.title',
				)}
				subTitle={t(
					outcomeUnknown ? 'onboarding.raid.recovery.outcome-unknown' : 'onboarding.raid.recovery.restoring.subtitle',
				)}
				subTitleMaxWidth={430}
				showLogo={false}
				footer={
					<div className='w-full max-w-sm'>
						<p className='text-center text-sm text-white/60'>
							{t(showWaitNotice ? 'onboarding.raid.wait-warning' : 'onboarding.raid.recovery.restoring.warning')}
						</p>
					</div>
				}
			>
				<div className='mt-4 w-full max-w-sm'>
					<Progress />
					{(outcomeUnknown || showWaitNotice) && (
						<div className='mt-5 flex flex-col items-center gap-3'>
							{showWaitNotice && (
								<p className='text-center text-13 leading-relaxed text-white/50'>
									{t('onboarding.raid.still-working')}
								</p>
							)}
							<button className={secondaryButtonClasss} onClick={() => void checkStatus()} disabled={checking}>
								{t('storage-status.check-again')}
							</button>
							{showWaitNotice && <ReturnToStart />}
						</div>
					)}
				</div>
			</Layout>
		)
	}

	if (restoreFailed) {
		return (
			<>
				<RaidError
					title={t('onboarding.raid.recovery.failed.title')}
					instructions={t('onboarding.raid.recovery.failed-help')}
					detail={errorMessage}
					onRetry={handleRestore}
					retryLabel={t('onboarding.raid.try-again')}
					secondaryAction={{
						label: t('onboarding.raid.recovery.set-up-new'),
						onClick: () => setShowSetUpAsNewDialog(true),
					}}
				/>
				{setUpAsNewDialog}
			</>
		)
	}

	return (
		<ModalShell
			footer={
				<>
					{/* Empty span keeps the justify-between footer's actions on the right */}
					<span />
					<div className='flex flex-wrap items-center gap-3'>
						<button onClick={() => setShowSetUpAsNewDialog(true)} className={secondaryButtonClasss}>
							{t('onboarding.raid.recovery.set-up-new')}
						</button>
						<button onClick={handleRestore} {...primaryButtonProps}>
							{t('onboarding.raid.recovery.restore')}
						</button>
					</div>
				</>
			}
		>
			<StepHeader
				title={t('onboarding.raid.recovery.found.title')}
				subTitle={t('onboarding.raid.recovery.found.subtitle-drive')}
			/>

			<span className='text-13 font-medium text-white/50'>{t('storage-status.connected-drives')}</span>
			{/* Detected drives */}
			<div className='grid gap-3 md:grid-cols-2'>
				{devices.map((device) => (
					<StorageDeviceCard
						key={device.id ?? device.device}
						device={device}
						onDetails={() => healthDialog.openDialog(device)}
					/>
				))}
			</div>

			{healthDialog.selectedDevice && (
				<SsdHealthDialog
					device={healthDialog.selectedDevice.device}
					open={healthDialog.open}
					onOpenChange={healthDialog.onOpenChange}
				/>
			)}
			{setUpAsNewDialog}
		</ModalShell>
	)
}
