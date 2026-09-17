import {ChevronDown, Upload} from 'lucide-react'
import {AnimatePresence, motion} from 'motion/react'
import {lazy, Suspense, useEffect, useRef, useState} from 'react'
import {RiCloseCircleFill} from 'react-icons/ri'
import {useNavigate, useSearchParams} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {Progress} from '@/components/ui/progress'
import {transfers} from '@/features/files/transfers/transfers'
import {isTerminalTransferState} from '@/features/files/transfers/types'
import {useTransferItem} from '@/features/files/transfers/use-transfers'
import type {FileSystemItem} from '@/features/files/types'
import {CatalogIntro} from '@/features/machines/components/os-catalog-intro'
import {OsIcon, OsIconGlow} from '@/features/machines/components/os-icon'
import {layoutMorphTransition, MACHINES_CONFIGURE_PATH} from '@/features/machines/constants'
import {useOsImages} from '@/features/machines/hooks/use-machines'
import type {OsImage} from '@/features/machines/types'
import {prettyMb} from '@/features/machines/utils'
import {useGlobalFiles} from '@/providers/global-files'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

const MiniBrowser = lazy(() =>
	import('@/features/files/components/mini-browser').then((m) => ({default: m.MiniBrowser})),
)

// Custom disks are restricted to raw images until structured formats can be
// converted in a sandbox that cannot follow references into the host filesystem.
const DISK_IMAGE_ACCEPT = '.iso,.img'
const isDiskImagePath = (path: string) => /\.(iso|img)$/i.test(path)

type CatalogImage = OsImage

// An OS in the catalog: one card per family, potentially several
// downloadable variants (e.g. Ubuntu Desktop / Ubuntu Server)
type OsFamily = {
	key: string
	familyId: string
	name: string
	version: string
	platform: 'linux' | 'windows'
	images: CatalogImage[]
}

function groupOsImages(osImages: CatalogImage[]): OsFamily[] {
	const families: OsFamily[] = []
	const byKey = new Map<string, OsFamily>()
	for (const image of osImages) {
		const key = image.familyId
		let family = byKey.get(key)
		if (!family) {
			family = {
				key,
				familyId: image.familyId,
				name: image.name,
				version: image.version,
				platform: image.platform!,
				images: [],
			}
			byKey.set(key, family)
			families.push(family)
		}
		family.images.push(image)
	}
	return families
}

// Curated shelves rather than kernel taxonomy: the headline systems most
// people come for lead in a fixed order (and alternate artwork colors),
// everything else follows in catalog order.
const POPULAR_FAMILY_IDS = ['ubuntu', 'debian', 'windows-11', 'android']

// The first-run pitch is a one-time moment per session: once the user commits
// past it, remounts of this component (navigating to configure and back with
// zero machines) go straight to the catalog. A page reload re-pitches, which
// is correct — it's still a first run until a machine exists.
let introDismissedThisSession = false

// Pure OS picker: select a catalog entry or provide a local image, then move
// directly to machine settings. Download/cache state stays internal to create.
// Doubles as the first-time UX (when no machines exist) and the "+" add page.
// With `intro`, a first-run pitch (the wall of waking monitors) shows first
// and morphs into this catalog on commit via the shared icon layoutIds.
export default function OsCatalog({intro: introRequested = false}: {intro?: boolean}) {
	const {osImages, isLoading} = useOsImages()
	const [searchParams] = useSearchParams()
	const families = groupOsImages(osImages)
	const popularFamilies = POPULAR_FAMILY_IDS.flatMap((id) => families.filter((family) => family.familyId === id))
	const moreFamilies = families.filter((family) => !POPULAR_FAMILY_IDS.includes(family.familyId))

	// ?intro=1 forces the pitch on any catalog mount, for previewing it without
	// deleting every machine (and bypassing the session dismissal below)
	const introForced = searchParams.get('intro') === '1'
	// Committing past the pitch is remembered for the whole session (module
	// scope), so navigating back — e.g. Cancel on the configure page while no
	// machine exists yet — returns to the catalog, not the pitch again
	const [introDismissed, setIntroDismissed] = useState(introForced ? false : introDismissedThisSession)
	const introActive = (introRequested || introForced) && !introDismissed
	// True while the intro→catalog handoff choreography plays, then cleared so
	// its bespoke delays never leak into ordinary catalog reflows
	const [introHandoff, setIntroHandoff] = useState(false)
	useEffect(() => {
		if (!introHandoff) return
		const timer = setTimeout(() => setIntroHandoff(false), 1_800)
		return () => clearTimeout(timer)
	}, [introHandoff])

	if (introActive) {
		// Hold on a blank card rather than flashing catalog skeletons under the pitch
		if (isLoading) return <div className='min-h-[420px]' />
		// Desktop shows the whole catalog on the wall; phones keep only a curated
		// recognizable spread (hidden via CSS below md) so the pile stays a
		// single-glance composition there.
		const MOBILE_WALL_IDS = ['ubuntu', 'debian', 'android', 'omarchy', 'windows-11', 'custom', 'alpine', 'windows-xp']
		const entries = [
			...[...popularFamilies, ...moreFamilies].map((family) => ({
				id: family.familyId,
				name: family.name,
				onMobileWall: MOBILE_WALL_IDS.includes(family.familyId),
			})),
			{id: 'custom', name: t('machines.custom-machine'), onMobileWall: true},
		]
		return (
			<CatalogIntro
				entries={entries}
				onCommit={() => {
					introDismissedThisSession = true
					setIntroDismissed(true)
					setIntroHandoff(true)
				}}
			/>
		)
	}

	return (
		<div className='flex flex-col gap-8 px-4 py-6 md:p-12'>
			{isLoading ? (
				<>
					{/* Placeholder groups mirror the amd64 catalog — the fullest — with
					    More counting its six families plus the Custom machine card. The
					    catalog's arch mix isn't knowable before data arrives, so smaller
					    (arm64) catalogs briefly over-reserve rather than jumping taller. */}
					<SkeletonCatalogGroup count={4} />
					<SkeletonCatalogGroup count={7} />
				</>
			) : (
				<>
					<CatalogGroup title={t('machines.catalog-popular')} families={popularFamilies} introMorph={introHandoff} />
					{/* The custom-image flow lives as the last card of More, a peer of the
					    catalog systems rather than a separate section */}
					<CatalogGroup
						title={t('machines.catalog-more')}
						families={moreFamilies}
						withCustomMachine
						introMorph={introHandoff}
					/>
				</>
			)}
		</div>
	)
}

function CatalogGroup({
	title,
	families,
	withCustomMachine,
	introMorph,
}: {
	title: string
	families: OsFamily[]
	withCustomMachine?: boolean
	introMorph?: boolean
}) {
	if (families.length === 0 && !withCustomMachine) return null
	return (
		<section className='flex flex-col gap-3'>
			{/* During the intro handoff the headers arrive last, once the monitors
			    have landed and their cards have materialized */}
			<motion.h2
				initial={introMorph ? {opacity: 0, y: 6} : false}
				animate={{opacity: 1, y: 0}}
				transition={{delay: 0.55, duration: 0.4, ease: 'easeOut'}}
				className='text-17 font-semibold -tracking-2 text-white/85'
			>
				{title}
			</motion.h2>
			<OsCardGrid families={families} withCustomMachine={withCustomMachine} introMorph={introMorph} />
		</section>
	)
}

const catalogGridClass = tw`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4`

// The card is split into a shell (layout, spacing) and a fill layer (surface,
// border, hover tint, and the clipped glow) so the intro handoff can fade the
// surface in beneath a monitor that is still gliding into place — an icon
// nested in a fading card would be invisible for most of its flight, and a
// clipping shell would crop it mid-glide. Interactive content must sit in a
// positioned wrapper (e.g. `relative`) to paint and click above the fill.
const osCardClass = tw`group relative flex flex-col items-center gap-4 rounded-24 p-4 pt-6 md:p-6`
// settings-edge-material: same card surface as the Settings page tiles
const osCardFillClass = tw`settings-edge-material absolute inset-0 overflow-hidden rounded-24 bg-white/5`

// The intro→catalog handoff glide: monitors stream into their tiles one after
// another on a long, decisive curve
const introGlideTransition = (index: number) => ({
	layout: {duration: 0.8, ease: [0.32, 0.72, 0, 1] as [number, number, number, number], delay: 0.05 + index * 0.05},
})

// Loading placeholder for a catalog group. Mirrors CatalogGroup's structure exactly
// (same section gap, header text metrics, grid, and card box) so it occupies the same
// height as the real group — swapping one for the other can't shift the layout.
function SkeletonCatalogGroup({count}: {count: number}) {
	return (
		<section className='flex flex-col gap-3'>
			{/* Same text-17 strut as the real <h2>, so the header row is exactly as tall */}
			<div className='text-17 font-semibold -tracking-2'>
				<span className='umbrel-pulse inline-block h-[0.7em] w-20 rounded-full bg-white/8 align-middle' />
			</div>
			<div className={catalogGridClass}>
				{Array.from({length: count}).map((_, i) => (
					<SkeletonOsCard key={i} />
				))}
			</div>
		</section>
	)
}

// A plain pulsing rounded rectangle. It still nests OsCard's exact internal
// structure — invisible — purely to derive the same height at every breakpoint,
// so swapping in the real card can't shift the layout.
function SkeletonOsCard() {
	return (
		<div className='umbrel-pulse settings-edge-material flex flex-col items-center gap-4 rounded-24 bg-white/5 p-4 pt-6 md:p-6'>
			<div aria-hidden className='invisible flex flex-col items-center gap-2.5'>
				<div className='size-24' />
				<div className='flex flex-col items-center gap-1'>
					<div className='text-17'>&nbsp;</div>
					<div className='text-13'>&nbsp;</div>
					<div className='text-11'>&nbsp;</div>
				</div>
			</div>
			<div aria-hidden className='invisible h-[30px]' />
		</div>
	)
}

function OsCardGrid({
	families,
	withCustomMachine,
	introMorph,
}: {
	families: OsFamily[]
	withCustomMachine?: boolean
	introMorph?: boolean
}) {
	return (
		<div className={catalogGridClass}>
			<AnimatePresence mode='popLayout' initial={true}>
				{families.map((family, i) => (
					<OsCard key={family.key} family={family} index={i} introMorph={introMorph} />
				))}
				{withCustomMachine && (
					<CustomMachineCard key='custom-machine' index={families.length} introMorph={introMorph} />
				)}
			</AnimatePresence>
		</div>
	)
}

// Shared shell for every catalog tile: the layered shell/fill/content
// structure and its intro-handoff timing lanes live here once. `action` fills
// the bottom slot; further children (hidden inputs, dialogs) mount inside the
// shell without a visual slot.
function CatalogCard({
	osId,
	index,
	introMorph,
	title,
	subtitle,
	action,
	children,
}: {
	osId: string
	index: number
	introMorph?: boolean
	title: string
	subtitle: string
	action: React.ReactNode
	children?: React.ReactNode
}) {
	// Two timing lanes for the intro handoff: the card surface materializes
	// beneath the gliding monitor, then copy and actions settle after it lands
	const surfaceTransition = introMorph
		? {delay: 0.2 + index * 0.05, duration: 0.5, ease: 'easeOut' as const}
		: {delay: index * 0.02, duration: 0.2, ease: 'easeOut' as const}
	const contentTransition = introMorph
		? {delay: 0.45 + index * 0.05, duration: 0.4, ease: 'easeOut' as const}
		: surfaceTransition

	return (
		<motion.div
			// Cards glide to their new grid spot when a sibling appears/disappears.
			// The shell itself never mount-fades — its fill and content layers do —
			// so the layoutId icon inside stays visible while gliding in from the
			// first-run intro wall.
			layout='position'
			initial={false}
			exit={{opacity: 0}}
			transition={{duration: 0.2, ease: 'easeOut', ...layoutMorphTransition}}
			className={osCardClass}
		>
			<motion.div
				aria-hidden
				initial={{opacity: 0}}
				animate={{opacity: 1}}
				transition={surfaceTransition}
				className={osCardFillClass}
			>
				{/* Hover affordance: the surface stays put — the machine's glow leans
				    in and its monitor grows just a touch */}
				<OsIconGlow
					osId={osId}
					className='top-5 left-1/2 size-24 -translate-x-1/2 transition-opacity duration-500 group-hover:opacity-70'
				/>
			</motion.div>
			{/* relative: paints (and clicks) above the absolutely-positioned fill */}
			<div className='relative flex flex-col items-center gap-2.5'>
				{/* layoutId receives the first-run intro wall's monitor at commit, so
				    it glides into this card instead of popping in */}
				<motion.div
					layoutId={`catalog-icon-${osId}`}
					initial={introMorph ? false : {opacity: 0}}
					animate={{opacity: 1}}
					transition={introMorph ? introGlideTransition(index) : {...layoutMorphTransition, opacity: surfaceTransition}}
				>
					{/* Scale via CSS on the img, not the motion wrapper — framer owns
					    the wrapper's inline transform during the layoutId glide */}
					<OsIcon osId={osId} className='size-24 transition-transform duration-300 group-hover:scale-[1.05]' />
				</motion.div>
				{/* The monitor's reflection off the card surface: a mirrored copy
				    fading downward behind the copy (the copy wrapper below is
				    `relative` so it always paints above). Fades in on the content
				    beat so an intro-morph glide lands on a bare card first. */}
				<motion.div
					aria-hidden
					initial={{opacity: 0}}
					animate={{opacity: 1}}
					transition={contentTransition}
					className='pointer-events-none absolute top-24 left-1/2 h-14 w-24 -translate-x-1/2'
				>
					{/* Mirrors the icon's hover scale. Origin sits 48px down — the
					    mirrored icon center — so the reflection grows away from the
					    contact line exactly as the monitor grows toward it */}
					<div className='origin-[50%_48px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)] opacity-[0.08] blur-[2px] transition-transform duration-300 group-hover:scale-[1.05]'>
						<OsIcon osId={osId} className='size-24 -scale-y-100' />
					</div>
				</motion.div>
				<motion.div
					initial={{opacity: 0, y: introMorph ? 6 : 0}}
					animate={{opacity: 1, y: 0}}
					transition={contentTransition}
					className='relative flex flex-col items-center gap-1 text-center'
				>
					<div className='text-17 font-medium -tracking-2 text-white'>{title}</div>
					<div className='text-13 -tracking-2 text-white/40'>{subtitle}</div>
				</motion.div>
			</div>
			<motion.div
				initial={{opacity: 0}}
				animate={{opacity: 1}}
				transition={contentTransition}
				className='relative flex w-full flex-col items-center'
			>
				{action}
			</motion.div>
			{children}
		</motion.div>
	)
}

function OsCard({family, index, introMorph}: {family: OsFamily; index: number; introMorph?: boolean}) {
	return (
		<CatalogCard
			osId={family.familyId}
			index={index}
			introMorph={introMorph}
			title={family.name}
			subtitle={family.version}
			action={<OsCardAction family={family} />}
		/>
	)
}

// Both dropdown-flavored cards share the same trigger: label left, chevron
// right, matching the fixed width of the single-build size buttons
function CreateMachineMenuTrigger() {
	return (
		<DropdownMenuTrigger asChild>
			<Button size='md' className='group min-w-44 justify-between whitespace-nowrap'>
				{t('machines.install')}
				<ChevronDown className='-mr-1 size-3.5 opacity-50 transition-transform duration-200 group-data-[state=open]:rotate-180' />
			</Button>
		</DropdownMenuTrigger>
	)
}

const variantHint = (variantName?: string) => {
	if (variantName === 'Desktop') return t('machines.variant-gui')
	if (variantName === 'Server') return t('machines.variant-cli')
	return undefined
}

function OsCardAction({family}: {family: OsFamily}) {
	const navigate = useNavigate()
	const goToConfigure = (osId: string) => navigate(`${MACHINES_CONFIGURE_PATH}?os=${osId}`)

	// Single-build OSs get plain buttons, with the installed size tucked in on
	// the right (variant families surface per-variant sizes in their dropdown)
	if (family.images.length === 1) {
		const image = family.images[0]
		return (
			<Button size='md' className='min-w-44 justify-between whitespace-nowrap' onClick={() => goToConfigure(image.id)}>
				{t('machines.install')}
				<span className='text-11 -tracking-2 text-white/35 tabular-nums'>
					{prettyMb(image.estimatedInstalledSizeMb ?? image.sizeMb)}
				</span>
			</Button>
		)
	}

	// Multiple variants (e.g. Desktop / Server): the button opens a picker
	return (
		<DropdownMenu>
			<CreateMachineMenuTrigger />
			{/* p-1: match the homescreen context menu's tight padding */}
			<DropdownMenuContent align='center' className='w-56 p-1'>
				{family.images.map((image) => (
					<DropdownMenuItem key={image.id} className='gap-3' onSelect={() => goToConfigure(image.id)}>
						<div className='flex min-w-0 flex-1 flex-col gap-0.5'>
							<span>{image.variantName ?? image.name}</span>
							{variantHint(image.variantName) && (
								<span className='text-11 -tracking-2 text-white/40'>{variantHint(image.variantName)}</span>
							)}
						</div>
						<span className='shrink-0 text-11 -tracking-2 text-white/40 tabular-nums'>
							{prettyMb(image.estimatedInstalledSizeMb ?? image.sizeMb)}
						</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

// === Custom machine: bring your own installer or disk image ===

// The last card of the More shelf — the custom flow is a peer of the catalog
// systems. Create machine opens a two-source picker: upload an image (via the
// shared Files uploader, with inline progress in the card) or select one
// already in Files.
function CustomMachineCard({index, introMorph}: {index: number; introMorph?: boolean}) {
	const navigate = useNavigate()
	const {startUpload} = useGlobalFiles()
	const inputRef = useRef<HTMLInputElement>(null)
	const [browserOpen, setBrowserOpen] = useState(false)
	// The queued upload this card follows, by its stable id
	const [uploadId, setUploadId] = useState<string | null>(null)
	const upload = useTransferItem(uploadId)

	useEffect(() => {
		if (!uploadId) return
		// Gone from the queue (its batch retired, or the session ended): nothing to follow
		if (!upload) return setUploadId(null)
		if (upload.state === 'completed') {
			setUploadId(null)
			// The stored path, which a "Keep both" resolution renames
			navigate(`${MACHINES_CONFIGURE_PATH}?iso=${encodeURIComponent(upload.resultPath ?? upload.path)}`)
			return
		}
		// Cancelled, skipped or failed (the transfers island explains): reset the card
		if (isTerminalTransferState(upload.state)) setUploadId(null)
	}, [upload, uploadId, navigate])

	// Only a queued or streaming upload can be cancelled; once every byte has
	// left the browser the queue refuses, and the card keeps following the
	// upload to its actual end
	const cancellable = uploadId !== null && transfers.isCancellable(uploadId)
	const handleCancel = () => {
		if (uploadId && transfers.cancel(uploadId)) setUploadId(null)
	}

	return (
		<CatalogCard
			osId='custom'
			index={index}
			introMorph={introMorph}
			title={t('machines.custom-machine')}
			subtitle={t('machines.custom-image-title')}
			action={
				upload ? (
					<div className='flex h-[30px] w-full items-center gap-2 text-13 font-medium -tracking-2 text-white/75'>
						<span className='max-w-[40%] truncate'>{upload.name}</span>
						<Progress value={upload.progress} className='flex-1' />
						{cancellable && (
							<DarkTooltip label={t('cancel')}>
								<button
									className='shrink-0 opacity-50 transition-[opacity,transform] duration-200 hover:opacity-90 active:scale-90'
									onClick={handleCancel}
									aria-label={t('cancel')}
								>
									<RiCloseCircleFill className='size-4' />
								</button>
							</DarkTooltip>
						)}
					</div>
				) : (
					<DropdownMenu>
						<CreateMachineMenuTrigger />
						{/* p-1: match the homescreen context menu's tight padding */}
						<DropdownMenuContent align='center' className='w-64 p-1'>
							<DropdownMenuItem className='gap-2.5' onSelect={() => inputRef.current?.click()}>
								<Upload className='size-4 shrink-0 opacity-60' />
								{t('machines.upload-iso-description')}
							</DropdownMenuItem>
							<DropdownMenuItem className='gap-2.5' onSelect={() => setBrowserOpen(true)}>
								<img src='/assets/dock/dock-files.webp' alt='' className='size-4 shrink-0 rounded-[4px]' />
								{t('files-action.browse-in-files')}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				)
			}
		>
			<input
				ref={inputRef}
				type='file'
				accept={DISK_IMAGE_ACCEPT}
				className='hidden'
				onChange={(e) => {
					const selected = e.target.files?.[0]
					e.target.value = ''
					if (!selected) return
					const [id] = startUpload([selected], '/Home')
					setUploadId(id ?? null)
				}}
			/>
			{browserOpen && (
				<Suspense>
					<MiniBrowser
						open={browserOpen}
						onOpenChange={setBrowserOpen}
						rootPath='/Home'
						preselectOnOpen={false}
						selectionMode='files-and-folders'
						selectableFilter={(entry: FileSystemItem) => isDiskImagePath(entry.path)}
						onSelect={(path) => navigate(`${MACHINES_CONFIGURE_PATH}?iso=${encodeURIComponent(path)}`)}
						title={t('machines.browse-iso-title')}
						selectButtonLabel={t('machines.browse-iso-select')}
					/>
				</Suspense>
			)}
		</CatalogCard>
	)
}
