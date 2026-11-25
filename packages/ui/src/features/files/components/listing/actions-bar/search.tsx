import {Search, X} from 'lucide-react'
import {motion} from 'motion/react'
import {useEffect, useRef} from 'react'
import {useTranslation} from 'react-i18next'

import {useFilesSearch} from '@/features/files/hooks/use-files-search'
import {SearchArc} from '@/features/search/search-arc'
import {useSearchStatus} from '@/features/search/use-search'
import {useSearchArc} from '@/features/search/use-search-footnote'
import {cn} from '@/lib/utils'
import {isBeneathModal} from '@/utils/is-beneath-modal'
import {useBreakpoint} from '@/utils/tw'

// The Files search, in the place and the shape of the Photos one. The quiet
// pill in the bar takes the stage when looked at: it widens and the page's
// other controls step aside. What is typed is searched for across the whole
// Umbrel as it goes, and the listing becomes the results. On phones it lives
// in the title row with a Cancel of its own (MobileSearch).

const EASE_OUT = [0.215, 0.61, 0.355, 1] as const
const COMPACT_WIDTH = 184
// Below xl the bar's room is spoken for (the folder's name must not be the
// one to give), so the resting pill is just the glyph: a click still morphs it wide
const COMPACT_ICON_WIDTH = 44
const EXPANDED_WIDTH = 340

// The actions-bar pill (lg and up): compact at rest, wide while engaged.
// "/" goes to it from anywhere in Files.
export function SearchPill() {
	const search = useFilesSearch()
	const breakpoint = useBreakpoint()
	const slim = breakpoint !== 'xl' && breakpoint !== '2xl'
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
			const target = event.target as HTMLElement
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)
				return
			if (isBeneathModal(inputRef.current, event)) return
			// So the "/" isn't typed into the field
			event.preventDefault()
			inputRef.current?.focus()
		}
		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [])

	if (!search) return null
	return (
		<motion.div
			className='shrink-0'
			initial={false}
			animate={{width: search.engaged ? EXPANDED_WIDTH : slim ? COMPACT_ICON_WIDTH : COMPACT_WIDTH}}
			transition={{duration: 0.25, ease: EASE_OUT}}
		>
			<SearchBox variant='bar' inputRef={inputRef} slim={slim} />
		</motion.div>
	)
}

// The title-row search on phones and tablets: the field with a Cancel beside
// it, shown in place of the title while the search is on (see FilesLayout)
export function MobileSearch() {
	const {t} = useTranslation()
	const search = useFilesSearch()
	const inputRef = useRef<HTMLInputElement>(null)
	if (!search) return null
	return (
		<div className='flex min-w-0 flex-1 items-center gap-3'>
			<div className='min-w-0 flex-1'>
				<SearchBox variant='row' inputRef={inputRef} autoFocus />
			</div>
			<button
				type='button'
				className='shrink-0 text-13 font-medium text-white/70 transition-opacity active:opacity-60'
				onClick={search.exit}
			>
				{t('cancel')}
			</button>
		</div>
	)
}

function SearchBox({
	variant,
	inputRef,
	autoFocus,
	slim = false,
}: {
	// 'bar': the desktop pill, which gives the stage back when it loses focus
	// empty. 'row': the phone title row, where only Cancel ends the search.
	variant: 'bar' | 'row'
	inputRef: React.RefObject<HTMLInputElement | null>
	autoFocus?: boolean
	// At rest the pill is only the glyph (see COMPACT_ICON_WIDTH): the input
	// gives up its width until the field is engaged
	slim?: boolean
}) {
	const {t} = useTranslation()
	const search = useFilesSearch()!
	const expanded = variant === 'row' || search.engaged
	// How far along the reading its results rest on is, while that is the
	// news beside their count (see ListingMeta)
	const analyzed = useSearchArc('files', useSearchStatus(search.query.trim() !== ''))

	return (
		<label
			className={cn(
				'settings-edge-material flex h-11 w-full cursor-text items-center gap-2 overflow-hidden rounded-24 bg-white/6 px-3 text-white/70 transition-colors duration-200 focus-within:bg-white/12 focus-within:text-white hover:bg-white/9',
				// The glyph alone sits in the middle of its round pill
				slim && !expanded && 'justify-center gap-0 px-0',
			)}
		>
			<Search className='size-4 shrink-0' aria-hidden='true' />
			<input
				ref={inputRef}
				value={search.query}
				onChange={(event) => search.setQuery(event.target.value)}
				onFocus={() => search.setOpen(true)}
				onBlur={() => {
					if (variant === 'bar') search.setOpen(false)
				}}
				onKeyDown={(event) => {
					if (event.key !== 'Escape') return
					// Escape is the search's while it has anything to give up
					event.stopPropagation()
					inputRef.current?.blur()
					search.exit()
				}}
				placeholder={expanded ? t('files-search.default') : t('files-search.placeholder')}
				aria-label={t('files-search.placeholder')}
				autoFocus={autoFocus}
				autoCorrect='off'
				autoCapitalize='off'
				spellCheck={false}
				enterKeyHint='search'
				className={cn(
					'h-full flex-1 bg-transparent text-white outline-hidden placeholder:text-white/50',
					// 16px on a phone, or iOS zooms the page into the field
					variant === 'row' ? 'text-16' : 'text-12',
					slim && !expanded ? 'w-0 min-w-0 flex-none' : 'min-w-0',
				)}
			/>
			<SearchArc files percent={analyzed} />
			{search.query !== '' && (
				<button
					type='button'
					aria-label={t('files-search.exit')}
					// Keep the focus where it is
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => {
						if (variant === 'bar') return search.exit()
						// On a phone the × empties the field, and Cancel leaves
						search.setQuery('')
						inputRef.current?.focus()
					}}
					className='shrink-0 rounded-full bg-white/10 p-1 text-white/60 transition-colors hover:bg-white/20 hover:text-white'
				>
					<X className='size-3' />
				</button>
			)}
		</label>
	)
}
