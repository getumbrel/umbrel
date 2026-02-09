import {useEffect, useState} from 'react'

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
import {t} from '@/utils/i18n'

import {InstallTipsCollapsible} from './install-tips-collapsible'
import {OperationInProgressBanner} from './operation-in-progress-banner'
import {ShutdownConfirmationDialog} from './shutdown-confirmation-dialog'

type InstallSsdDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	isUmbrelPro: boolean
}

export function InstallSsdDialog({open, onOpenChange, isUmbrelPro}: InstallSsdDialogProps) {
	const [showInstallTips, setShowInstallTips] = useState(false)
	const [showShutdownConfirmation, setShowShutdownConfirmation] = useState(false)

	// Check if a RAID operation is already in progress
	const activeOperation = useActiveRaidOperation()
	const isOperationInProgress = !!activeOperation

	// Reset state when dialog closes
	useEffect(() => {
		if (!open) {
			setShowShutdownConfirmation(false)
			setShowInstallTips(false)
		}
	}, [open])

	const deviceName = isUmbrelPro ? 'Umbrel Pro' : 'device'
	const steps = [
		t('storage-manager.install-ssd.step-shut-down', {deviceName}),
		...(isUmbrelPro ? [t('storage-manager.install-ssd.step-remove-bottom-cover')] : []),
		t('storage-manager.install-ssd.step-insert'),
		...(isUmbrelPro ? [t('storage-manager.install-ssd.step-replace-bottom-cover')] : []),
		t('storage-manager.install-ssd.step-power-on', {deviceName}),
		t('storage-manager.install-ssd.step-return'),
	]

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogScrollableContent>
					<div className='flex flex-col gap-5 p-5'>
						<DialogHeader>
							<DialogTitle>{t('storage-manager.install-ssd.title')}</DialogTitle>
							<DialogDescription>{t('storage-manager.install-ssd.description')}</DialogDescription>
						</DialogHeader>

						{/* Instruction steps */}
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

						{/* Collapsible installation tips - Umbrel Pro only */}
						{isUmbrelPro && (
							<InstallTipsCollapsible isOpen={showInstallTips} onToggle={() => setShowInstallTips(!showInstallTips)} />
						)}

						{isOperationInProgress && <OperationInProgressBanner variant='shutdown-safe' />}

						<DialogFooter>
							<Button variant='destructive' onClick={() => setShowShutdownConfirmation(true)}>
								{t('shut-down')}
							</Button>
							<Button variant='default' onClick={() => onOpenChange(false)}>
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
