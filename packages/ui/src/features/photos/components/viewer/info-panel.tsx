import {Camera, MessageSquareText, X} from 'lucide-react'
import {lazy, Suspense} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {materialSurfaceClasses} from '@/components/ui/shared/material'
import {useHomePath} from '@/features/files/hooks/use-home-path'
import {useNavigate as useFilesNavigate} from '@/features/files/hooks/use-navigate'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {LocationCard} from '@/features/photos/components/map/location-card'
import {SourceIcon} from '@/features/photos/components/sources/source-icon'
import {timeAgo} from '@/features/photos/components/sources/source-status'
import {BASE_ROUTE_PATH, sectionPath, sourcePath} from '@/features/photos/constants'
import type {ItemDetail} from '@/features/photos/hooks/use-items'
import {usePhotoSource} from '@/features/photos/hooks/use-photo-sources'
import {takenAtClock} from '@/features/photos/utils/taken-at'
import {cn} from '@/lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {capitalizeDate} from '@/utils/date-time'
import {formatNumberI18n} from '@/utils/number'
import {tw} from '@/utils/tw'

// The folder drawn the way Files' path bar draws it (icons and carets), as
// the cloud dialogs do; Files' icon set is loaded only when a panel opens
const FolderBreadcrumbs = lazy(() =>
	import('@/features/photos/components/viewer/folder-breadcrumb-scroller').then((m) => ({
		default: m.FolderBreadcrumbScroller,
	})),
)

function formatDuration(ms: number) {
	const total = Math.round(ms / 1000)
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// Everything about the item, the way a camera roll's inspector tells it:
// when, then the file, then the camera and how it was set, then which albums
// — each a way into that view of the library — and where the file came from.
// (The "where" and "who" facts return with People/Locations, cut from v1.)
// Motion is the caller's (it docks or slides this in); the panel itself is
// still. As the phone's sheet (`sheet`, see InfoSheet) it rises from the
// bottom under a grabber, dragged rather than closed with a button — the
// button stays for screen readers and keyboards, shown once focused — or, in
// a short landscape window, stands at the right with its close button. The
// sheet measures the panel (`panelRef`, `scrollRef`, `contentRef`) to be as
// tall as what it says.
export function InfoPanel({
	item,
	showing,
	onClose,
	sheet,
	panelRef,
	scrollRef,
	contentRef,
}: {
	item: ItemDetail
	// Whether it is out: the caller keeps it mounted when it is put away
	showing: boolean
	onClose: () => void
	sheet?: 'bottom' | 'side'
	panelRef?: React.Ref<HTMLElement>
	scrollRef?: React.Ref<HTMLDivElement>
	contentRef?: React.Ref<HTMLDivElement>
}) {
	const {t, i18n} = useTranslation()
	const navigate = useNavigate()
	const {revealItem, navigateToDirectory} = useFilesNavigate()
	const utils = trpcReact.useUtils()
	const homePath = useHomePath()
	// This Umbrel goes by the account's name, as in the sidebar
	const {source} = usePhotoSource(item.source.id)
	// When the photo was taken, at the wall clock it was taken by — the
	// capture-time zone when the file carried it, the browser's otherwise
	const clock = takenAtClock(item.takenAt, item.takenAtOffsetMinutes)
	// The subKind is the finer truth about what this is, when there is one
	const kindLabel = item.subKind
		? {
				live: t('photos-item.kind-live'),
				panorama: t('photos-item.kind-panorama'),
				screenshot: t('photos-item.kind-screenshot'),
				spherical: t('photos-item.kind-spherical'),
			}[item.subKind]
		: {
				photo: t('photos-item.kind-photo'),
				video: t('photos-item.kind-video'),
			}[item.kind]
	const megapixels = formatNumberI18n({n: (item.width * item.height) / 1e6, showDecimals: true, locale: i18n.language})
	const extension = item.fileName.slice(item.fileName.lastIndexOf('.') + 1).toUpperCase()
	const folder = item.path.slice(0, item.path.lastIndexOf('/')) || '/'
	const cameraName = [item.exif?.make, item.exif?.model].filter(Boolean).join(' ')
	const exposure = [
		{value: item.exif?.focalLength, label: t('photos-item.exif-focal')},
		{value: item.exif?.aperture, label: t('photos-item.exif-aperture')},
		{value: item.exif?.exposure, label: t('photos-item.exif-shutter')},
		{value: item.exif?.iso === undefined ? undefined : String(item.exif.iso), label: t('photos-item.exif-iso')},
	].filter((fact): fact is {value: string; label: string} => fact.value !== undefined)
	const hasCameraMetadata = Boolean(cameraName || item.exif?.lens || exposure.length > 0)

	return (
		<section
			ref={panelRef}
			aria-label={t('photos-item.info')}
			className={cn(
				materialSurfaceClasses.modal,
				'flex h-full flex-col overflow-hidden',
				sheet === 'bottom' && 'rounded-b-none',
			)}
		>
			<div className={cn('flex items-center justify-between gap-3 px-5 pb-1', sheet === 'bottom' ? 'pt-6' : 'pt-4')}>
				<p className='text-15 font-semibold -tracking-2'>{t('photos-item.info')}</p>
				<button
					type='button'
					aria-label={t('close')}
					onClick={onClose}
					className={cn(
						'-mr-1.5 rounded-full p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white',
						sheet === 'bottom' && 'sr-only focus-visible:not-sr-only',
					)}
				>
					<X className='size-4' />
				</button>
			</div>
			{/* The scroller and, inside it, the content at its natural height (what
			    the sheet measures); the foot clears whatever floats over it */}
			<div
				ref={scrollRef}
				className={cn('umbrel-hide-scrollbar min-h-0 flex-1 overflow-y-auto', sheet && 'overscroll-contain')}
			>
				<div ref={contentRef} className='flex flex-col gap-4 px-5 pt-2 pb-[calc(1.25rem+var(--sheet-inset,0px))]'>
					{/* When it was taken, on the clock it was taken by */}
					<div>
						<p className='text-15 font-semibold -tracking-2 text-white/95'>
							{capitalizeDate(
								clock.date.toLocaleDateString(i18n.language, {dateStyle: 'full', timeZone: clock.timeZone}),
								i18n.language,
							)}
						</p>
						<p className='text-12 text-white/55'>
							{clock.date.toLocaleTimeString(i18n.language, {timeStyle: 'short', timeZone: clock.timeZone})}
							{clock.gmt && <span className='text-white/35'> · {clock.gmt}</span>}
						</p>
					</div>

					{/* The file */}
					<div className={cardClass}>
						<div className='flex items-center gap-2'>
							<span className='shrink-0 rounded-full bg-white/12 px-2 py-0.5 text-11 font-medium text-white/85'>
								{kindLabel}
							</span>
							<p className='min-w-0 truncate text-13 font-medium' title={item.fileName}>
								{item.fileName}
							</p>
						</div>
						<p className='mt-1.5 text-12 text-white/55 tabular-nums'>
							{[
								t('photos-item.megapixels', {value: megapixels}),
								`${item.width} × ${item.height}`,
								item.durationMs !== undefined && formatDuration(item.durationMs),
								formatFilesystemSize(item.sizeBytes),
								extension,
							]
								.filter(Boolean)
								.join(' · ')}
						</p>
					</div>

					{/* The camera and how it was set */}
					{hasCameraMetadata && (
						<div className={cardClass}>
							<div className='flex items-center gap-2.5'>
								<Camera className='size-4 shrink-0 text-white/70' />
								<div className='min-w-0'>
									{cameraName && <p className='truncate text-13 font-medium'>{cameraName}</p>}
									{item.exif?.lens && <p className='truncate text-12 text-white/55'>{item.exif.lens}</p>}
								</div>
							</div>
							{exposure.length > 0 && (
								<dl className='mt-3 grid grid-cols-4 gap-2'>
									{/* Term first for the reader, value first for the eye */}
									{exposure.map(({value, label}) => (
										<div key={label} className='flex min-w-0 flex-col-reverse'>
											<dt className='truncate text-11 text-white/45'>{label}</dt>
											<dd className='truncate text-13 font-medium tabular-nums'>{value}</dd>
										</div>
									))}
								</dl>
							)}
						</div>
					)}

					{item.exif?.userComment && (
						<div className={cn(cardClass, 'flex items-start gap-2.5')}>
							<MessageSquareText className='mt-0.5 size-4 shrink-0 text-white/70' />
							<p className='min-w-0 flex-1 text-13 [overflow-wrap:anywhere] whitespace-pre-wrap text-white/85'>
								{item.exif.userComment}
							</p>
						</div>
					)}

					{/* Where it was taken — and the way to every other photo taken
					    around it */}
					{item.location && (
						<Facts label={t('photos-item.fact-place')}>
							<LocationCard
								item={item}
								lat={item.location.lat}
								lng={item.location.lng}
								altitude={item.location.altitude}
								showing={showing}
								onOpen={() => navigate(`${sectionPath('map')}?lat=${item.location!.lat}&lng=${item.location!.lng}`)}
							/>
						</Facts>
					)}

					{/* Which albums: each a way in */}
					{item.albums.length > 0 && (
						<Facts label={t('photos-item.fact-albums')}>
							{item.albums.map((album) => (
								<Chip key={album.id} onClick={() => navigate(`${BASE_ROUTE_PATH}/albums/${album.id}`)}>
									{album.name}
								</Chip>
							))}
						</Facts>
					)}

					{/* Where it came from */}
					<Facts label={t('photos-item.fact-source')}>
						<Chip
							icon={<SourceIcon type={item.source.type} size={14} />}
							onClick={() => navigate(sourcePath(item.source.id))}
						>
							{source?.name ?? item.source.name}
						</Chip>
						<p className='w-full text-11 text-white/40'>
							{t('photos-item.imported-ago', {when: timeAgo(item.importedAt, i18n.language)})}
						</p>
					</Facts>
					<button
						type='button'
						// The folder with the file selected, as the Recents widget does it —
						// via the real Files item so the selection carries its allowed
						// operations; if it can't be resolved (moved, deleted), just the folder
						onClick={() =>
							utils.files.status
								.fetch({path: item.path})
								.then(revealItem)
								.catch(() => navigateToDirectory(folder))
						}
						className='flex w-full items-center gap-2.5 rounded-xl bg-white/6 px-3 py-2.5 text-left transition-colors hover:bg-white/10'
					>
						{/* The Files app's own icon, as in the dock */}
						<img src='/assets/dock/dock-files.webp' alt='' className='size-7 shrink-0 rounded-[7px]' />
						<div className='min-w-0 flex-1'>
							<span className='block text-12 text-white/55'>{t('photos-item.show-in-files')}</span>
							<div className='mt-0.5 text-13'>
								<Suspense fallback={<span className='block truncate'>{folder}</span>}>
									<FolderBreadcrumbs path={folder} homePath={homePath} />
								</Suspense>
							</div>
						</div>
					</button>
				</div>
			</div>
		</section>
	)
}

const cardClass = tw`rounded-xl bg-white/6 p-3`

function Facts({label, children}: {label: string; children: React.ReactNode}) {
	return (
		<div>
			<p className='mb-1.5 text-12 text-white/50'>{label}</p>
			<div className='flex flex-wrap gap-1.5'>{children}</div>
		</div>
	)
}

function Chip({
	icon,
	title,
	onClick,
	children,
}: {
	icon?: React.ReactNode
	title?: string
	onClick: () => void
	children: React.ReactNode
}) {
	return (
		<button
			type='button'
			title={title}
			onClick={onClick}
			className='flex max-w-full items-center gap-1.5 rounded-full bg-white/8 px-2.5 py-1 text-12 text-white/90 transition-colors hover:bg-white/14'
		>
			{icon}
			<span className='truncate'>{children}</span>
		</button>
	)
}
