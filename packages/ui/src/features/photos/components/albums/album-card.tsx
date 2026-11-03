import {MoreHorizontal} from 'lucide-react'
import {useTranslation} from 'react-i18next'
import {useLocation, useNavigate} from 'react-router-dom'

import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {contextMenuClasses} from '@/components/ui/shared/menu'
import {toast} from '@/components/ui/toast'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {ALBUM_STYLES, albumStyleId, fontSpec, formatAlbumDates} from '@/features/photos/components/albums/album-style'
import {useCoverTone} from '@/features/photos/components/albums/use-cover-tone'
import {ItemThumbnail} from '@/features/photos/components/listing/item-thumbnail'
import {usePhotosSelection} from '@/features/photos/components/selection-context'
import {BASE_ROUTE_PATH} from '@/features/photos/constants'
import {useAlbumActions, type Album} from '@/features/photos/hooks/use-library'
import {useFontReady} from '@/hooks/use-font-ready'
import {cn} from '@/lib/utils'
import {useConfirmation} from '@/providers/confirmation/use-confirmation'
import {useLinkToDialog} from '@/utils/dialog'
import {formatNumberI18n} from '@/utils/number'

// An album as a cover with its name set in the album's own face and tinted
// with the cover's own colour, and when its photos were taken beneath. Sizes
// itself from its container (the grid and the sidebar share it), so the
// caller only picks an aspect ratio. The caption appears together with the
// cover, once its font and colour are settled, so nothing swaps in view.
export function AlbumCard({
	album,
	className,
	isActive,
	onClick,
}: {
	album: Album
	className?: string
	isActive?: boolean
	onClick: () => void
}) {
	const {t, i18n} = useTranslation()
	const navigate = useNavigate()
	const {pathname} = useLocation()
	const linkToDialog = useLinkToDialog()
	const {deleteAlbum} = useAlbumActions()
	const confirm = useConfirmation()
	const selection = usePhotosSelection()
	const isTouchDevice = useIsTouchDevice()
	const style = ALBUM_STYLES[albumStyleId(album.id)]
	const fontReady = useFontReady(fontSpec(style), album.name)
	const {tone, ready: toneReady, onLoad} = useCoverTone(Boolean(album.coverId))
	// An empty album has no dates to show — say so, rather than nothing
	const dates =
		album.count === 0 ? t('photos-album.no-items') : formatAlbumDates(album.takenFrom, album.takenTo, i18n.language)
	const count = t('photos-collections.count', {
		count: album.count,
		formattedCount: formatNumberI18n({n: album.count, showDecimals: false, locale: i18n.language}),
	})

	const rename = () => navigate(linkToDialog('photos-rename-album', {id: album.id}))
	// Opens the album with cover-picking on: the next item clicked is the cover
	const changeCover = () => selection.coverFor(album.id)
	// The photos stay in the library, but the album's selection can't be brought back
	const remove = async () => {
		const result = await confirm({
			title: t('photos-album.delete-title', {album: album.name}),
			message: t('photos-album.delete-message'),
			actions: [
				{label: t('photos-album.delete'), value: 'delete', variant: 'destructive'},
				{label: t('cancel'), value: 'cancel', variant: 'default'},
			],
		}).catch(() => undefined)
		if (result?.actionValue !== 'delete') return
		try {
			await deleteAlbum({id: album.id})
			// The album's own page has nothing left to show
			if (pathname.startsWith(`${BASE_ROUTE_PATH}/albums/${album.id}`)) navigate(`${BASE_ROUTE_PATH}/albums`)
		} catch {
			toast.error(t('photos-album.delete-failed'), {area: 'photos'})
		}
	}

	return (
		// `group` (and the hover lift above neighbours) lives on this wrapper
		// so hovering the options button still counts as hovering the card
		<div className='group relative motion-safe:hover:z-10'>
			<button
				type='button'
				onClick={onClick}
				aria-label={[album.name, dates, count].filter(Boolean).join(', ')}
				aria-current={isActive ? 'page' : undefined}
				className={cn(
					// Clipped with clip-path on the card's own layer, not overflow-hidden:
					// an antialiased overflow clip is applied to the cover and the scrim
					// as separate draws, and the double-attenuated edge pixels let the
					// cover glow through as a bright rim around the tinted corners
					'@container relative isolate block w-full transform-gpu rounded-24 bg-white/6 text-left shadow-lg ring-1 ring-white/10 outline-hidden [clip-path:inset(0_round_24px)] ring-inset',
					'focus-visible:ring-2 focus-visible:ring-white/60',
					// Lifts a touch on hover, gives under the pointer while pressed
					'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out motion-safe:group-hover:scale-[1.02] motion-safe:active:scale-[0.99] motion-safe:active:duration-100',
					isActive && 'ring-white/40',
					className,
				)}
			>
				{/* Cover and scrim share this one scaling layer, so the rounded clip
			    masks them as a unit — clipping them as separate draws lets the
			    cover's antialiased edge glow through the scrim as a bright rim */}
				<div
					aria-hidden
					// Hover: the cover drifts in like a slow camera push (10s, steady),
					// settling at 1.3×; leaving snaps it back in a third of a second
					className='pointer-events-none absolute inset-0 motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out motion-safe:group-hover:scale-[1.3] motion-safe:group-hover:duration-[10s] motion-safe:group-hover:ease-linear'
				>
					{album.coverId && (
						<ItemThumbnail item={{id: album.coverId}} loading='lazy' onLoad={onLoad} className='absolute inset-0' />
					)}
					{/* The scrim: the cover's own colour under the caption, as dark as legibility needs */}
					<span aria-hidden className='absolute inset-x-0 bottom-0 h-[55%]' style={{background: tone.scrim}} />
				</div>
				{/* The settings cards' edge material, in the caption's own colour — drawn
			    over everything, since an inset shine under the cover would be hidden */}
				<span
					aria-hidden
					className={cn(
						'pointer-events-none absolute inset-0 rounded-24 transition-opacity duration-300',
						toneReady ? 'opacity-100' : 'opacity-0',
					)}
					style={{
						boxShadow: [
							`0 1px 0 color-mix(in srgb, ${tone.tint ?? 'white'} 10%, transparent) inset`,
							`0 0.5px 0 color-mix(in srgb, ${tone.tint ?? 'white'} 3.3%, transparent) inset`,
							`0 -1px 0 color-mix(in srgb, ${tone.tint ?? 'white'} 5%, transparent) inset`,
						].join(', '),
						border: `0.1px solid color-mix(in srgb, ${tone.tint ?? 'white'} 4%, transparent)`,
					}}
				/>
				<span
					className={cn(
						'absolute inset-x-0 bottom-0 flex flex-col px-[clamp(12px,6.5cqw,18px)] pb-[clamp(11px,5.5cqw,16px)] transition-opacity duration-300',
						fontReady && toneReady ? 'opacity-100' : 'opacity-0',
					)}
				>
					<span
						className='font-synthesis-none line-clamp-2 leading-[1.1] text-pretty transition-colors duration-300'
						style={{
							fontFamily: style.family,
							fontWeight: style.weight,
							fontStyle: style.italic ? 'italic' : undefined,
							textTransform: style.uppercase ? 'uppercase' : undefined,
							letterSpacing: style.tracking,
							fontSize: `calc(clamp(15px, 9cqw, 26px) * ${style.scale})`,
							color: tone.tint ?? 'white',
						}}
					>
						{album.name}
					</span>
					{dates && (
						<span
							className='text-[clamp(11px,5cqw,13px)] leading-tight font-medium opacity-60 transition-colors duration-300'
							style={{color: tone.tint ?? 'white'}}
						>
							{dates}
						</span>
					)}
				</span>
			</button>
			{/* The album's menu: appears with the hover — always there on touch,
				    which has no hover to summon it with */}
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type='button'
						aria-label={t('photos-album.options')}
						// Dressed in the card's own tone: the dots in the caption's
						// colour over a faded wash of the scrim's shade.
						// pointer-events follows visibility: an invisible corner must
						// not swallow a touch tap (keyboard activation is unaffected)
						className={cn(
							'absolute top-2 right-2 z-10 flex size-7 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--album-shade)_55%,transparent)] outline-hidden transition-opacity duration-200 hover:bg-[color-mix(in_srgb,var(--album-shade)_75%,transparent)] focus-visible:ring-2 focus-visible:ring-white/60',
							// Touch has no hover to summon it with, so it is simply there
							isTouchDevice
								? 'opacity-100'
								: 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100',
						)}
						style={{['--album-shade' as string]: tone.shade, color: tone.tint ?? 'white'}}
					>
						<MoreHorizontal className='size-4' />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end'>
					<DropdownMenuItem onSelect={rename}>{t('photos-album.rename')}</DropdownMenuItem>
					{/* An empty album has no items to be its cover */}
					<DropdownMenuItem disabled={album.count === 0} onSelect={changeCover}>
						{t('photos-album.change-cover')}
					</DropdownMenuItem>
					<DropdownMenuItem className={contextMenuClasses.item.rootDestructive} onSelect={remove}>
						{t('photos-album.delete')}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	)
}
