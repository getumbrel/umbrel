import {Album, Calendar, Globe, Image, RectangleHorizontal, ScanLine, Search, Video, X} from 'lucide-react'
import {motion} from 'motion/react'
import {useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useParams} from 'react-router-dom'

import {FadeScroller} from '@/components/fade-scroller'
import {Popover, PopoverAnchor, PopoverContent} from '@/components/ui/popover'
import {LivePhotoIcon} from '@/features/photos/components/live-photo-icon'
import {suggest, type Suggestion} from '@/features/photos/components/search/suggest'
import {SourceIcon} from '@/features/photos/components/sources/source-icon'
import {usePhotosView, type SearchToken} from '@/features/photos/components/view-context'
import {useAlbums, useLibrarySummary} from '@/features/photos/hooks/use-library'
import {usePhotoSources} from '@/features/photos/hooks/use-photo-sources'
import {cn} from '@/lib/utils'
import {formatNumberI18n} from '@/utils/number'
import {useBreakpoint} from '@/utils/tw'

// The Photos search. The quiet pill in the actions bar takes the stage when
// looked at: it widens, the page's other controls step aside, and a panel
// unfolds beneath with everything a search can be made of — the photo/video
// split, the sources, the library's own months. Typed text narrows the grid
// by file name as it goes (the grid is the results; nothing changes place),
// while the panel reads the text as dates and sources to offer; choosing one
// turns it into a small token in the field, and the dimensions stack. On
// phones the search lives in the title row with a Cancel of its own
// (MobileSearch). Leaving the page ends the search — every view starts whole.

const EASE_OUT = [0.215, 0.61, 0.355, 1] as const
const COMPACT_WIDTH = 184
// Below xl the bar's room is spoken for (the date must not be the one to
// give), so the resting pill is just the glyph — a tap still morphs it wide
const COMPACT_ICON_WIDTH = 44
const EXPANDED_WIDTH = 380

// Whether the search has the stage or a hold on the grid: the field is wide
// and the bar's other controls stay aside while anything is typed or applied
export function useSearchEngaged() {
	const {search} = usePhotosView()
	return search.open || search.active || search.text !== ''
}

// The actions-bar pill (md and up): compact at rest, wide while engaged.
// The panel waits for the width morph to finish — anchored to a field still
// growing it would stretch and re-wrap mid-open; this way the field takes
// the stage first and the panel unfolds beneath it, already its full size.
// A field that is already wide (tokens in it, refocused) never animates, so
// its panel opens at once.
export function SearchPill() {
	const engaged = useSearchEngaged()
	const [settled, setSettled] = useState(true)
	const breakpoint = useBreakpoint()
	const slim = breakpoint !== 'xl' && breakpoint !== '2xl'
	return (
		<motion.div
			className='shrink-0'
			initial={false}
			animate={{width: engaged ? EXPANDED_WIDTH : slim ? COMPACT_ICON_WIDTH : COMPACT_WIDTH}}
			transition={{duration: 0.25, ease: EASE_OUT}}
			onAnimationStart={() => setSettled(false)}
			onAnimationComplete={() => setSettled(true)}
		>
			<SearchBox variant='bar' expanded={engaged} slim={slim} panelReady={settled} />
		</motion.div>
	)
}

// The title-row search on phones: the field with a Cancel beside it, shown in
// place of the title while the search is on (see PhotosLayout)
export function MobileSearch() {
	const {t} = useTranslation()
	const {search} = usePhotosView()
	return (
		<div className='flex min-w-0 flex-1 items-center gap-3'>
			<div className='min-w-0 flex-1'>
				<SearchBox variant='row' expanded autoFocus />
			</div>
			<button
				type='button'
				className='shrink-0 text-13 font-medium text-white/70 transition-opacity active:opacity-60'
				onClick={() => {
					search.clear()
					search.setOpen(false)
				}}
			>
				{t('cancel')}
			</button>
		</div>
	)
}

function SearchBox({
	variant,
	expanded,
	autoFocus,
	slim = false,
	panelReady = true,
}: {
	// 'bar': the desktop pill — losing focus closes the panel. 'row': the
	// phone title row — only Cancel (or leaving) ends the search, so the
	// panel stays through keyboard dismissals and stray taps.
	variant: 'bar' | 'row'
	expanded: boolean
	autoFocus?: boolean
	// At rest the pill is only the glyph (see COMPACT_ICON_WIDTH): the input
	// gives up its width until the field is engaged
	slim?: boolean
	// The field is at its full width, so the panel may unfold (see SearchPill)
	panelReady?: boolean
}) {
	const {t} = useTranslation()
	const {search} = usePhotosView()
	const inputRef = useRef<HTMLInputElement>(null)
	const boxRef = useRef<HTMLDivElement>(null)
	const suggestions = useSuggestions()
	const [highlight, setHighlight] = useState(-1)
	const panelOpen = search.open && panelReady && suggestions.length > 0
	const browsing = search.text.trim() === ''

	// The options change under the highlight with every keystroke
	useEffect(() => setHighlight(-1), [search.text, search.open])

	const pick = (suggestion: Suggestion) => {
		search.addToken(suggestion.token)
		// The token consumed the words that suggested it
		search.setText('')
		inputRef.current?.focus()
	}

	const onKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === 'ArrowDown' && panelOpen) {
			setHighlight((current) => (current + 1) % suggestions.length)
			event.preventDefault()
		} else if (event.key === 'ArrowUp' && panelOpen) {
			setHighlight((current) => (current <= 0 ? suggestions.length - 1 : current - 1))
			event.preventDefault()
		} else if (event.key === 'Enter') {
			if (panelOpen && highlight >= 0) pick(suggestions[highlight]!)
			// Return commits: the grid is already narrowed, the panel bows out
			else search.setOpen(false)
		} else if (event.key === 'Escape') {
			// Steps back out: words first, then the stage
			event.stopPropagation()
			if (search.text !== '') search.setText('')
			else {
				search.setOpen(false)
				inputRef.current?.blur()
			}
		} else if (event.key === 'Backspace' && search.text === '' && search.tokens.length > 0) {
			search.removeToken(search.tokens.length - 1)
		}
	}

	return (
		<Popover open={panelOpen}>
			<PopoverAnchor asChild>
				<div
					ref={boxRef}
					className={cn(
						'settings-edge-material flex h-11 w-full items-center gap-2 rounded-24 bg-white/6 px-3 text-white/70 transition-colors duration-200 focus-within:bg-white/12 focus-within:text-white hover:bg-white/9',
					)}
					onClick={() => inputRef.current?.focus()}
				>
					<Search className='size-4 shrink-0' aria-hidden='true' />
					{search.tokens.length > 0 && <TokenStrip />}
					<input
						ref={inputRef}
						value={search.text}
						onChange={(event) => {
							search.setText(event.target.value)
							// A keystroke re-summons a panel that was put away
							search.setOpen(true)
						}}
						onFocus={() => search.setOpen(true)}
						onBlur={(event) => {
							if (variant === 'row') return
							if (boxRef.current?.contains(event.relatedTarget)) return
							search.setOpen(false)
						}}
						onKeyDown={onKeyDown}
						// The long invitation belongs to the empty field; beside
						// tokens there is only room for the word
						placeholder={
							expanded && search.tokens.length === 0
								? t('photos-actions.search-placeholder')
								: t('photos-actions.search')
						}
						aria-label={t('photos-actions.search')}
						role='combobox'
						aria-expanded={panelOpen}
						aria-controls='photos-search-options'
						aria-activedescendant={highlight >= 0 ? optionId(highlight) : undefined}
						autoFocus={autoFocus}
						autoCorrect='off'
						spellCheck={false}
						className={cn(
							'h-full flex-1 bg-transparent text-12 text-white outline-hidden placeholder:text-white/50',
							slim && !expanded ? 'w-0 min-w-0' : 'min-w-16',
						)}
					/>
					{(search.text !== '' || search.tokens.length > 0) && (
						<button
							type='button'
							aria-label={t('photos-search.clear')}
							// Keep the focus (and the panel) where they are
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => {
								search.clear()
								inputRef.current?.focus()
							}}
							className='shrink-0 rounded-full bg-white/10 p-1 text-white/60 transition-colors hover:bg-white/20 hover:text-white'
						>
							<X className='size-3' />
						</button>
					)}
				</div>
			</PopoverAnchor>
			<PopoverContent
				align='end'
				sideOffset={10}
				collisionPadding={16}
				onOpenAutoFocus={(event) => event.preventDefault()}
				onCloseAutoFocus={(event) => event.preventDefault()}
				onEscapeKeyDown={() => search.setOpen(false)}
				onPointerDownOutside={(event) => {
					// A tap on the field itself is not outside the search
					if (boxRef.current?.contains(event.target as Node)) return
					if (variant === 'bar') search.setOpen(false)
				}}
				className='relative w-[var(--radix-popper-anchor-width)] rounded-20 p-3'
			>
				{/* Puts the panel away without touching the search itself */}
				<button
					type='button'
					aria-label={t('close')}
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => search.setOpen(false)}
					className='absolute top-2.5 right-2.5 z-10 rounded-full bg-white/10 p-1 text-white/60 transition-colors hover:bg-white/20 hover:text-white'
				>
					<X className='size-3' />
				</button>
				<div
					id='photos-search-options'
					role='listbox'
					aria-label={t('photos-actions.search')}
					// The top strip belongs to the close button: content starts below
					// it, so no suggestion ever sits under the ×
					className='max-h-[min(420px,var(--radix-popper-available-height))] overflow-y-auto pt-5'
				>
					{browsing ? (
						<BrowsePanel suggestions={suggestions} highlight={highlight} onHighlight={setHighlight} onPick={pick} />
					) : (
						suggestions.map((suggestion, index) => (
							<SuggestionRow
								key={tokenKey(suggestion.token)}
								suggestion={suggestion}
								highlighted={index === highlight}
								id={optionId(index)}
								onHighlight={() => setHighlight(index)}
								onPick={() => pick(suggestion)}
							/>
						))
					)}
				</div>
			</PopoverContent>
		</Popover>
	)
}

// With nothing typed the panel lays the search's dimensions bare, one row of
// chips each: what to show, where from, and when. It teaches the whole
// feature in a glance, and each chip is a search of its own.
function BrowsePanel({
	suggestions,
	highlight,
	onHighlight,
	onPick,
}: {
	suggestions: Suggestion[]
	highlight: number
	onHighlight: (index: number) => void
	onPick: (suggestion: Suggestion) => void
}) {
	const {t} = useTranslation()
	const groups = [
		// The photo/video split and the subKinds share the TYPE row: both answer
		// "what kind of thing"
		{label: t('photos-search.type'), key: 'kind', types: ['kind', 'subKind'] as const},
		{label: t('photos-search.source'), key: 'source', types: ['source'] as const},
		{label: t('photos-search.album'), key: 'album', types: ['album'] as const},
		{label: t('photos-search.date'), key: 'date', types: ['date'] as const},
	]
		.map((group) => ({
			...group,
			// Keep each suggestion's index in the flat list: the keyboard walks
			// that list, whatever shape it is rendered in
			items: suggestions.flatMap((suggestion, index) =>
				(group.types as readonly string[]).includes(suggestion.token.type) ? [{suggestion, index}] : [],
			),
		}))
		.filter((group) => group.items.length > 0)
	return (
		<div className='flex flex-col gap-3'>
			{groups.map((group) => (
				<div key={group.key}>
					<p className='mb-1.5 px-1 text-11 font-medium tracking-wide text-white/40 uppercase'>{group.label}</p>
					<div className='flex flex-wrap gap-1.5'>
						{group.items.map(({suggestion, index}) => (
							<SuggestionChip
								key={tokenKey(suggestion.token)}
								suggestion={suggestion}
								highlighted={index === highlight}
								id={optionId(index)}
								onHighlight={() => onHighlight(index)}
								onPick={() => onPick(suggestion)}
							/>
						))}
					</div>
				</div>
			))}
		</div>
	)
}

// Shared option behaviour: the pointer must not steal the input's focus (the
// panel lives and dies by it), hovering highlights like the arrow keys do
function optionProps({
	id,
	highlighted,
	onHighlight,
	onPick,
}: {
	id: string
	highlighted: boolean
	onHighlight: () => void
	onPick: () => void
}) {
	return {
		id,
		role: 'option',
		'aria-selected': highlighted,
		tabIndex: -1,
		onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
		onMouseMove: onHighlight,
		onClick: onPick,
	}
}

function SuggestionChip({
	suggestion,
	highlighted,
	id,
	onHighlight,
	onPick,
}: {
	suggestion: Suggestion
	highlighted: boolean
	id: string
	onHighlight: () => void
	onPick: () => void
}) {
	const {i18n} = useTranslation()
	return (
		<div
			{...optionProps({id, highlighted, onHighlight, onPick})}
			className={cn(
				'flex h-8 max-w-full min-w-0 cursor-default items-center gap-1.5 rounded-full bg-white/8 px-3 text-12 font-medium text-white/90 transition-colors',
				highlighted && 'bg-white/17 text-white',
			)}
		>
			<TokenIcon token={suggestion.token} />
			{/* A long label (an album name) truncates inside the chip instead of stretching it past the row */}
			<span className='min-w-0 truncate'>
				<TokenLabel token={suggestion.token} />
			</span>
			{suggestion.count !== undefined && (
				<span className='shrink-0 text-11 text-white/40 tabular-nums'>
					{formatNumberI18n({n: suggestion.count, showDecimals: false, locale: i18n.language})}
				</span>
			)}
		</div>
	)
}

function SuggestionRow({
	suggestion,
	highlighted,
	id,
	onHighlight,
	onPick,
}: {
	suggestion: Suggestion
	highlighted: boolean
	id: string
	onHighlight: () => void
	onPick: () => void
}) {
	const {i18n} = useTranslation()
	return (
		<div
			{...optionProps({id, highlighted, onHighlight, onPick})}
			className={cn(
				'flex h-10 cursor-default items-center gap-2.5 rounded-12 px-2.5 text-13 text-white/90',
				highlighted && 'bg-white/10 text-white',
			)}
		>
			<TokenIcon token={suggestion.token} className='size-4' sourceSize={18} />
			<span className='min-w-0 truncate'>
				<TokenLabel token={suggestion.token} />
			</span>
			{suggestion.count !== undefined && (
				<span className='ml-auto shrink-0 text-12 text-white/40 tabular-nums'>
					{formatNumberI18n({n: suggestion.count, showDecimals: false, locale: i18n.language})}
				</span>
			)}
		</div>
	)
}

// The applied narrowings, riding inside the field. Capped well short of the
// field's width so there is always room to keep typing: past the cap the
// chips scroll sideways under faded edges (the fade only appears on a side
// with more to see), and a new chip scrolls into view as it lands.
function TokenStrip() {
	const {search} = usePhotosView()
	const stripRef = useRef<HTMLDivElement>(null)
	useEffect(() => {
		const strip = stripRef.current
		if (strip) strip.scrollLeft = strip.scrollWidth
	}, [search.tokens.length])
	return (
		<FadeScroller
			direction='x'
			ref={stripRef}
			className='umbrel-hide-scrollbar flex max-w-[calc(100%-140px)] shrink-0 items-center gap-2 overflow-x-auto'
		>
			{search.tokens.map((token, index) => (
				<TokenChip key={tokenKey(token)} token={token} onRemove={() => search.removeToken(index)} />
			))}
		</FadeScroller>
	)
}

// One applied narrowing, shown inside the field; clicking (or Backspace at
// the field's start) takes it off
function TokenChip({token, onRemove}: {token: SearchToken; onRemove: () => void}) {
	const {t} = useTranslation()
	return (
		<button
			type='button'
			aria-label={t('photos-search.remove-filter', {label: labelOf(token, t)})}
			// Keep the focus (and the panel) in the field through the click
			onMouseDown={(event) => event.preventDefault()}
			onClick={(event) => {
				event.stopPropagation()
				onRemove()
			}}
			className='group flex h-7 max-w-36 min-w-0 shrink-0 items-center gap-1.5 rounded-full bg-white/10 pr-1.5 pl-2 text-12 whitespace-nowrap text-white/90 transition-colors hover:bg-white/15'
		>
			<TokenIcon token={token} />
			{/* min-w-0 lets the label shrink inside the capped pill; without it the text runs past the pill's edge */}
			<span className='min-w-0 truncate'>
				<TokenLabel token={token} />
			</span>
			<X className='size-3 shrink-0 text-white/40 transition-colors group-hover:text-white/80' />
		</button>
	)
}

function TokenIcon({token, className, sourceSize = 14}: {token: SearchToken; className?: string; sourceSize?: number}) {
	if (token.type === 'source') return <SearchSourceIcon id={token.id} size={sourceSize} />
	const Icon =
		token.type === 'date'
			? Calendar
			: token.type === 'album'
				? Album
				: token.type === 'subKind'
					? {live: LivePhotoIcon, panorama: RectangleHorizontal, screenshot: ScanLine, spherical: Globe}[token.subKind]
					: token.kind === 'video'
						? Video
						: Image
	return <Icon className={cn('size-3.5 shrink-0 opacity-60', className)} aria-hidden='true' />
}

// The same device artwork the sidebar shows for this source
function SearchSourceIcon({id, size}: {id: string; size: number}) {
	const {sources} = usePhotoSources()
	const type = sources.find((source) => source.id === id)?.type
	if (!type) return null
	return <SourceIcon type={type} size={size} />
}

function TokenLabel({token}: {token: SearchToken}) {
	const {t} = useTranslation()
	return <>{labelOf(token, t)}</>
}

function labelOf(token: SearchToken, t: (key: string) => string) {
	if (token.type === 'kind') return token.kind === 'video' ? t('photos-sidebar.videos') : t('photos-sidebar.photos')
	return token.label
}

const tokenKey = (token: SearchToken) =>
	token.type === 'date'
		? `date-${token.from}-${token.to}`
		: token.type === 'source'
			? `source-${token.id}`
			: token.type === 'album'
				? `album-${token.id}`
				: token.type === 'subKind'
					? `subkind-${token.subKind}`
					: `kind-${token.kind}`
const optionId = (index: number) => `photos-search-option-${index}`

// What the panel offers here, now: only dimensions that can still narrow the
// view (a source page needs no source chips, an album page no album chips,
// the Videos section no photo/video split), with counts only where they are
// truthful — the whole library, which is what the summary counts.
function useSuggestions(): Suggestion[] {
	const {t, i18n} = useTranslation()
	const {search} = usePhotosView()
	const {section, sourceId, albumId} = useParams()
	const {data: summary} = useLibrarySummary()
	const {sources} = usePhotoSources()
	const {data: albums} = useAlbums()
	return useMemo(() => {
		// On a section whose type is already pinned (Photos, Videos, or any
		// subKind view) type chips can only contradict the page
		const kindFixed =
			section === 'photos' ||
			section === 'videos' ||
			section === 'live-photos' ||
			section === 'panoramas' ||
			section === 'screenshots' ||
			section === '360'
		const inLibrary = (section === undefined || section === 'all') && !sourceId && !albumId
		const kinds = kindFixed
			? []
			: ([
					{kind: 'photo', label: t('photos-sidebar.photos'), count: inLibrary ? summary?.counts.photos : undefined},
					{kind: 'video', label: t('photos-sidebar.videos'), count: inLibrary ? summary?.counts.videos : undefined},
				] as const)
		// SubKinds ride the TYPE row too, but only ones the library actually
		// holds — a chip that can only find nothing is not worth offering
		const subKinds = kindFixed
			? []
			: (
					[
						{subKind: 'live', label: t('photos-sidebar.live-photos'), count: summary?.bySubKind.live},
						{subKind: 'panorama', label: t('photos-sidebar.panoramas'), count: summary?.bySubKind.panorama},
						{subKind: 'screenshot', label: t('photos-sidebar.screenshots'), count: summary?.bySubKind.screenshot},
						{subKind: 'spherical', label: t('photos-sidebar.spherical'), count: summary?.bySubKind.spherical},
					] as const
				)
					.filter((entry) => (entry.count ?? 0) > 0)
					.map((entry) => ({...entry, count: inLibrary ? entry.count : undefined}))
		// A lone source is the whole library — a chip for it narrows nothing and
		// only raises the question of what else there could be
		const offeredSources =
			sourceId || sources.length < 2
				? []
				: sources.map((source) => ({
						id: source.id,
						name: source.name,
						count: inLibrary ? summary?.bySource[source.id] : undefined,
					}))
		// Freshest albums first for browsing, and never an empty one — a token
		// that can only find nothing is not worth offering
		const offeredAlbums = albumId
			? []
			: (albums ?? [])
					.filter((album) => album.count > 0)
					.sort((a, b) => b.createdAt - a.createdAt)
					.map((album) => ({
						id: album.id,
						name: album.name,
						count: inLibrary ? album.count : undefined,
					}))
		const all = suggest({
			text: search.text,
			locale: i18n.language,
			months: summary?.months ?? [],
			sources: offeredSources,
			albums: offeredAlbums,
			kinds: [...kinds],
			subKinds,
		})
		// What's already applied isn't offered again
		return all.filter(
			({token}) =>
				!search.tokens.some(
					(existing) =>
						(existing.type === 'date' &&
							token.type === 'date' &&
							existing.from === token.from &&
							existing.to === token.to) ||
						(existing.type === 'source' && token.type === 'source' && existing.id === token.id) ||
						(existing.type === 'album' && token.type === 'album' && existing.id === token.id) ||
						(existing.type === 'kind' && token.type === 'kind' && existing.kind === token.kind) ||
						(existing.type === 'subKind' && token.type === 'subKind' && existing.subKind === token.subKind),
				),
		)
	}, [search.text, search.tokens, section, sourceId, albumId, summary, sources, albums, t, i18n.language])
}
