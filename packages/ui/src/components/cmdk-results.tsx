import {ChevronRight, Play} from 'lucide-react'
import {useId} from 'react'
import {useTranslation} from 'react-i18next'

import {AppIcon} from '@/components/app-icon'
import {CommandItem, CommandList} from '@/components/ui/command'
import {ItemThumbnail, tintColor} from '@/features/photos/components/listing/item-thumbnail'
import {formatMoment} from '@/features/search/format'
import {isContentMatch, MatchGlyph} from '@/features/search/match-glyph'
import {MomentScrubber} from '@/features/search/moment-scrubber'
import {MomentStill} from '@/features/search/moment-still'
import {SearchMatchLine} from '@/features/search/search-match-line'
import {cn} from '@/lib/utils'
import {HttpUrlAuthorizerProvider} from '@/modules/auth/http-url-authorizer'

import {cmdkMoreValue, type CmdkItem, type CmdkResults, type CmdkSection} from './cmdk-sources'

const PLACEHOLDER_TILES = 6
const PLACEHOLDER_ROWS = 3

export function CmdkResultsList({results, listRef}: {results: CmdkResults; listRef: React.Ref<HTMLDivElement>}) {
	const {t} = useTranslation()
	const {ready, sections, footer, empty} = results
	return (
		<CommandList ref={listRef} className='mt-3.5 max-h-[min(60dvh,500px)] scroll-py-2 pb-1' aria-busy={!ready}>
			{!ready ? null : sections.length === 0 ? (
				<div role='status' className='px-4 py-10 text-center text-13 -tracking-2 text-white/40'>
					{empty ?? t('no-results-found')}
				</div>
			) : (
				<div className='flex flex-col'>
					{/* Thumbnails carry the API token — photo tiles and file rows
					    alike; one provider serves every one of them */}
					<HttpUrlAuthorizerProvider>
						{sections.map((section, index) => (
							<Section key={section.id} section={section} first={index === 0} />
						))}
					</HttpUrlAuthorizerProvider>
					{footer && (
						<div className='cmdk-section mt-3 px-2'>
							<CommandItem
								value={footer.value}
								onSelect={footer.onSelect}
								showShortcut={false}
								className='inline-flex w-auto gap-1.5 rounded-full bg-white/6 py-1.5 pr-2.5 pl-2 text-13 text-white/80 hover:bg-white/10 aria-selected:bg-white/12 aria-selected:text-white md:text-13'
							>
								{typeof footer.icon === 'string' && (
									<AppIcon src={footer.icon} size={20} className='rounded-[22%] border-0 bg-transparent' />
								)}
								{footer.title}
								<ChevronRight className='size-3.5 text-white/45' />
							</CommandItem>
						</div>
					)}
				</div>
			)}
		</CommandList>
	)
}

// Sections are keyed by id, so one that appears mid-search (a server search
// landing) rises in while the rest, and everything within them, changes in
// place without animation. The header comes last in the DOM and first on
// screen (`order-first`): cmdk selects the first item in DOM order when a
// search changes, and that should be the first result, not the header's
// "More" link.
function Section({section, first}: {section: CmdkSection; first: boolean}) {
	const {t} = useTranslation()
	return (
		<section
			// A group of options inside the results listbox, not a page region
			role='group'
			className={cn('cmdk-section flex flex-col', !first && 'mt-3 border-t border-white/6 pt-3')}
			aria-label={section.title}
		>
			<SectionItems section={section} />
			{section.title && (
				<div className='order-first mb-1 flex min-h-7 items-center gap-2 pr-1 pl-2'>
					{section.icon && <AppIcon src={section.icon} size={22} className='rounded-[22%] border-0 bg-transparent' />}
					<span className='text-13 font-medium -tracking-2 text-white/75'>{section.title}</span>
					{section.more && (
						<CommandItem
							value={cmdkMoreValue(section.id)}
							onSelect={section.more}
							showShortcut={false}
							aria-label={t('cmdk.more-in', {section: section.title})}
							className='ml-auto gap-0.5 rounded-full py-1 pr-1.5 pl-2.5 text-12 text-white/50 hover:text-white/80 aria-selected:bg-white/10 aria-selected:text-white md:text-12'
						>
							{t('cmdk.more')}
							<ChevronRight className='size-3.5' />
						</CommandItem>
					)}
				</div>
			)}
		</section>
	)
}

function SectionItems({section}: {section: CmdkSection}) {
	if (section.layout === 'list') {
		return (
			<div className='cmdk-rows'>
				{section.items.map((item) => (
					<CommandItem
						key={item.value}
						value={item.value}
						icon={item.icon}
						iconVariant={item.iconVariant}
						disabled={item.disabled}
						onSelect={item.onSelect}
					>
						{/* One flex item, so the subtitle sits a text space away rather than a flex gap */}
						<span className='truncate'>
							{item.title}
							{item.subtitle && <span className='text-white/50'> {item.subtitle}</span>}
						</span>
					</CommandItem>
				))}
			</div>
		)
	}

	const placeholders = section.loading && section.items.length === 0

	if (section.layout === 'results') {
		return (
			<div className='flex flex-col gap-0.5'>
				{placeholders
					? Array.from({length: PLACEHOLDER_ROWS}, (_, index) => (
							<div key={index} className='flex h-[52px] items-center gap-3 px-2' aria-hidden='true'>
								{/* A row as it will be: a thumbnail, a name, the line under it */}
								<div className='size-9 animate-pulse rounded-6 bg-white/4' />
								<div className='flex flex-1 flex-col gap-2'>
									<div className='h-2.5 w-1/4 animate-pulse rounded-full bg-white/5' />
									<div className='h-2 w-1/2 animate-pulse rounded-full bg-white/3' />
								</div>
							</div>
						))
					: section.items.map((item) => <ResultRow key={item.value} item={item} />)}
			</div>
		)
	}

	// Photo tiles found by a search say why under the grid, the selected one
	// at a time (see PhotoTile): a line of room is kept for it, so walking the
	// tiles never moves anything
	const captioned = section.layout === 'photos' && section.items.some((item) => item.result)

	return (
		<div
			className={cn('grid grid-cols-3 gap-1 sm:grid-cols-6', captioned && 'relative pb-6')}
			// Where the palette looks for the line to scroll into view with a tile
			data-captioned={captioned ? '' : undefined}
		>
			{placeholders
				? Array.from({length: PLACEHOLDER_TILES}, (_, index) => (
						<div key={index} className='aspect-square animate-pulse rounded-12 bg-white/4' aria-hidden='true' />
					))
				: section.items.map((item) =>
						section.layout === 'photos' ? (
							<PhotoTile key={item.value} item={item} />
						) : (
							<Tile key={item.value} item={item} />
						),
					)}
		</div>
	)
}

function Tile({item}: {item: CmdkItem}) {
	return (
		<CommandItem
			value={item.value}
			disabled={item.disabled}
			onSelect={item.onSelect}
			showShortcut={false}
			aria-label={item.title}
			className='flex-col gap-2 rounded-12 px-1.5 pt-3 pb-2.5 text-center hover:bg-white/4 aria-selected:bg-white/8 aria-selected:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]'
		>
			<span className='flex size-12 items-center justify-center'>
				{typeof item.icon === 'string' ? (
					<AppIcon src={item.icon} size={48} className='rounded-12' />
				) : (
					<span className='flex size-12 items-center justify-center'>{item.icon}</span>
				)}
			</span>
			<span className='w-full truncate text-12 leading-tight font-medium -tracking-2 text-white/80'>{item.title}</span>
		</CommandItem>
	)
}

// A search result that is a file: its thumbnail or icon, its name, and under
// it the line that makes the result make sense — the words that matched, the
// page or moment they are at, or the folder it sits in. One found by what is
// in it leads that line with a glyph for how (see MatchGlyph).
function ResultRow({item}: {item: CmdkItem}) {
	const glyphId = useId()
	const match = item.result?.match
	return (
		<CommandItem
			value={item.value}
			onSelect={item.onSelect}
			aria-label={item.title}
			aria-describedby={isContentMatch(match) ? glyphId : undefined}
			className='h-[52px] py-0'
		>
			<span className='relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-6'>
				{item.icon}
			</span>
			<span className='min-w-0 flex-1'>
				<span className='block truncate text-13 leading-[18px] sm:text-14'>{item.title}</span>
				{item.result && (
					<span className='flex items-center gap-1 text-12 leading-[17px] font-normal text-white/45'>
						<MatchGlyph match={match} id={glyphId} />
						<SearchMatchLine result={item.result} className='min-w-0 flex-1' />
					</span>
				)}
			</span>
		</CommandItem>
	)
}

function PhotoTile({item}: {item: CmdkItem}) {
	const glyphId = useId()
	if (!item.photo) return null
	const {kind, durationMs} = item.photo
	const moment = item.result?.moment
	const match = item.result?.match
	return (
		<CommandItem
			value={item.value}
			onSelect={item.onSelect}
			showShortcut={false}
			aria-label={item.title}
			aria-describedby={isContentMatch(match) ? glyphId : undefined}
			// Not positioned: the caption below is placed against the grid
			className='static rounded-10 p-[3px] aria-selected:bg-white/20'
		>
			<span className='relative block aspect-square w-full overflow-hidden rounded-8'>
				{/* ~100px tiles: the 192 covers them, and it is the rendition the
				    lightbox seeds from when a result is opened (see useSeedRenditions) */}
				<ItemThumbnail item={item.photo} size={192} className='absolute inset-0' />
				{moment?.thumbnail && <MomentStill url={moment.thumbnail} backdrop={tintColor(item.photo.tint)} />}
				{/* A video says so, with its length. One a search matched partway
				    through wears that moment instead, as a player would show it
				    played to there: it is where the match was found, and where
				    opening it will start. */}
				{kind !== 'video' ? null : moment ? (
					<MomentScrubber momentMs={moment.startMs} durationMs={durationMs} />
				) : (
					<span className='absolute bottom-1 left-1 flex h-[18px] items-center gap-[3px] rounded-full bg-black/55 px-1.5 text-[11px] leading-none font-medium text-white tabular-nums backdrop-blur-sm'>
						<Play className='size-2' fill='currentColor' strokeWidth={0} aria-hidden='true' />
						{durationMs !== undefined && formatMoment(durationMs)}
					</span>
				)}
			</span>
			{/* A tile has no second line to explain itself on, so the selected
			    one does it under the grid: its name, and why it matched — how
			    it was found, the words said or read in it, or where it lives */}
			{item.result && (
				<span className='pointer-events-none absolute inset-x-1.5 bottom-0 hidden h-5 items-center gap-2 text-12 leading-5 font-normal group-aria-selected:flex'>
					<span className='max-w-[45%] shrink-0 truncate font-medium text-white/75'>{item.title}</span>
					<span className='flex min-w-0 flex-1 items-center gap-1 text-white/45'>
						<MatchGlyph match={match} id={glyphId} />
						<SearchMatchLine result={item.result} className='min-w-0 flex-1' />
					</span>
				</span>
			)}
		</CommandItem>
	)
}
