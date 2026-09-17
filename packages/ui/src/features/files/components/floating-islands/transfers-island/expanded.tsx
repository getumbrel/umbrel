import type {TFunction} from 'i18next'
import {AnimatePresence, motion, MotionConfig, type Transition} from 'motion/react'
import type {ReactNode} from 'react'
import {useTranslation} from 'react-i18next'
import {RiCheckLine, RiCloseLine} from 'react-icons/ri'

import {ScrollArea} from '@/components/ui/scroll-area'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {UPLOAD_NETWORK_ERROR} from '@/features/files/transfers/executors'
import {transfers} from '@/features/files/transfers/transfers'
import type {TransferItem} from '@/features/files/transfers/types'
import type {TransferBatchView, TransfersView} from '@/features/files/transfers/use-transfers'
import type {FileSystemItem} from '@/features/files/types'
import {getFilesErrorMessage} from '@/features/files/utils/error-messages'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {cn} from '@/lib/utils'
import {useConfirmation} from '@/providers/confirmation'
import {secondsToEta} from '@/utils/seconds-to-eta'

// Motion. One small vocabulary throughout: things arrive with ease-out and
// leave a touch faster. A row or section that goes gives up its space as it
// fades, so what is below follows it up in one movement instead of sliding
// over a ghost; a row that comes opens its space first, then fills it. The
// fade always finishes before the space is gone, so nothing is ever clipped.
const EASE_OUT: Transition['ease'] = [0.22, 1, 0.36, 1]
const EASE_IN_OUT: Transition['ease'] = [0.645, 0.045, 0.355, 1]
const ROW_HEIGHT = 28
const rowArrive: Transition = {
	height: {duration: 0.22, ease: EASE_OUT},
	opacity: {duration: 0.15, ease: EASE_OUT, delay: 0.06},
}
const rowLeave: Transition = {
	height: {duration: 0.2, ease: EASE_OUT},
	opacity: {duration: 0.1, ease: EASE_OUT},
}
const sectionArrive: Transition = {
	height: {duration: 0.25, ease: EASE_OUT},
	opacity: {duration: 0.2, ease: EASE_OUT, delay: 0.05},
}
const sectionLeave: Transition = {
	height: {duration: 0.22, ease: EASE_OUT},
	opacity: {duration: 0.12, ease: EASE_OUT},
}

export function ExpandedContent({
	view,
	onDialogPending,
}: {
	view: TransfersView
	onDialogPending: (pending: boolean) => void
}) {
	const {t} = useTranslation()
	const confirmCancel = useCancelConfirmation(onDialogPending)

	// The island names what it holds; a mix is simply "Transfers"
	const title =
		view.kind === 'upload'
			? t('files-transfers.title')
			: view.kind === 'copy'
				? t('files-transfers.title-copying')
				: view.kind === 'move'
					? t('files-transfers.title-moving')
					: t('files-transfers.title-transfers')

	return (
		<MotionConfig reducedMotion='user'>
			<div className='flex h-full w-full flex-col overflow-hidden py-4'>
				<div className='mb-3 flex items-center justify-between px-5'>
					<Swap id={view.kind} className='text-sm text-white/90'>
						{title}
					</Swap>
					<Fade show={view.cancellable}>
						<TextButton onClick={() => confirmCancel('all', view.kind, () => transfers.cancelAll())}>
							{t('files-transfers.cancel-all')}
						</TextButton>
					</Fade>
				</div>
				<ScrollArea className='flex-1 px-5 pb-1'>
					<div className='flex flex-col'>
						<AnimatePresence initial={false}>
							{view.batches.map((batch) => (
								<motion.section
									key={batch.id}
									className='overflow-hidden'
									initial={{height: 0, opacity: 0}}
									animate={{height: 'auto', opacity: 1, transition: sectionArrive}}
									exit={{height: 0, opacity: 0, transition: sectionLeave}}
								>
									{/* Spacing lives inside so it collapses with the section */}
									<div className='pb-3'>
										<BatchSection
											batch={batch}
											onCancel={() => confirmCancel('batch', batch.kind, () => transfers.cancelBatch(batch.id))}
										/>
									</div>
								</motion.section>
							))}
						</AnimatePresence>
					</div>
				</ScrollArea>
			</div>
		</MotionConfig>
	)
}

// Cancelling one item is immediate; cancelling a batch asks once, in the
// batch's own words. Nothing is destroyed either way, only time: finished
// items stay.
function useCancelConfirmation(onDialogPending: (pending: boolean) => void) {
	const {t} = useTranslation()
	const confirm = useConfirmation()
	return async (scope: 'batch' | 'all', kind: TransfersView['kind'], run: () => void) => {
		let title: string
		let message: string
		let keep: string
		let cancel: string
		switch (kind) {
			case 'upload':
				title = scope === 'all' ? t('files-transfers.cancel-all-title') : t('files-transfers.cancel-batch-title')
				message = t('files-transfers.cancel-confirm-message')
				keep = t('files-transfers.keep-uploading')
				cancel = t('files-transfers.cancel-uploads')
				break
			case 'copy':
				title =
					scope === 'all' ? t('files-transfers.cancel-all-title-copy') : t('files-transfers.cancel-batch-title-copy')
				message = t('files-transfers.cancel-confirm-message-copy')
				keep = t('files-transfers.keep-copying')
				cancel = t('files-transfers.cancel-copy')
				break
			case 'move':
				title =
					scope === 'all' ? t('files-transfers.cancel-all-title-move') : t('files-transfers.cancel-batch-title-move')
				message = t('files-transfers.cancel-confirm-message-move')
				keep = t('files-transfers.keep-moving')
				cancel = t('files-transfers.cancel-move')
				break
			default:
				title = t('files-transfers.cancel-all-title-transfers')
				message = t('files-transfers.cancel-confirm-message-transfers')
				keep = t('files-transfers.keep-transferring')
				cancel = t('files-transfers.cancel-transfers')
		}
		onDialogPending(true)
		try {
			// The dialog treats an action valued "cancel" as a dismissal, so the
			// destructive choice carries its own value. Keeping going is the safe,
			// secondary option; stopping is the destructive one.
			const result = await confirm({
				title,
				message,
				actions: [
					{label: keep, value: 'keep', variant: 'default'},
					{label: cancel, value: 'stop', variant: 'destructive'},
				],
			})
			if (result.actionValue === 'stop') run()
		} catch {
			// Dismissed: keep going
		} finally {
			onDialogPending(false)
		}
	}
}

function BatchSection({batch, onCancel}: {batch: TransferBatchView; onCancel: () => void}) {
	const {t} = useTranslation()
	const {counts} = batch
	const to = batch.destinationName

	const title =
		batch.kind === 'upload'
			? t('files-transfers.uploading-to', {to})
			: batch.kind === 'copy'
				? t('files-transfers.copying-to', {to})
				: t('files-transfers.moving-to', {to})

	// Counts tick too often to animate; the line only swaps when the batch
	// changes state, e.g. lands or fails
	const summary = [t('files-transfers.progress-count', {done: counts.completed, total: counts.total})]
	if (batch.kind === 'upload' && batch.totalBytes > 0) {
		summary.push(`${formatFilesystemSize(batch.transferredBytes)} / ${formatFilesystemSize(batch.totalBytes)}`)
	}
	if (counts.failed > 0) summary.push(t('files-transfers.failed-count', {count: counts.failed}))
	if (counts.skipped > 0) summary.push(t('files-transfers.skipped-count', {count: counts.skipped}))

	let pace: string | undefined
	if (counts.running > 0) {
		if (batch.bytesPerSecond > 0) {
			pace = `${formatFilesystemSize(batch.bytesPerSecond)}/s`
			if (batch.secondsRemaining !== undefined && batch.secondsRemaining > 0) {
				pace += ` · ${t('files-operations-island.time-remaining', {time: secondsToEta(batch.secondsRemaining)})}`
			}
		} else if (batch.kind !== 'upload' && batch.progress === 0) {
			pace = t('files-operations-island.preparing')
		}
	}

	return (
		<div>
			<div className='flex items-center justify-between gap-3'>
				<span className='min-w-0 truncate text-xs text-white/90' title={title}>
					{title}
				</span>
				<div className='flex shrink-0 items-center gap-2'>
					<Fade show={batch.status === 'failed'}>
						<TextButton onClick={() => transfers.retryFailed(batch.id)}>{t('files-transfers.retry-failed')}</TextButton>
						<TextButton onClick={() => transfers.dismissBatch(batch.id)}>{t('files-transfers.dismiss')}</TextButton>
					</Fade>
					<Fade show={batch.cancellable}>
						<TextButton onClick={onCancel}>{t('cancel')}</TextButton>
					</Fade>
				</div>
			</div>
			<div className='mt-0.5 flex items-center justify-between gap-3 text-[11px] text-white/50'>
				<Swap id={batch.status} className='min-w-0 truncate'>
					{batch.status === 'done' ? (
						<span className='inline-flex items-center gap-1'>
							<LandedCheck />
							{t('files-transfers.done')}
						</span>
					) : (
						summary.join(' · ')
					)}
				</Swap>
				<Fade show={pace !== undefined}>
					<span className='shrink-0 whitespace-nowrap'>{pace}</span>
				</Fade>
			</div>
			<div className='mt-1.5 h-1 overflow-hidden rounded-full bg-white/15'>
				{/* Progress is a clock, so it moves linearly between readings */}
				<div
					className={cn(
						'h-full rounded-full transition-[width] duration-[250ms] ease-linear',
						batch.status === 'failed' ? 'bg-white/40' : 'bg-brand',
					)}
					style={{width: `${batch.progress}%`}}
				/>
			</div>
			<div className='mt-2 flex flex-col'>
				<AnimatePresence initial={false}>
					{batch.rows.map((item) => (
						<motion.div
							key={item.id}
							className='overflow-hidden'
							initial={{height: 0, opacity: 0}}
							animate={{height: ROW_HEIGHT, opacity: 1, transition: rowArrive}}
							exit={{height: 0, opacity: 0, transition: rowLeave}}
						>
							<Row item={item} />
						</motion.div>
					))}
				</AnimatePresence>
				<Fade show={batch.hiddenCount > 0}>
					<div className='h-[18px] text-[11px] leading-[18px] text-white/40'>
						{t('files-transfers.more-count', {count: batch.hiddenCount})}
					</div>
				</Fade>
			</div>
		</div>
	)
}

function Row({item}: {item: TransferItem}) {
	const {t} = useTranslation()
	const iconItem: FileSystemItem = {
		name: item.name,
		path: item.path,
		type: item.type,
		modified: 0,
		operations: [],
		thumbnail: item.kind === 'upload' ? transfers.thumbnailUrl(item.id) : undefined,
	}

	// The status column swaps between phases; figures within a phase update in place
	let status: ReactNode
	let action: ReactNode
	switch (item.state) {
		case 'queued':
			status = t('files-transfers.queued')
			break
		case 'running':
			if (item.kind === 'upload') {
				status = `${formatFilesystemSize(item.transferredBytes)} / ${formatFilesystemSize(item.size ?? 0)}`
			} else {
				status = item.progress > 0 ? `${Math.round(item.progress)}%` : t('files-operations-island.preparing')
			}
			break
		case 'finishing':
			status = t('files-transfers.finishing')
			break
		case 'cancelling':
			status = t('files-transfers.cancelling')
			break
		case 'completed':
			status = (
				<span className='inline-flex items-center gap-1'>
					<LandedCheck />
					{t('files-transfers.done')}
				</span>
			)
			break
		case 'needs-attention':
			status = t('files-transfers.needs-attention')
			action = <TextButton onClick={() => transfers.reopenConflict(item.id)}>{t('files-transfers.resolve')}</TextButton>
			break
		case 'failed': {
			const message = errorText(item, t)
			status = (
				<span className='text-white/70' title={message}>
					{message}
				</span>
			)
			action = <TextButton onClick={() => transfers.retry(item.id)}>{t('files-transfers.retry')}</TextButton>
			break
		}
		default:
			status = null
	}

	const cancellable = transfers.isCancellable(item.id)
	const dismissable = item.state === 'failed'
	const showControl = cancellable || dismissable
	const landed = item.state === 'completed'

	return (
		<div className='flex h-7 items-center gap-2'>
			<FileItemIcon item={iconItem} machine={null} className='size-5 shrink-0' />
			<span
				className={cn(
					'min-w-0 flex-1 truncate text-xs transition-colors duration-300',
					landed ? 'text-white/60' : 'text-white/85',
				)}
				title={item.name}
			>
				{item.name}
			</span>
			<Swap id={item.state} className='max-w-[45%] shrink-0 truncate text-[11px] text-white/50'>
				{status}
			</Swap>
			<Fade show={action !== undefined}>{action}</Fade>
			{/* The control keeps its slot and only fades, so the row never
			    reflows as its phase changes */}
			<button
				className={cn(
					'shrink-0 rounded-full bg-white/10 p-1 transition-opacity duration-150 ease-out',
					showControl ? 'hover:bg-white/20' : 'pointer-events-none opacity-0',
				)}
				tabIndex={showControl ? 0 : -1}
				aria-hidden={!showControl}
				onClick={() => (dismissable ? transfers.dismiss(item.id) : transfers.cancel(item.id))}
				aria-label={dismissable ? t('files-transfers.dismiss') : t('cancel')}
			>
				<RiCloseLine className='h-3 w-3 text-white' />
			</button>
		</div>
	)
}

// The one place with a little bounce: a check that settles into place like
// something earned, not something that merely appeared
function LandedCheck() {
	return (
		<motion.span
			className='inline-flex'
			initial={{opacity: 0, scale: 0.5, rotate: -40}}
			animate={{opacity: 1, scale: 1, rotate: 0}}
			transition={{type: 'spring', duration: 0.45, bounce: 0.3}}
		>
			<RiCheckLine className='size-3.5 text-brand' />
		</motion.span>
	)
}

// Text that changes phase crosses over in place: the old reading lifts away,
// the new one rises in. Changes within a phase are instant.
function Swap({id, className, children}: {id: string; className?: string; children: ReactNode}) {
	return (
		<span className={cn('inline-block', className)}>
			<AnimatePresence initial={false} mode='wait'>
				<motion.span
					key={id}
					className='inline-block'
					initial={{opacity: 0, y: 3}}
					animate={{opacity: 1, y: 0, transition: {duration: 0.15, ease: EASE_IN_OUT}}}
					exit={{opacity: 0, y: -3, transition: {duration: 0.1, ease: EASE_IN_OUT}}}
				>
					{children}
				</motion.span>
			</AnimatePresence>
		</span>
	)
}

// Controls come and go with a soft fade rather than blinking in and out
function Fade({show, children}: {show: boolean; children: ReactNode}) {
	return (
		<AnimatePresence initial={false}>
			{show && (
				<motion.span
					className='inline-flex shrink-0 items-center gap-2'
					initial={{opacity: 0, scale: 0.9}}
					animate={{opacity: 1, scale: 1, transition: {duration: 0.15, ease: EASE_OUT}}}
					exit={{opacity: 0, scale: 0.9, transition: {duration: 0.12, ease: EASE_OUT}}}
				>
					{children}
				</motion.span>
			)}
		</AnimatePresence>
	)
}

function errorText(item: TransferItem, t: TFunction) {
	if (!item.error) return t('files-backend-error.upload-failed')
	if (item.error === UPLOAD_NETWORK_ERROR) return t('files-transfers.network-error')
	const message = getFilesErrorMessage(item.error)
	// An unmapped server message is not for the user's eyes
	return message === item.error && !item.error.startsWith('[') ? t('files-backend-error.upload-failed') : message
}

function TextButton({children, onClick}: {children: ReactNode; onClick: () => void}) {
	return (
		<button
			className='shrink-0 rounded-full px-2 py-0.5 text-[11px] text-white/70 transition-colors hover:bg-white/10 hover:text-white active:scale-[0.97]'
			onClick={(event) => {
				event.stopPropagation()
				onClick()
			}}
		>
			{children}
		</button>
	)
}
