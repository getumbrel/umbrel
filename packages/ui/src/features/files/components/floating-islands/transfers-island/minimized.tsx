import {useTranslation} from 'react-i18next'
import {RiArrowUpLine, RiCheckLine, RiErrorWarningFill, RiFileCopyFill, RiFileTransferFill} from 'react-icons/ri'

import {CircularProgress} from '@/features/files/components/shared/circular-progress'
import type {TransfersView} from '@/features/files/transfers/use-transfers'
import {secondsToEta} from '@/utils/seconds-to-eta'

// The pill says what is happening right now, in order of what deserves the
// eye: something needs the user, something failed, something is moving,
// everything landed. No averaged percentage across unlike work: the ring
// belongs to the batch the label names.
export function MinimizedContent({view}: {view: TransfersView}) {
	const {t} = useTranslation()
	const {primary, counts} = view
	const running = primary?.rows.find((item) => item.state === 'running' || item.state === 'finishing')

	let icon
	let label: string
	let detail: string | undefined
	if (counts.attention > 0) {
		icon = <RiErrorWarningFill className='h-3 w-3 text-white/60' />
		label = t('files-transfers.needs-attention-count', {count: counts.attention})
	} else if (counts.running + counts.queued === 0 && counts.failed > 0) {
		icon = <RiErrorWarningFill className='h-3 w-3 text-white/60' />
		label = t('files-transfers.failed-count', {count: counts.failed})
	} else if (counts.running + counts.queued === 0) {
		icon = <RiCheckLine className='h-3 w-3 text-white/60' />
		label = t('files-transfers.done')
	} else {
		icon =
			primary?.kind === 'copy' ? (
				<RiFileCopyFill className='h-3 w-3 text-white/60' />
			) : primary?.kind === 'move' ? (
				<RiFileTransferFill className='h-3 w-3 text-white/60' />
			) : (
				<RiArrowUpLine className='h-3 w-3 text-white/60' />
			)
		label = running?.name ?? t('files-transfers.queued')
		if (primary?.secondsRemaining !== undefined && primary.secondsRemaining > 0) {
			detail = secondsToEta(primary.secondsRemaining)
		} else if (counts.queued > 0) {
			detail = t('files-transfers.queued-count', {count: counts.queued})
		}
	}

	const progress = counts.running + counts.queued === 0 ? 100 : (primary?.progress ?? 0)

	return (
		<div className='flex h-full w-full items-center gap-2 px-2'>
			<CircularProgress progress={progress}>{icon}</CircularProgress>
			<div className='min-w-0 flex-1'>
				<span className='block truncate text-center text-xs text-white/90'>{label}</span>
			</div>
			{detail && <span className='shrink-0 text-xs whitespace-nowrap text-white/60'>{detail}</span>}
		</div>
	)
}
