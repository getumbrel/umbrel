import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogScrollableContent,
	DialogTitle,
} from '@/components/ui/dialog'
import {useActiveRaidOperation} from '@/features/storage/hooks/use-active-raid-operation'

import {OperationInProgressBanner} from './operation-in-progress-banner'
import {ProInstallInstructions} from './pro-install-instructions'
import {ShutdownConfirmationDialog} from './shutdown-confirmation-dialog'

type InstallSsdDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	isUmbrelPro: boolean
	/** Use generic drive wording instead of SSD (list-based manager on HDD pools) */
	isHdd?: boolean
}

export function InstallSsdDialog({open, onOpenChange, isUmbrelPro, isHdd = false}: InstallSsdDialogProps) {
	const {t} = useTranslation()
	const [showShutdownConfirmation, setShowShutdownConfirmation] = useState(false)

	// Check if a RAID operation is already in progress
	const activeOperation = useActiveRaidOperation()
	const isOperationInProgress = !!activeOperation
	// Most operations pick up where they left off after a restart. A FailSafe transition
	// can't until its data has finished copying, so shutting down would abandon it.
	const mustWaitToShutDown = activeOperation?.type === 'failsafe-transition' && activeOperation.state === 'syncing'

	// Reset state when dialog closes
	useEffect(() => {
		if (!open) {
			setShowShutdownConfirmation(false)
		}
	}, [open])

	// dv('storage-manager.install-ssd.foo') resolves to '...foo-drive' for HDD pools
	const dv = (key: string) => t(isHdd ? `${key}-drive` : key)

	// Power off before changing internal drives; hot-swap support is not reported.
	const steps = [
		t('storage-manager.install-ssd.step-shut-down', {deviceName: t('storage-manager.device')}),
		dv('storage-manager.install-ssd.step-insert'),
		t('storage-manager.install-ssd.step-power-on', {deviceName: t('storage-manager.device')}),
		dv('storage-manager.install-ssd.step-return'),
	]

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogScrollableContent>
					<div className='flex flex-col gap-5 p-5'>
						<DialogHeader>
							<DialogTitle>{dv('storage-manager.install-ssd.title')}</DialogTitle>
							<DialogDescription>{dv('storage-manager.install-ssd.description')}</DialogDescription>
						</DialogHeader>

						{isUmbrelPro ? (
							<ProInstallInstructions
								paragraphs={[
									t('storage-manager.install-ssd.pro-instructions-1'),
									t('storage-manager.install-ssd.pro-instructions-2'),
								]}
							/>
						) : (
							<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
								{steps.map((step, index) => (
									<div key={index} className='flex items-center gap-3 p-3 text-12 font-medium -tracking-3'>
										<span className='flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold'>
											{index + 1}
										</span>
										<span>{step}</span>
									</div>
								))}
							</div>
						)}

						{isOperationInProgress && (
							<OperationInProgressBanner variant={mustWaitToShutDown ? 'wait' : 'shutdown-safe'} />
						)}

						<DialogFooter>
							<Button
								variant='primary'
								size='dialog'
								disabled={mustWaitToShutDown}
								onClick={() => setShowShutdownConfirmation(true)}
							>
								{t('shut-down')}
							</Button>
							<Button variant='default' size='dialog' onClick={() => onOpenChange(false)}>
								{t('cancel')}
							</Button>
						</DialogFooter>
					</div>
				</DialogScrollableContent>
			</Dialog>

			<ShutdownConfirmationDialog open={showShutdownConfirmation} onOpenChange={setShowShutdownConfirmation} />
		</>
	)
}
