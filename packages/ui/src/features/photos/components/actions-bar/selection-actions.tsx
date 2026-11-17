import {Album, Check, CircleMinus, Download, Heart, Plus, RotateCcw, Trash2} from 'lucide-react'
import {useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate, useParams} from 'react-router-dom'

import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {PillButton, PillButtonGroup, PillButtonGroupItem} from '@/components/ui/edge-controls'
import {toast} from '@/components/ui/toast'
import {useRouteFilter} from '@/features/photos/components/listing'
import {usePhotosSelection} from '@/features/photos/components/selection-context'
import {useDownloadItems, useItemActions, useItems} from '@/features/photos/hooks/use-items'
import {useAlbumActions, useAlbums} from '@/features/photos/hooks/use-library'
import {useLargerText} from '@/hooks/use-accessibility'
import {cn} from '@/lib/utils'
import {useConfirmation} from '@/providers/confirmation/use-confirmation'
import {useLinkToDialog} from '@/utils/dialog'
import {formatNumberI18n} from '@/utils/number'
import {useBreakpoint} from '@/utils/tw'

// What the actions bar offers while items are selected: add to an album (in
// an album: remove from it), favorite, download, delete — or in Deleted,
// restore and delete for good — and Done. Deleting for good asks first;
// the rest just happen. Actions that leave the items in place (favorite,
// download) keep the selection — Done ends it — while the others end it
// themselves. They wait while a Select all is still gathering the view. Below xl the actions share one pill as icons with tooltips
// (with labels they only just fit a 1100px window, and not a 1024px one,
// and on a phone they would crowd the count out); with larger text, below 2xl.
export function SelectionActions({inDeleted}: {inDeleted: boolean}) {
	const {t, i18n} = useTranslation()
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()
	const confirm = useConfirmation()
	const breakpoint = useBreakpoint()
	const largerText = useLargerText()
	const iconOnly = !(breakpoint === '2xl' || (breakpoint === 'xl' && largerText === 0))
	const {ids, done, selectingAll} = usePhotosSelection()
	const {albumId} = useParams()
	const {setFavorite, deleteItems, restoreItems, deletePermanently} = useItemActions()
	const download = useDownloadItems()
	const {addToAlbum, removeFromAlbum} = useAlbumActions()
	const {data: albums} = useAlbums({enabled: !inDeleted && !albumId})
	// The selected items themselves, from the list on screen (the same query,
	// so nothing is fetched twice), for what favoriting them should do
	const {items} = useItems(useRouteFilter())
	const allFavorites = useMemo(
		() => ids.size > 0 && items.every((item) => !ids.has(item.id) || item.isFavorite),
		[items, ids],
	)
	const count = ids.size
	const formattedCount = formatNumberI18n({n: count, showDecimals: false, locale: i18n.language})
	const list = () => [...ids]
	const failed = () => toast.error(t('photos-selection.failed'), {area: 'photos'})

	// The heart pops when the user favorites, not whenever it happens to be
	// filled: armed by the click, disarmed as soon as the selection isn't all favorites
	const [pop, setPop] = useState(false)
	if (pop && !allFavorites) setPop(false)
	const favorite = () => {
		setPop(!allFavorites)
		return setFavorite({ids: list(), favorite: !allFavorites}).catch(failed)
	}
	const save = () => download(list()).catch(failed)
	const add = (albumId: string, albumName: string) =>
		addToAlbum({id: albumId, ids: list()})
			.then(() => {
				toast.success(t('photos-selection.added-to-album', {count, formattedCount, album: albumName}), {area: 'photos'})
				done()
			})
			.catch(failed)
	const removeFromThisAlbum = () => removeFromAlbum({id: albumId!, ids: list()}).then(done).catch(failed)
	// A delete or a restore carries on past what the server cannot move (a
	// photo in a read-only cloud folder, say): done all the same, and told how
	// many were left where they were
	const leftBehind = (failed: string[]) =>
		formatNumberI18n({n: failed.length, showDecimals: false, locale: i18n.language})
	const notDeleted = ({failed}: {failed: string[]}) => {
		done()
		if (failed.length === 0) return
		toast.error(t('photos-selection.not-deleted', {count: failed.length, formattedCount: leftBehind(failed)}), {
			area: 'photos',
		})
	}
	const notRestored = ({failed}: {failed: string[]}) => {
		done()
		if (failed.length === 0) return
		toast.error(t('photos-selection.not-restored', {count: failed.length, formattedCount: leftBehind(failed)}), {
			area: 'photos',
		})
	}
	const remove = () => deleteItems({ids: list()}).then(notDeleted).catch(failed)
	const restore = () => restoreItems({ids: list()}).then(notRestored).catch(failed)
	const purge = async () => {
		const ok = await confirm({
			title: t('photos-selection.delete-permanently-title', {count, formattedCount}),
			message: t('photos-selection.delete-permanently-message', {count}),
			actions: [
				{label: t('photos-item.delete-permanently'), value: 'delete', variant: 'destructive'},
				{label: t('cancel'), value: 'cancel', variant: 'default'},
			],
		}).then(
			(result) => result.actionValue === 'delete',
			() => false,
		)
		if (!ok) return
		deletePermanently({ids: list()}).then(notDeleted).catch(failed)
	}

	// Nothing to act on — or not all of it yet: a Select all is still loading
	// the rest of the view, and an action now would take only what has arrived
	const none = count === 0 || selectingAll
	const actions = inDeleted ? (
		<>
			<ActionPill
				icon={RotateCcw}
				label={t('photos-item.restore')}
				iconOnly={iconOnly}
				disabled={none}
				onClick={restore}
			/>
			<ActionPill
				icon={Trash2}
				label={t('photos-item.delete-permanently')}
				iconOnly={iconOnly}
				disabled={none}
				onClick={purge}
			/>
		</>
	) : (
		<>
			{albumId ? (
				<ActionPill
					icon={CircleMinus}
					label={t('photos-item.remove-from-album')}
					iconOnly={iconOnly}
					disabled={none}
					onClick={removeFromThisAlbum}
				/>
			) : (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<ActionPill icon={Album} label={t('photos-item.add-to-album')} iconOnly={iconOnly} disabled={none} />
					</DropdownMenuTrigger>
					<DropdownMenuContent align='end'>
						<DropdownMenuItem onSelect={() => navigate(linkToDialog('photos-create-album'))}>
							<Plus className='mr-2 size-4' />
							{t('photos-selection.new-album')}
						</DropdownMenuItem>
						{albums && albums.length > 0 && <DropdownMenuSeparator />}
						{albums?.map((album) => (
							<DropdownMenuItem key={album.id} onSelect={() => add(album.id, album.name)}>
								{album.name}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			)}
			<ActionPill
				icon={Heart}
				label={allFavorites ? t('photos-item.unfavorite') : t('photos-item.favorite')}
				labelSlot={
					<SwapLabel labels={[t('photos-item.favorite'), t('photos-item.unfavorite')]} active={allFavorites ? 1 : 0} />
				}
				iconOnly={iconOnly}
				disabled={none}
				onClick={favorite}
				className={cn(
					'[&>svg]:fill-current [&>svg]:transition-[fill-opacity] [&>svg]:duration-200 motion-reduce:[&>svg]:transition-none',
					allFavorites ? '[&>svg]:[fill-opacity:1]' : '[&>svg]:[fill-opacity:0]',
					allFavorites && pop && 'motion-safe:[&>svg]:animate-[umbrel-photos-pop_300ms_ease-out]',
				)}
			/>
			<ActionPill
				icon={Download}
				label={t('photos-item.download')}
				iconOnly={iconOnly}
				disabled={none}
				onClick={save}
			/>
			<ActionPill icon={Trash2} label={t('photos-item.delete')} iconOnly={iconOnly} disabled={none} onClick={remove} />
		</>
	)
	// On a phone even Done is a glyph — the count would be crowded out again
	const phone = breakpoint === 'sm'
	return (
		<>
			{iconOnly ? <PillButtonGroup>{actions}</PillButtonGroup> : actions}
			{phone ? (
				<PillButton icon={Check} aria-label={t('done')} onClick={done} />
			) : (
				<PillButton icon={Check} onClick={done}>
					{t('done')}
				</PillButton>
			)}
		</>
	)
}

// Two labels for one control, crossfading in place; the control's width
// eases from one label's to the other's, so its neighbours slide over
// rather than jump. Measured from the labels themselves, so it holds for
// any translation.
function SwapLabel({labels, active}: {labels: [string, string]; active: 0 | 1}) {
	const first = useRef<HTMLSpanElement>(null)
	const second = useRef<HTMLSpanElement>(null)
	const [width, setWidth] = useState<number>()
	const [one, two] = labels
	useLayoutEffect(() => {
		setWidth((active === 0 ? first : second).current?.offsetWidth)
	}, [active, one, two])
	return (
		<span
			className='relative block h-[1lh] transition-[width] duration-200 ease-out motion-reduce:transition-none'
			style={{width}}
		>
			{labels.map((label, index) => (
				<span
					key={index}
					ref={index === 0 ? first : second}
					aria-hidden={index !== active}
					className={cn(
						'absolute top-0 left-0 whitespace-nowrap transition-opacity duration-200 motion-reduce:transition-none',
						index !== active && 'opacity-0',
					)}
				>
					{label}
				</span>
			))}
		</span>
	)
}

// An action: its own labelled pill, or an icon with a tooltip in the shared
// one. `labelSlot` renders in place of the label when it needs to be more
// than text (the label stays for the tooltip and accessible name).
function ActionPill({
	icon,
	label,
	labelSlot,
	iconOnly,
	ref,
	...props
}: React.ComponentProps<'button'> & {
	icon: ComponentType<{className?: string}>
	label: string
	labelSlot?: ReactNode
	iconOnly: boolean
}) {
	if (!iconOnly)
		return (
			<PillButton ref={ref} icon={icon} aria-label={labelSlot ? label : undefined} {...props}>
				{labelSlot ?? label}
			</PillButton>
		)
	return (
		<DarkTooltip label={label} side='bottom'>
			<PillButtonGroupItem ref={ref} icon={icon} aria-label={label} className='min-w-9' {...props} />
		</DarkTooltip>
	)
}
