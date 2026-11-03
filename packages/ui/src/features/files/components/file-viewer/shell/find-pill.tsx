import {ChevronDown, ChevronUp, Search, X} from 'lucide-react'
import {type Ref} from 'react'
import {useTranslation} from 'react-i18next'

import {floatingGlassClass, PillButton} from '@/features/files/components/file-viewer/shell/zoom-pill'
import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

// The room to leave at the top of a stage while the pill is up, for what would otherwise sit under it: the pill's
// top-3 and h-10, and a 12px gap. A PDF's current match keeps clear of the pill by scroll margins of its own, which
// restate where the pill is (pdf-viewer.css).
export const findPillRoom = tw`pt-16`

// Find in the file, floating at the stage's top right (its edge in line with
// the header's), the same in every viewer. Enter goes to the next match,
// Shift-Enter back; the viewer's Escape closes it.
export function FindPill({
	query,
	onQuery,
	current,
	total,
	searching = false,
	onNext,
	onPrevious,
	onClose,
	inputRef,
	className,
}: {
	query: string
	onQuery: (query: string) => void
	current: number
	total: number
	// Still looking through the document: no "No results" yet
	searching?: boolean
	onNext: () => void
	onPrevious: () => void
	onClose: () => void
	inputRef?: Ref<HTMLInputElement>
	// Where it floats, when the stage has something else at its top
	className?: string
}) {
	const {t} = useTranslation()
	const status = !query
		? undefined
		: total > 0
			? t('files-viewer.find-count', {current, total})
			: searching
				? undefined
				: t('files-viewer.find-none')

	return (
		<div className={cn('pointer-events-none absolute top-3 right-4 z-20 max-md:left-4 md:right-6', className)}>
			<div
				role='search'
				className={cn(
					floatingGlassClass,
					'pointer-events-auto flex h-10 items-center gap-0.5 rounded-full pr-1 pl-3.5 motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in motion-safe:slide-in-from-top-1',
				)}
			>
				<Search className='size-4 shrink-0 text-white/45' />
				<input
					ref={inputRef}
					// Text, not search: markup's shortcuts leave text fields alone
					type='text'
					autoFocus
					enterKeyHint='search'
					spellCheck={false}
					aria-label={t('files-viewer.find')}
					placeholder={t('files-viewer.find-placeholder')}
					value={query}
					onChange={(event) => onQuery(event.target.value)}
					onFocus={(event) => event.target.select()}
					onKeyDown={(event) => {
						if (event.key !== 'Enter') return
						event.preventDefault()
						if (event.shiftKey) onPrevious()
						else onNext()
					}}
					className='mx-2 h-full w-40 min-w-0 bg-transparent text-13 text-white/90 outline-none placeholder:text-white/35 max-md:flex-1'
				/>
				<span aria-live='polite' className='shrink-0 pr-1 text-12 whitespace-nowrap text-white/45 tabular-nums'>
					{status}
				</span>
				<PillButton
					icon={ChevronUp}
					label={t('files-viewer.find-previous')}
					tooltipSide='bottom'
					disabled={total === 0}
					onClick={onPrevious}
				/>
				<PillButton
					icon={ChevronDown}
					label={t('files-viewer.find-next')}
					tooltipSide='bottom'
					disabled={total === 0}
					onClick={onNext}
				/>
				<PillButton icon={X} label={t('files-viewer.find-close')} tooltipSide='bottom' onClick={onClose} />
			</div>
		</div>
	)
}
