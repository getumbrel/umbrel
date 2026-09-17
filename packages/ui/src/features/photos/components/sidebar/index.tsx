// Placeholder icons: swapped for the real Photos icon set later
import {
	Album,
	ChevronRight,
	GalleryHorizontalEnd,
	Globe,
	Heart,
	Image,
	RectangleHorizontal,
	ScanLine,
	Trash2,
	Video,
	type LucideIcon,
} from 'lucide-react'
import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {useState, type ComponentProps} from 'react'
import {useTranslation} from 'react-i18next'
import {IoLogoAndroid, IoLogoApple} from 'react-icons/io5'
import {useLocation, useNavigate} from 'react-router-dom'

import {FadeScroller} from '@/components/fade-scroller'
import {Button} from '@/components/ui/button'
import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/components/ui/context-menu'
import {contextMenuClasses} from '@/components/ui/shared/menu'
import {AlbumCard} from '@/features/photos/components/albums/album-card'
import {LivePhotoIcon} from '@/features/photos/components/live-photo-icon'
import {usePhotosSelection} from '@/features/photos/components/selection-context'
import {EnrichmentIndicator} from '@/features/photos/components/sidebar/enrichment-indicator'
import {SidebarItem} from '@/features/photos/components/sidebar/sidebar-item'
import {SourceItem} from '@/features/photos/components/sidebar/source-item'
import {SourcesRootItem} from '@/features/photos/components/sidebar/sources-root-item'
import {SourceIcon} from '@/features/photos/components/sources/source-icon'
import {useRemoveSource} from '@/features/photos/components/sources/use-remove-source'
import {BASE_ROUTE_PATH, sectionPath, sourcePath, type PhotosSection} from '@/features/photos/constants'
import {useAlbums} from '@/features/photos/hooks/use-library'
import {usePhoneSourceConnected, usePhotoSources, type PhotoSource} from '@/features/photos/hooks/use-photo-sources'
import {cn} from '@/lib/utils'
import {useLinkToDialog} from '@/utils/dialog'

type Item = {section: PhotosSection; label: string; icon: LucideIcon | typeof LivePhotoIcon}

export function Sidebar({className}: {className?: string}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const {pathname} = useLocation()
	const {sources} = usePhotoSources()
	const linkToDialog = useLinkToDialog()
	const {remove} = useRemoveSource()
	const openDetails = (source: PhotoSource) => navigate(linkToDialog('photos-source', {id: source.id}))

	const libraryItems: Item[] = [
		{section: 'all', label: t('photos-sidebar.all'), icon: GalleryHorizontalEnd},
		{section: 'albums', label: t('photos-sidebar.albums'), icon: Album},
		{section: 'favorites', label: t('photos-sidebar.favorites'), icon: Heart},
		{section: 'photos', label: t('photos-sidebar.photos'), icon: Image},
		{section: 'videos', label: t('photos-sidebar.videos'), icon: Video},
		{section: 'deleted', label: t('photos-sidebar.deleted'), icon: Trash2},
	]

	// Smart collections, grouped under their own label like Files' Favorites.
	// People and Locations stay cut from v1 (no face/geo clustering yet) —
	// restore those two rows and their icons (Users, MapPin) when they return.
	const utilityItems: Item[] = [
		// {section: 'people', label: t('photos-sidebar.people'), icon: Users},
		// {section: 'locations', label: t('photos-sidebar.locations'), icon: MapPin},
		{section: 'live-photos', label: t('photos-sidebar.live-photos'), icon: LivePhotoIcon},
		{section: 'panoramas', label: t('photos-sidebar.panoramas'), icon: RectangleHorizontal},
		{section: 'screenshots', label: t('photos-sidebar.screenshots'), icon: ScanLine},
		{section: '360', label: t('photos-sidebar.spherical'), icon: Globe},
	]

	const renderItem = ({section, label, icon: Icon}: Item) => {
		const Component = section === 'deleted' ? DeletedItem : SidebarItem
		return (
			<Component
				key={section}
				label={label}
				icon={<Icon className='h-4 w-4' strokeWidth={1.75} />}
				isActive={pathname === sectionPath(section)}
				onClick={() => navigate(sectionPath(section))}
				// While media is still being prepared, the Library row carries the
				// progress ring — the whole library is what enrichment is filling
				trailing={section === 'all' ? <EnrichmentIndicator /> : undefined}
			/>
		)
	}

	return (
		<nav className={cn('flex min-h-0 flex-col', className)} aria-label={t('photos-sidebar.navigation')}>
			{/* Pulled left and padded back so an album card scaling up on hover isn't clipped by the scroll box's edge */}
			<FadeScroller
				direction='y'
				className='umbrel-hide-scrollbar h-full min-h-0 overflow-y-auto overscroll-contain lg:-ml-2 lg:pl-2'
			>
				<SidebarSection>{libraryItems.map(renderItem)}</SidebarSection>

				<SidebarDivider />
				{/* Sources root row (with "+" to add one), then this Umbrel itself and every device feeding the library */}
				<SidebarSection>
					<SourcesRootItem onAdd={() => navigate(linkToDialog('photos-add-source'))} />
					{sources.map((source) => (
						<ContextMenu key={source.id}>
							<ContextMenuTrigger asChild>
								<div>
									<SourceItem
										label={source.name}
										icon={<SourceIcon type={source.type} />}
										isActive={pathname === sourcePath(source.id)}
										onClick={() => navigate(sourcePath(source.id))}
										onOptions={() => openDetails(source)}
									/>
								</div>
							</ContextMenuTrigger>
							<ContextMenuContent>
								<ContextMenuItem onClick={() => openDetails(source)}>{t('photos-source.manage')}</ContextMenuItem>
								{source.type !== 'umbrel' && (
									<ContextMenuItem className={contextMenuClasses.item.rootDestructive} onClick={() => remove(source)}>
										{t('photos-source.remove')}
									</ContextMenuItem>
								)}
							</ContextMenuContent>
						</ContextMenu>
					))}
				</SidebarSection>
				<PhoneBackupCard />

				<SidebarDivider />
				<SidebarSection label={t('photos-sidebar.utilities')}>{utilityItems.map(renderItem)}</SidebarSection>

				<SidebarDivider />
				<AlbumsSection isActive={pathname === sectionPath('albums')} onClick={() => navigate(sectionPath('albums'))} />

				{/* Spacer */}
				<div className='h-6' />
			</FadeScroller>
		</nav>
	)
}

// Promo for the native app's automatic phone backup. It stays until a phone is
// backing up, then dissolves and closes its gap. A card under the pointer waits
// for the pointer to leave, so it never vanishes mid-read.
function PhoneBackupCard() {
	const {t} = useTranslation()
	const connected = usePhoneSourceConnected()
	const [hovering, setHovering] = useState(false)
	const reducedMotion = useReducedMotion()

	// The presence mounts once the answer is known: the first paint is a state,
	// not a transition, and only changes after that animate
	if (connected === undefined) return null

	const spring = {type: 'spring', duration: 0.35, bounce: 0} as const
	return (
		<AnimatePresence initial={false}>
			{(!connected || hovering) && (
				<motion.div
					key='phone-backup'
					onPointerEnter={() => setHovering(true)}
					onPointerLeave={() => setHovering(false)}
					initial={{opacity: 0, height: 0}}
					animate={{opacity: 1, height: 'auto'}}
					// Coming back: make room, then fade in. Leaving: fade out, then close the gap.
					transition={reducedMotion ? {duration: 0} : {height: spring, opacity: {duration: 0.25, delay: 0.1}}}
					exit={{
						opacity: 0,
						height: 0,
						transition: reducedMotion ? {duration: 0} : {opacity: {duration: 0.2}, height: {...spring, delay: 0.15}},
					}}
					className='overflow-hidden'
				>
					<div className='mt-4 mr-4 flex flex-col gap-3 rounded-20 bg-white/5 p-4'>
						{/* Served from public/ so Vite never inlines it as a data URI (blocked by the CSP) */}
						{/* Full-width phone, fading out so only its top half reads */}
						<div
							className='max-h-[200px] overflow-hidden'
							style={{
								maskImage: 'linear-gradient(to bottom, black 30%, transparent 100%)',
								WebkitMaskImage: 'linear-gradient(to bottom, black 30%, transparent 100%)',
							}}
						>
							<img src='/assets/photos/phone-backup.webp' alt='' className='w-full' draggable={false} />
						</div>
						<div className='flex flex-col gap-1'>
							<div className='text-15 leading-tight font-semibold text-white/90'>
								{t('photos-phone-backup.title')}{' '}
								<img
									src='/assets/photos/magic-sparkles.webp'
									alt=''
									className='inline-block h-auto w-4 align-[-0.125em]'
									draggable={false}
								/>
							</div>
							<div className='text-12 leading-snug text-white/50'>{t('photos-phone-backup.description')}</div>
						</div>
						<div className='flex flex-wrap gap-2'>
							<Button asChild variant='primary' size='sm'>
								<a href='https://link.umbrel.com/ios-app' target='_blank' rel='noopener noreferrer'>
									<IoLogoApple className='size-3.5' />
									{t('photos-phone-backup.ios')}
								</a>
							</Button>
							{/* Android app isn't out yet */}
							<Button size='sm' disabled>
								<IoLogoAndroid className='size-3.5' />
								{t('photos-phone-backup.android-coming-soon')}
							</Button>
						</div>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	)
}

// The most recently touched albums as cards, under a link to all of them
const SIDEBAR_ALBUMS = 4

function AlbumsSection({isActive, onClick}: {isActive: boolean; onClick: () => void}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const {pathname} = useLocation()
	const {data: albums} = useAlbums()
	const recent = [...(albums ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, SIDEBAR_ALBUMS)
	return (
		<section className='flex flex-col gap-2 pr-4' aria-label={t('photos-sidebar.albums')}>
			<button
				onClick={onClick}
				aria-current={isActive ? 'page' : undefined}
				className={cn(
					'flex items-center justify-between rounded-lg px-2 py-1 text-12 font-medium',
					isActive ? 'text-white' : 'text-white/40 hover:text-white/70',
				)}
			>
				{t('photos-sidebar.albums')}
				<ChevronRight className='h-3.5 w-3.5' />
			</button>
			<div className='flex flex-col gap-2'>
				{recent.map((album) => {
					const path = `${BASE_ROUTE_PATH}/albums/${album.id}`
					return (
						<AlbumCard
							key={album.id}
							album={album}
							className='aspect-[15/8]'
							isActive={pathname === path}
							onClick={() => navigate(path)}
						/>
					)
				})}
			</div>
		</section>
	)
}

const SidebarSection = ({children, label = ''}: {children: React.ReactNode; label?: string}) => {
	return (
		<section className='flex flex-col pr-4' aria-label={label}>
			{label && <div className='px-2 py-1 text-[11px] font-medium text-white/40'>{label}</div>}
			{children}
		</section>
	)
}

const SidebarDivider = () => {
	return (
		<div
			className='my-2.5 h-px w-full bg-[radial-gradient(35%_35%_at_35%_35%,rgba(255,255,255,0.35)_0%,transparent_70%)]'
			role='separator'
		/>
	)
}

// Deleted items can't go into an album, so the bin is out of reach while
// picking for one. Its own component, so only it — not the whole sidebar —
// re-renders as the selection changes.
function DeletedItem(props: Omit<ComponentProps<typeof SidebarItem>, 'disabled'>) {
	const picking = usePhotosSelection().pickingFor !== undefined
	return <SidebarItem {...props} disabled={picking} />
}
