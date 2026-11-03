import {X} from 'lucide-react'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'

import {DetentSheet, type Detent} from '@/components/ui/detent-sheet'
import {CountText} from '@/features/photos/components/actions-bar/count-text'
import {useRouteFilter} from '@/features/photos/components/listing/route-filter'
import type {Frame} from '@/features/photos/components/listing/surface'
import {TimelineGrid} from '@/features/photos/components/listing/timeline-grid'
import {HEADER_HEIGHT} from '@/features/photos/components/listing/timeline-rows'
import {usePhotosView} from '@/features/photos/components/view-context'
import {useItems} from '@/features/photos/hooks/use-items'
import {formatNumberI18n} from '@/utils/number'

type Scope = {key: string; count: number}

// The list's own frame: the grid's first header row is the current date,
// which this panel names in a title pinned over that row (as the actions
// bar does for the timeline), and what scrolls up under it fades out there
const FRAME: Frame = {inset: HEADER_HEIGHT, fadeFrom: 0, fadeTo: 14, handoff: 0}
// The list's tiles: three to a row in the card on desktop
const TILE_SIZE = 104

// The photos in the map's area, beside the map on desktop: a glass card
// that floats over the map's right edge (phones have a sheet: AreaSheet)
export function AreaPanel({
	onPeek,
	...props
}: {
	scope?: Scope
	onClearScope: () => void
	unlocated: number
	// The photo under the pointer, so the map can point at it too
	onPeek: (id: string | undefined) => void
}) {
	return (
		<section
			className='umbrel-material flex h-full flex-col overflow-hidden rounded-[20px] bg-black/35'
			onPointerOver={(event) =>
				onPeek((event.target as Element).closest<HTMLElement>('[data-item-id]')?.dataset.itemId)
			}
			onPointerLeave={() => onPeek(undefined)}
		>
			<AreaList {...props} />
		</section>
	)
}

// On phones, the list is a sheet over the map's foot: the List button's, or a
// spot's for as long as it is open. It rests over the lower half of the map,
// drawn up it fills the room under the bar (its photos scroll on under the
// dock), and swiped down past that it is put away, the map the map again
export function AreaSheet({
	open,
	onClose,
	detents,
	topInset,
	...props
}: {
	open: boolean
	onClose: () => void
	detents: readonly Detent[]
	// Where the full sheet stops: under the bar, which names the area
	topInset: number
	scope?: Scope
	onClearScope: () => void
	unlocated: number
}) {
	const {t} = useTranslation()
	return (
		<DetentSheet
			open={open}
			onOpenChange={(next) => !next && onClose()}
			detents={detents}
			topInset={topInset}
			aria-label={t(props.scope ? 'photos-map.this-spot' : 'photos-map.in-view')}
			className='umbrel-material bg-black/45'
		>
			<AreaList {...props} />
		</DetentSheet>
	)
}

function AreaList({scope, onClearScope, unlocated}: {scope?: Scope; onClearScope: () => void; unlocated: number}) {
	const {t, i18n} = useTranslation()
	const filter = useRouteFilter()
	const {section} = usePhotosView()
	// The previous area's photos stay up while the next area's arrive, so
	// the list changes in one step as the map settles
	const {items, total, isLoading, hasMore, loadMore} = useItems(filter, {
		enabled: filter.bounds !== undefined,
		keepPrevious: true,
	})
	// The bar names the area and counts it; a spot the list is narrowed to
	// says so here, with the way back to the whole area
	const formattedCount = scope ? formatNumberI18n({n: scope.count, showDecimals: false, locale: i18n.language}) : ''

	return (
		<>
			{scope && (
				<header className='flex shrink-0 items-center gap-3 px-4 pt-3 pb-1'>
					<div className='min-w-0 flex-1'>
						<h2 className='truncate text-15 leading-tight font-semibold -tracking-2 text-white/90'>
							{t('photos-map.this-spot')}
						</h2>
						<p className='mt-0.5 truncate text-12 leading-tight -tracking-2 text-white/50'>
							<CountText
								text={t('photos-actions.item-count', {count: scope.count, formattedCount})}
								number={formattedCount}
							/>
						</p>
					</div>
					<button
						type='button'
						onClick={onClearScope}
						aria-label={t('photos-map.clear-spot')}
						className='flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20 hover:text-white'
					>
						<X className='size-3.5' />
					</button>
				</header>
			)}
			<div className='relative min-h-0 flex-1 px-3'>
				{isLoading && items.length === 0 ? (
					<div className='flex h-full items-center justify-center'>
						<TbLoader className='size-5 animate-spin opacity-50' />
					</div>
				) : items.length === 0 ? (
					<div className='flex h-full flex-col items-center justify-center gap-1 px-6 pb-10 text-center'>
						<p className='text-13 font-medium text-white/70'>{t('photos-map.nothing-here')}</p>
						<p className='text-12 text-white/40'>{t('photos-map.nothing-here-hint')}</p>
					</div>
				) : (
					<>
						<TimelineGrid
							items={items}
							total={total}
							filter={filter}
							hasMore={hasMore}
							loadMore={loadMore}
							frame={FRAME}
							inDeleted={false}
							tileSize={TILE_SIZE}
							footer={
								unlocated > 0 ? (
									<p className='text-12 text-white/35'>
										{t('photos-map.unlocated', {
											count: unlocated,
											formattedCount: formatNumberI18n({n: unlocated, showDecimals: false, locale: i18n.language}),
										})}
									</p>
								) : undefined
							}
						/>
						{/* The date at the top of the list, pinned where its own header row would be */}
						<p
							className='pointer-events-none absolute inset-x-3 top-0 flex items-end pb-2 text-17 leading-none font-semibold text-white/90 [text-shadow:0_1px_2px_rgb(0_0_0/0.5)]'
							style={{height: HEADER_HEIGHT}}
						>
							{section}
						</p>
					</>
				)}
			</div>
		</>
	)
}
