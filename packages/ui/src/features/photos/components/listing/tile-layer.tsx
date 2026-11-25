import {useState, type MouseEvent, type ReactNode, type Ref, type SyntheticEvent} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate, useParams} from 'react-router-dom'

import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {contextMenuClasses} from '@/components/ui/shared/menu'
import {toast} from '@/components/ui/toast'
import {SELECT_CIRCLE} from '@/features/photos/components/listing/item-tile'
import {usePhotosSelection} from '@/features/photos/components/selection-context'
import {useDownloadItems, useItemActions, type Item} from '@/features/photos/hooks/use-items'
import {useAlbumActions, useAlbums} from '@/features/photos/hooks/use-library'
import {usePeopleActions} from '@/features/photos/hooks/use-people'
import type {SearchMoment} from '@/features/search/types'
import {useConfirmation} from '@/providers/confirmation/use-confirmation'
import {useLinkToDialog} from '@/utils/dialog'
import {formatNumberI18n} from '@/utils/number'

// The layer the grid's tiles live in. Opening a tile, selecting it and its
// context menu are handled here, once for the whole grid, by looking up
// which tile an event came from — so a tile itself is just a picture, and
// mounting a hundred of them at a new zoom stop costs no more than the DOM
// they add.
//
// A click opens the tile, unless it lands on the tile's selection circle or
// the grid is in selection mode, when it selects instead. Below the seam the
// tiles are cells of a canvas rather than elements, so the same handler finds
// them through `itemAtPoint` instead — same branches, same behaviour, one
// lookup swapped for another. The context menu
// offers what the selection bar does, in its order, and acts on the whole
// selection when it is opened over a selected tile. While items are being
// picked for an album it keeps to what can't disturb the picking: favorite
// and download.
export function TileLayer({
	ref,
	items,
	inDeleted,
	selecting,
	selected,
	itemAtPoint,
	moments,
	onSelect,
	children,
}: {
	ref: Ref<HTMLDivElement>
	// The mounted items, by id
	items: Map<string, Item>
	inDeleted: boolean
	selecting: boolean
	selected: ReadonlySet<string>
	// Which item a point is over, where tiles are not elements
	itemAtPoint?: (point: {clientX: number; clientY: number}) => Item | undefined
	// Items a search matched at a moment of a video, by id: they open there
	moments?: ReadonlyMap<string, SearchMoment>
	// `range` extends the selection from the last selected tile (shift held)
	onSelect: (item: Item, range: boolean) => void
	children: ReactNode
}) {
	const {t, i18n} = useTranslation()
	const confirm = useConfirmation()
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()
	const {setFavorite, deleteItems, restoreItems, deletePermanently} = useItemActions()
	const download = useDownloadItems()
	const {addToAlbum, removeFromAlbum, setCover} = useAlbumActions()
	const selection = usePhotosSelection()
	const {albumId, personId} = useParams()
	const {setPersonCover, removeFromPerson} = usePeopleActions()
	const {data: albums} = useAlbums({enabled: !inDeleted && !albumId})
	// The tile the context menu is about
	const [target, setTarget] = useState<Item | null>(null)
	// … and the items its actions apply to: the selection, when it is one of them
	const ids = target ? (selected.has(target.id) ? [...selected] : [target.id]) : []
	const act = (action: Promise<unknown>) =>
		action.catch(() => toast.error(t('photos-selection.failed'), {area: 'photos'}))
	const add = (album: {id: string; name: string}) =>
		act(
			addToAlbum({id: album.id, ids}).then(() => {
				const count = ids.length
				const formattedCount = formatNumberI18n({n: count, showDecimals: false, locale: i18n.language})
				toast.success(t('photos-selection.added-to-album', {count, formattedCount, album: album.name}), {
					area: 'photos',
				})
			}),
		)
	// The new-album dialog takes its items from the selection, so these become it
	const createAlbumWith = () => {
		selection.set(ids)
		navigate(linkToDialog('photos-create-album'))
	}
	// Cover mode ends on the first choice: this item becomes the album's face,
	// or the photo a person's face is taken from
	const commitCover = (item: Item) => {
		const target = selection.coveringFor
		if (!target) return
		// A face is taken from a photo: given a video, the server would quietly
		// pick another photo of the person and call the cover changed
		if (target.kind === 'person' && item.kind === 'video') return
		selection.coverChosen()
		act(
			target.kind === 'album'
				? setCover({id: target.id, itemId: item.id})
				: setPersonCover({id: target.id, itemId: item.id}),
		)
	}
	const open = (item: Item) => {
		const momentMs = moments?.get(item.id)?.startMs
		navigate(linkToDialog('photos-item', momentMs === undefined ? {id: item.id} : {id: item.id, t: String(momentMs)}))
	}
	const purge = async () => {
		const count = ids.length
		const formattedCount = formatNumberI18n({n: count, showDecimals: false, locale: i18n.language})
		const result = await confirm({
			title: t('photos-selection.delete-permanently-title', {count, formattedCount}),
			message: t('photos-selection.delete-permanently-message', {count}),
			actions: [
				{label: t('photos-item.delete-permanently'), value: 'delete', variant: 'destructive'},
				{label: t('cancel'), value: 'cancel', variant: 'default'},
			],
		}).catch(() => undefined)
		if (result?.actionValue === 'delete') act(deletePermanently({ids}))
	}

	const tileFrom = (event: SyntheticEvent) => (event.target as Element).closest<HTMLElement>('[data-item-id]')
	const itemFrom = (event: SyntheticEvent & {clientX: number; clientY: number}) => {
		const id = tileFrom(event)?.dataset.itemId
		return (id ? items.get(id) : undefined) ?? itemAtPoint?.(event)
	}
	// A pointer click in the tile's selection corner (the circle is a
	// pseudo-element, so this is geometry) — only where the circle can be
	// seen, i.e. where hovering exists (touch has the Select button); a
	// keyboard click (detail 0) opens
	const onCircle = (event: MouseEvent, tile: HTMLElement) => {
		if (event.detail === 0 || !matchMedia('(hover: hover)').matches) return false
		const rect = tile.getBoundingClientRect()
		const x = event.clientX - rect.left
		const y = event.clientY - rect.top
		return (
			rect.width >= SELECT_CIRCLE.minTile && x >= 0 && y >= 0 && x < SELECT_CIRCLE.hitSize && y < SELECT_CIRCLE.hitSize
		)
	}

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					ref={ref}
					className='absolute inset-0'
					onClick={(event) => {
						const tile = tileFrom(event)
						const item = itemFrom(event)
						if (!item) return
						// Choosing a cover: the first click is the choice
						if (selection.coveringFor) return commitCover(item)
						// The selection circle needs a 72px tile, bigger than any the
						// canvas draws, so a canvas tile never has one to hit
						if (selecting || (tile && onCircle(event, tile))) onSelect(item, event.shiftKey)
						else open(item)
					}}
					onContextMenuCapture={(event) => {
						const item = itemFrom(event)
						// Empty space between tiles has no menu: keep the event from the trigger
						if (item) setTarget(item)
						else event.stopPropagation()
					}}
				>
					{children}
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				{target &&
					(selection.coveringFor ? (
						<ContextMenuItem
							disabled={selection.coveringFor.kind === 'person' && target.kind === 'video'}
							onClick={() => commitCover(target)}
						>
							{selection.coveringFor.kind === 'person' ? t('photos-people.set-cover') : t('photos-item.set-cover')}
						</ContextMenuItem>
					) : selection.pickingFor ? (
						<>
							<ContextMenuItem onClick={() => act(setFavorite({ids, favorite: !target.isFavorite}))}>
								{target.isFavorite ? t('photos-item.unfavorite') : t('photos-item.favorite')}
							</ContextMenuItem>
							<ContextMenuItem onClick={() => act(download(ids))}>{t('photos-item.download')}</ContextMenuItem>
						</>
					) : inDeleted ? (
						<>
							<ContextMenuItem onClick={() => act(restoreItems({ids}))}>{t('photos-item.restore')}</ContextMenuItem>
							<ContextMenuItem className={contextMenuClasses.item.rootDestructive} onClick={purge}>
								{t('photos-item.delete-permanently')}
							</ContextMenuItem>
						</>
					) : (
						<>
							<ContextMenuItem onClick={() => act(setFavorite({ids, favorite: !target.isFavorite}))}>
								{target.isFavorite ? t('photos-item.unfavorite') : t('photos-item.favorite')}
							</ContextMenuItem>
							{personId && (
								<>
									{ids.length === 1 && target.kind !== 'video' && (
										<ContextMenuItem
											onClick={() =>
												act(
													setPersonCover({id: personId, itemId: target.id}).then(() =>
														toast.success(t('photos-people.cover-set'), {area: 'photos'}),
													),
												)
											}
										>
											{t('photos-people.set-cover')}
										</ContextMenuItem>
									)}
									<ContextMenuItem onClick={() => act(removeFromPerson({id: personId, ids}))}>
										{t('photos-people.not-this-person')}
									</ContextMenuItem>
									<ContextMenuSeparator />
								</>
							)}
							{albumId ? (
								<>
									{/* The cover is one item's; the whole selection has no single face */}
									{ids.length === 1 && (
										<ContextMenuItem
											onClick={() =>
												act(
													setCover({id: albumId, itemId: target.id}).then(() =>
														toast.success(t('photos-item.cover-set'), {area: 'photos'}),
													),
												)
											}
										>
											{t('photos-item.set-cover')}
										</ContextMenuItem>
									)}
									<ContextMenuItem onClick={() => act(removeFromAlbum({id: albumId, ids}))}>
										{t('photos-item.remove-from-album')}
									</ContextMenuItem>
								</>
							) : (
								<ContextMenuSub>
									<ContextMenuSubTrigger>{t('photos-item.add-to-album')}</ContextMenuSubTrigger>
									<ContextMenuSubContent>
										<ContextMenuItem onClick={createAlbumWith}>{t('photos-selection.new-album')}</ContextMenuItem>
										{albums && albums.length > 0 && <ContextMenuSeparator />}
										{albums?.map((album) => (
											<ContextMenuItem key={album.id} onClick={() => add(album)}>
												{album.name}
											</ContextMenuItem>
										))}
									</ContextMenuSubContent>
								</ContextMenuSub>
							)}
							<ContextMenuItem onClick={() => act(download(ids))}>{t('photos-item.download')}</ContextMenuItem>
							<ContextMenuSeparator />
							<ContextMenuItem
								className={contextMenuClasses.item.rootDestructive}
								onClick={() => act(deleteItems({ids}))}
							>
								{t('photos-item.delete')}
							</ContextMenuItem>
						</>
					))}
			</ContextMenuContent>
		</ContextMenu>
	)
}
