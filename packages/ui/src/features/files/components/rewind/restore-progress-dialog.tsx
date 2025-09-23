import {AlertOctagon, CheckCircle2} from 'lucide-react'

import {Alert, ErrorAlert, WarningAlert} from '@/components/ui/alert'
import {RewindIcon} from '@/features/files/assets/rewind-icon'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {OperationsInProgress, useGlobalFiles} from '@/providers/global-files'
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/shadcn-components/ui/dialog'
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {t} from '@/utils/i18n'
import {formatNumberI18n} from '@/utils/number'
import {secondsToEta} from '@/utils/seconds-to-eta'

export function RestoreProgressDialog({open, phase}: {open: boolean; phase: 'idle' | 'running' | 'success' | 'error'}) {
	const {operations} = useGlobalFiles()

	// Filter restore operations (copies from /Backups/), and sort them so that items with higher progress appear first
	const restoreOperations = [...operations]
		.filter((op) => op.file.path.startsWith('/Backups/') && op.type === 'copy')
		.sort((a, b) => {
			// Treat missing values as 0
			return (b.percent ?? 0) - (a.percent ?? 0)
		})

	return (
		<Dialog open={open} onOpenChange={() => {}}>
			<DialogContent className='flex flex-col'>
				<div>
					<div className='flex flex-col items-center space-y-2 text-center'>
						<RewindIcon className='size-20' />
						<DialogTitle className='text-center leading-none'>
							{phase === 'success' || phase === 'idle'
								? t('rewind.restore-complete')
								: phase === 'error'
									? t('rewind.restore-failed')
									: phase === 'running' && (
											<span className='inline-flex items-center'>
												{t('rewind.restoring')}
												<span className='ml-0'>
													<span className='animate-pulse [animation-delay:0ms] [animation-duration:1.4s]'>.</span>
													<span className='animate-pulse [animation-duration:1.4s] [animation-delay:200ms]'>.</span>
													<span className='animate-pulse [animation-duration:1.4s] [animation-delay:400ms]'>.</span>
												</span>
											</span>
										)}
						</DialogTitle>
					</div>
					<DialogDescription>
						{phase === 'success' || phase === 'idle' ? (
							<Alert variant='success' className='mt-4 rounded-lg py-[0.85rem]' icon={CheckCircle2}>
								{t('rewind.restore-success-description')}
							</Alert>
						) : phase === 'error' ? (
							<ErrorAlert icon={AlertOctagon} description={t('rewind.restore-error-description')} />
						) : null}
					</DialogDescription>
				</div>
				<div>
					{phase === 'running' &&
						(() => {
							const count = operations.length
							if (count > 0) {
								let totalPercent = 0
								let totalSpeed = 0
								for (const op of operations) {
									if (typeof op.percent === 'number') totalPercent += op.percent
									if (typeof op.bytesPerSecond === 'number') totalSpeed += op.bytesPerSecond
								}
								const progress = Math.round(totalPercent / count)
								return (
									<RestoringItems operations={restoreOperations} progress={progress} count={count} speed={totalSpeed} />
								)
							}
							return null
						})()}
					{phase === 'running' && (
						<WarningAlert icon={AlertOctagon} description={t('rewind.restore-running-description')} />
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}

function RestoringItems({
	progress,
	count,
	speed,
	operations,
}: {
	progress: number
	count: number
	speed: number
	operations: OperationsInProgress
}) {
	return (
		<div className='flex h-full w-full flex-col overflow-hidden py-3'>
			<div className='mb-4 flex items-center justify-between'>
				<span className='text-xs text-white/60'>
					{t('files-listing.item-count', {formattedCount: formatNumberI18n({n: count, showDecimals: false}), count})}{' '}
					&bull; {progress}%
				</span>
				<span className='text-xs text-white/60'>{formatFilesystemSize(speed)}/s</span>
			</div>

			<ScrollArea className='flex-1 pb-2'>
				<div className='max-h-[200px]  space-y-3'>
					{operations.map((operation) => {
						const parts = operation.destinationPath.split('/')
						const destinationFolderName = parts.length >= 2 ? parts[parts.length - 2] : parts[0]

						return (
							<div
								key={`${operation.file.path}-${operation.destinationPath}-${operation.type}`}
								className='flex items-center gap-2'
							>
								<div className='flex-shrink-0'>
									<FileItemIcon item={operation.file} className='h-7 w-7' />
								</div>
								<div className='min-w-0 flex-1'>
									<div className='mb-1 flex items-center justify-between gap-2'>
										<span className='block max-w-[16rem] whitespace-nowrap text-xs text-white/90'>
											<span className='text-white/60'>
												{t('files-operations-island.restoring', {
													from: formatItemName({name: operation.file.name, maxLength: 12}),
													to: formatItemName({name: destinationFolderName, maxLength: 12}),
												})}
											</span>
										</span>
										<span className='flex-shrink-0 text-right text-xs text-white/60'>
											{secondsToEta(operation.secondsRemaining)}
										</span>
									</div>
									<div className='relative h-1 overflow-hidden rounded-full bg-white/20'>
										<div
											className='transition-w absolute left-0 top-0 h-full rounded-full bg-brand duration-300'
											style={{width: `${operation.percent}%`}}
										/>
									</div>
								</div>
							</div>
						)
					})}
				</div>
			</ScrollArea>
		</div>
	)
}
