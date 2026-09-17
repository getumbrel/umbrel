import {motion, useReducedMotion} from 'motion/react'
import {createContext, ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {IoLogoAndroid, IoLogoApple} from 'react-icons/io5'
import {RiCloseLine} from 'react-icons/ri'

import {AppIcon} from '@/components/app-icon'
import {Button} from '@/components/ui/button'
import {ButtonLink} from '@/components/ui/button-link'
import {DarkTooltip, darkTooltipClass} from '@/components/ui/dark-tooltip'
import {useStorefront} from '@/features/app-store/hooks/use-storefront'
import {
	AiThumbnail,
	AudioThumbnail,
	CsvThumbnail,
	DmgThumbnail,
	DocxThumbnail,
	EbookThumbnail,
	ExeThumbnail,
	ImageThumbnail,
	IsoThumbnail,
	PdfThumbnail,
	PptThumbnail,
	PsdThumbnail,
	TxtThumbnail,
	VideoThumbnail,
} from '@/features/files/assets/file-items-thumbnails'
import {ONBOARDING_COMPLETE_NOTIFICATION, useClearNotification} from '@/hooks/use-notifications'
import {useWidgets} from '@/hooks/use-widgets'
import {cn} from '@/lib/utils'
import {systemAppsKeyed} from '@/providers/apps'
import {useAvailableApps} from '@/providers/available-apps'
import {trpcReact, type RegistryApp} from '@/trpc/trpc'
import {focusRingOnWallpaperClass} from '@/utils/element-classes'
import {tw, useBreakpoint} from '@/utils/tw'

import {AppGrid} from './app-grid/app-grid'
import {desktopVariants, desktopWidgetNode, useDesktopVariant} from './desktop-content'
import {DockSpacer} from './dock'
import {Header} from './header'

const PHOTOS_ICON = '/assets/dock/dock-photos.webp'
const PHONE_BACKUP_SHOT = '/assets/photos/phone-backup.webp'

// Desktop for a fresh install with no apps yet: the usual greeting and the
// account's widgets, with a bento of starting points where the app grid would
// be. This is the first thing a user sees after onboarding.
export function WelcomeDesktop() {
	const userQ = trpcReact.user.get.useQuery()
	const name = userQ.data?.name
	// Members can't install apps: the App Store card runs wide with copy about
	// requesting apps from the owner, and the Tailscale card is dropped
	const isMember = userQ.data?.role === 'member'
	// The real selection (the defaults until changed), so the row carries over
	// unchanged when the welcome gives way to the desktop
	const widgets = useWidgets()
	// Dismissing clears the notification that gates this desktop. The bento
	// sees itself out first and the clear (optimistic, so the swap to the real
	// desktop is immediate) happens once it's gone, not before.
	const clearNotification = useClearNotification()
	const [dismissed, setDismissed] = useState(false)
	// Fades away under sheets and the widget editor like the real desktop; the
	// living illustrations pause while nothing can see them
	const variant = useDesktopVariant()
	const hidden = variant !== 'default'

	if (!name || widgets.isLoading) return null

	return (
		<motion.div
			className='relative z-10 flex min-h-[100dvh] w-full flex-col items-center'
			variants={desktopVariants}
			animate={variant}
			initial={{opacity: 0}}
			transition={{duration: 0.3, ease: 'easeOut'}}
		>
			<div className='pt-6 md:pt-8' />
			<Header userName={name} />
			<div className='pt-6 md:pt-8' />
			{/* Widgets paged by the same grid as the real desktop. Fixed height:
			    one widget row plus the page inset and paginator margins, from the vars the pager injects */}
			<div className='flex h-[calc(var(--widget-labeled-h,176px)+66px)] w-full overflow-hidden'>
				<AppGrid widgets={widgets.selected.map(desktopWidgetNode)} />
			</div>
			{/* The bento sits in the space between the widgets and the dock */}
			{!dismissed && (
				<WelcomeBento
					isMember={isMember}
					canShareFiles={!isMember || userQ.data?.sambaEnabled === true}
					paused={hidden}
					onDismissed={() => {
						setDismissed(true)
						clearNotification(ONBOARDING_COMPLETE_NOTIFICATION)
					}}
				/>
			)}
			<DockSpacer />
		</motion.div>
	)
}

type TipId = 'files' | 'photos' | 'app-store' | 'tailscale'
type TipOffsets = Partial<Record<TipId, {x: number; y: number}>>

// Closing a tip only hides it in this browser session: the notification behind
// the welcome desktop is cleared once every tip is closed (or by Dismiss all),
// so a refresh brings closed tips back.
//
// Every tip keeps its cell for good. A closed one stays on as an invisible
// ghost, so the grid's tracks (and with them every open card's size) never
// change; the cards still open glide, by transform alone, to where they sit
// centered as a group. Under md the tips are a plain stack and a closed one
// folds away instead.
type TipsContextValue = {
	closed: ReadonlySet<TipId>
	/** Where each open tip rests, relative to its own cell */
	offsets: TipOffsets
	/** Single-column stack: closed tips fold out of the flow */
	stacked: boolean
	/** Whether this render's changes come from a close (animate) or from the layout itself (snap) */
	animated: boolean
	/** The whole bento is leaving: set to the tip whose close button did it, or 'all' */
	dismissing: TipId | 'all' | null
	/** A tip's turn in the dismissal, in seconds */
	dismissDelay: (id: TipId) => number
	close: (id: TipId, viaKeyboard: boolean) => void
	registerCell: (id: TipId, el: HTMLElement | null) => void
	registerCloseButton: (id: TipId, el: HTMLButtonElement | null) => void
}
const TipsContext = createContext<TipsContextValue | null>(null)

// gap-4 between cards, mirrored here for the arranged positions
const TIP_GAP = 16
// Leaving is quick and quiet. The curve spends most of its change up front, so
// a closed card is as good as gone within a few frames and never holds up the
// neighbours gliding over its cell.
const SMOOTH_OUT = [0.22, 1, 0.36, 1] as const
const TIP_EXIT_S = 0.25
// ...while the fade itself eases off more gently, or the card would be gone
// before the eye caught which way it went
const tipExit = (delay = 0) =>
	({
		duration: TIP_EXIT_S,
		ease: SMOOTH_OUT,
		delay,
		opacity: {duration: TIP_EXIT_S, ease: [0.215, 0.61, 0.355, 1], delay},
	}) as const
// A closed card recedes toward the button that closed it (its center sits 22px
// in from the top right corner) while its content softens out of focus
const TIP_CLOSED = {opacity: 0, scale: 0.96}
const TIP_CLOSED_ORIGIN = 'calc(100% - 22px) 22px'
const TIP_EXIT_BLUR = 'blur(4px)'
// Dismissing everything undoes the entrance: the cards rose in one after
// another, and sink back last-in first-out, with far less travel than they
// arrived with
const TIP_DISMISSED = {opacity: 0, scale: 0.97, y: 12}
const TIP_DISMISS_STAGGER_S = 0.04
// The rest set off at once and settle without overshoot: these are large panes
// of glass, and any bounce reads as wobble. Critically damped and stiff enough
// to land in about 350ms; a spring, so closing a second tip mid-glide carries
// the motion on instead of restarting it.
const TIP_MOVE = {type: 'spring', stiffness: 300, damping: 34, mass: 1} as const
const TIP_FOLD = {duration: 0.35, ease: SMOOTH_OUT} as const
const TIP_SNAP = {duration: 0} as const

// Bento: Files runs wide across the top, Photos stands tall down the right,
// and App Store (a touch wider) with Tailscale fill in beneath Files. Each
// card leads with its feature icon and carries a small living illustration
// in a pool of its accent light.
function WelcomeBento({
	isMember,
	canShareFiles,
	paused,
	onDismissed,
}: {
	isMember: boolean
	/** File sharing is available to the owner and members with SMB access */
	canShareFiles: boolean
	/** Nothing can see the illustrations, so they hold still */
	paused: boolean
	/** The bento has seen itself out; time to clear the notification behind it */
	onDismissed: () => void
}) {
	const {t} = useTranslation()
	const {appsKeyed} = useAvailableApps()
	const deckCards = useDeckCards(appsKeyed)
	const tailscaleIcon = appsKeyed?.['tailscale']?.icon

	const tipIds = useMemo<TipId[]>(
		() => (isMember ? ['files', 'photos', 'app-store'] : ['files', 'photos', 'app-store', 'tailscale']),
		[isMember],
	)
	const [closed, setClosed] = useState<ReadonlySet<TipId>>(() => new Set())
	const breakpoint = useBreakpoint()
	const stacked = breakpoint === 'sm'
	const {cells, offsets} = useTipOffsets(closed, stacked ? 1 : breakpoint === 'md' ? 2 : 3)

	// Moves animate only on the render where a tip was closed; anything else
	// that shifts the arrangement (a resize, a breakpoint) is the layout itself
	// changing and lands instantly
	const reducedMotion = useReducedMotion()
	const settledClosed = useRef(closed)
	const [dismissing, setDismissing] = useState<TipId | 'all' | null>(null)
	const animated = (settledClosed.current !== closed || dismissing !== null) && !reducedMotion
	useEffect(() => {
		settledClosed.current = closed
	}, [closed])

	// Last in, first out
	const leaving = dismissing === 'all' ? tipIds.filter((tip) => !closed.has(tip)).reverse() : []
	const dismissDelay = (id: TipId) => Math.max(0, leaving.indexOf(id)) * TIP_DISMISS_STAGGER_S
	const dismissSeconds = reducedMotion ? 0 : TIP_EXIT_S + Math.max(0, leaving.length - 1) * TIP_DISMISS_STAGGER_S
	const onDismissedRef = useRef(onDismissed)
	onDismissedRef.current = onDismissed
	useEffect(() => {
		if (dismissing === null) return
		const timeout = setTimeout(() => onDismissedRef.current(), dismissSeconds * 1000)
		return () => clearTimeout(timeout)
	}, [dismissing, dismissSeconds])

	const closeButtons = useRef(new Map<TipId, HTMLButtonElement>())
	const close = (id: TipId, viaKeyboard: boolean) => {
		const open = tipIds.filter((tip) => tip !== id && !closed.has(tip))
		// Closing the last tip is dismissing the bento. The tip isn't marked
		// closed, so it leaves from where it rests rather than heading home.
		if (open.length === 0) return setDismissing(id)
		// A keyboard user carries on from the next tip's close button rather
		// than losing their place with the card
		if (viaKeyboard) {
			const next = tipIds.slice(tipIds.indexOf(id)).find((tip) => open.includes(tip)) ?? open[open.length - 1]
			closeButtons.current.get(next)?.focus()
		}
		setClosed(new Set(closed).add(id))
	}

	const tips: TipsContextValue = {
		closed,
		offsets,
		stacked,
		animated,
		dismissing,
		dismissDelay,
		close,
		registerCell: (id, el) => void (el ? cells.current.set(id, el) : cells.current.delete(id)),
		registerCloseButton: (id, el) => void (el ? closeButtons.current.set(id, el) : closeButtons.current.delete(id)),
	}

	return (
		// Nothing here fades as a whole: opacity on an ancestor would cut the cards
		// off from the wallpaper they blur, so every card sees itself out
		<div className='-mt-4 flex w-full flex-1 flex-col items-center gap-4 px-5 pb-5 md:pb-6' inert={dismissing !== null}>
			{/* Rows are content-sized and split any spare height equally, up to a cap
			    of 300px a row: the bento stretches a little on tall displays, never
			    into towers, and scrolls on short ones. Content taller than the cap
			    (a long translation) wins over it, as a min-height does. */}
			<TipsContext.Provider value={tips}>
				<div
					className={cn(
						'flex w-full max-w-[1000px] flex-col gap-4 md:grid md:min-h-min md:flex-1 md:grid-flow-dense md:grid-cols-2 lg:max-h-[616px] lg:grid-cols-[1.15fr_1fr_1fr]',
						// Two columns: three rows for the owner; a member's two are Files
						// and the row Photos stands in
						isMember ? 'md:max-h-[760px]' : 'md:max-h-[932px]',
					)}
				>
					<BentoCard
						id='files'
						index={0}
						variant='wide'
						action={
							<>
								<ButtonLink to='/files' className={cardButtonClass}>
									{t('desktop.welcome.files.button')}
								</ButtonLink>
								{canShareFiles && (
									<ButtonLink to='/settings/file-sharing' className={cardButtonClass}>
										{t('desktop.welcome.files.sharing-button')}
									</ButtonLink>
								)}
							</>
						}
						icon={systemAppsKeyed['UMBREL_files'].icon}
						title={t('desktop.welcome.files.title')}
						description={
							isMember ? t('desktop.welcome.files.member-description') : t('desktop.welcome.files.description')
						}
						accent='#4d94ff'
						glow={false}
						stage={<FilesMarquee paused={paused || closed.has('files')} />}
						className='md:col-span-2'
					/>
					<BentoCard
						id='photos'
						index={1}
						variant='tall'
						action={
							<>
								<Button asChild variant='primary' className={cardButtonClass}>
									<a href='https://link.umbrel.com/ios-app' target='_blank' rel='noopener noreferrer'>
										<IoLogoApple className='size-3.5' />
										{t('desktop.welcome.photos.ios')}
									</a>
								</Button>
								{/* Android app isn't out yet */}
								<Button disabled className={cardButtonClass}>
									<IoLogoAndroid className='size-3.5' />
									{t('desktop.welcome.photos.android')}
								</Button>
							</>
						}
						icon={PHOTOS_ICON}
						title={t('desktop.welcome.photos.title')}
						description={t('desktop.welcome.photos.description')}
						accent='#fb7185'
						stage={<PhoneShot />}
						// Two columns: beside App Store and Tailscale (a member's App
						// Store card alone). Three: down the right of everything.
						className={cn('md:col-start-2 lg:col-start-auto lg:row-span-2', !isMember && 'md:row-span-2')}
					/>
					<BentoCard
						id='app-store'
						index={2}
						variant={isMember ? 'wide' : 'small'}
						action={
							<ButtonLink to='/app-store' className={cardButtonClass}>
								{t('desktop.welcome.app-store.button')}
							</ButtonLink>
						}
						icon={systemAppsKeyed['UMBREL_app-store'].icon}
						title={isMember ? t('desktop.welcome.app-store.member-title') : t('desktop.welcome.app-store.title')}
						description={
							isMember ? t('desktop.welcome.app-store.member-description') : t('desktop.welcome.app-store.description')
						}
						accent='#a78bfa'
						ornament={<AppDeck cards={deckCards} paused={paused || closed.has('app-store')} />}
						className={isMember ? 'lg:col-span-2' : undefined}
					/>
					{!isMember && (
						<BentoCard
							id='tailscale'
							index={3}
							action={
								<ButtonLink to='/app-store/tailscale' className={cardButtonClass}>
									{t('desktop.welcome.tailscale.button')}
								</ButtonLink>
							}
							icon={tailscaleIcon}
							iconBordered
							title={t('desktop.welcome.tailscale.title')}
							description={t('desktop.welcome.tailscale.description')}
							accent='#34d399'
						/>
					)}
				</div>
			</TipsContext.Provider>
			{/* Same pill as the desktop's search button */}
			<button
				type='button'
				onClick={() => setDismissing('all')}
				className={cn(
					darkTooltipClass,
					'shrink-0 animate-in px-4 py-3.5 leading-inter-trimmed fill-mode-both fade-in motion-reduce:animate-none',
					// Steps aside at once, ahead of the cards
					dismissing !== null
						? 'opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none'
						: 'transition-colors duration-700 hover:bg-white/10 active:bg-white/5',
					focusRingOnWallpaperClass,
				)}
				style={{animationDelay: '600ms'}}
			>
				{t('desktop.welcome.dismiss-all')}
			</button>
		</div>
	)
}

type TipRect = {x: number; y: number; w: number; h: number}
/** Tips laid out in a row or a column, centered on the cross axis; closed tips drop out */
type TipArrangement = TipId | {row: TipArrangement[]} | {col: TipArrangement[]}

// How the open tips regroup, by column count. These mirror the grid: with
// nothing closed they resolve to every card's own cell.
function tipArrangement(columns: 2 | 3, closed: ReadonlySet<TipId>): TipArrangement {
	const pair: TipArrangement = {row: ['app-store', 'tailscale']}
	if (columns === 3) return {row: [{col: ['files', pair]}, 'photos']}
	// App Store and Tailscale stack beside Photos, and sit side by side without it
	if (closed.has('photos')) return {col: ['files', pair]}
	return {col: ['files', {row: [{col: ['app-store', 'tailscale']}, 'photos']}]}
}

type ArrangedTips = {w: number; h: number; place: (x: number, y: number, out: TipOffsets) => void}

function arrangeTips(
	node: TipArrangement,
	cells: Partial<Record<TipId, TipRect>>,
	closed: ReadonlySet<TipId>,
): ArrangedTips | null {
	if (typeof node === 'string') {
		const cell = cells[node]
		if (!cell || closed.has(node)) return null
		// Whole pixels, so text on a moved card stays as crisp as on a resting one
		return {
			w: cell.w,
			h: cell.h,
			place: (x, y, out) => (out[node] = {x: Math.round(x - cell.x), y: Math.round(y - cell.y)}),
		}
	}
	const isRow = 'row' in node
	const parts = (isRow ? node.row : node.col)
		.map((child) => arrangeTips(child, cells, closed))
		.filter((part) => part !== null)
	if (parts.length === 0) return null
	const main = parts.reduce((sum, part) => sum + (isRow ? part.w : part.h), 0) + TIP_GAP * (parts.length - 1)
	const cross = Math.max(...parts.map((part) => (isRow ? part.h : part.w)))
	return {
		w: isRow ? main : cross,
		h: isRow ? cross : main,
		place: (x, y, out) => {
			for (const part of parts) {
				if (isRow) part.place(x, y + (cross - part.h) / 2, out)
				else part.place(x + (cross - part.w) / 2, y, out)
				if (isRow) x += part.w + TIP_GAP
				else y += part.h + TIP_GAP
			}
		},
	}
}

// Measures every tip's cell and works out where the open tips rest: regrouped
// per the arrangement, and centered as a group in the area the full bento
// covers. Cells are read through offset* so the cards' own transforms (and the
// desktop's, under a sheet) don't feed back into the measurement.
function useTipOffsets(closed: ReadonlySet<TipId>, columns: 1 | 2 | 3) {
	const cells = useRef(new Map<TipId, HTMLElement>())
	const [rects, setRects] = useState<Partial<Record<TipId, TipRect>>>({})

	useLayoutEffect(() => {
		// A single column needs no arranging
		if (columns === 1) return
		const measure = () => {
			const next: Partial<Record<TipId, TipRect>> = {}
			for (const [id, el] of cells.current) {
				next[id] = {x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight}
			}
			setRects((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
		}
		// Cells only move when one of them changes size
		const observer = new ResizeObserver(measure)
		for (const el of cells.current.values()) observer.observe(el)
		measure()
		return () => observer.disconnect()
	}, [columns])

	const offsets = useMemo<TipOffsets>(() => {
		const all = Object.values(rects)
		if (columns === 1 || closed.size === 0 || all.length === 0) return {}
		const group = arrangeTips(tipArrangement(columns, closed), rects, closed)
		if (!group) return {}
		const left = Math.min(...all.map((cell) => cell.x))
		const top = Math.min(...all.map((cell) => cell.y))
		const right = Math.max(...all.map((cell) => cell.x + cell.w))
		const bottom = Math.max(...all.map((cell) => cell.y + cell.h))
		const out: TipOffsets = {}
		group.place((left + right - group.w) / 2, (top + bottom - group.h) / 2, out)
		return out
	}, [rects, closed, columns])

	return {cells, offsets}
}

type BentoVariant = 'wide' | 'tall' | 'small'

function BentoCard({
	id,
	index,
	action,
	variant = 'small',
	icon,
	iconBordered,
	title,
	description,
	accent,
	stage,
	glow = true,
	ornament,
	className,
}: {
	id: TipId
	/** Position in the grid, used to stagger the entrance */
	index: number
	/** Buttons rendered under the description */
	action: ReactNode
	/** Wide cards place the stage beside the text; tall cards run the stage below it */
	variant?: BentoVariant
	/** The feature's own icon, leading the text block */
	icon?: string
	/** Third-party icons get the standard hairline; system icons are drawn without one */
	iconBordered?: boolean
	title: ReactNode
	description: ReactNode
	/** Signature color for the stage light */
	accent: string
	/** Illustration for wide and tall cards; small cards lead with their icon alone */
	stage?: ReactNode
	/** Accent light behind the stage; off for illustrations that carry their own color */
	glow?: boolean
	/** Decoration positioned absolutely within the card, clipped by its edges */
	ornament?: ReactNode
	/** Grid placement */
	className?: string
}) {
	const {t} = useTranslation()
	const tips = useContext(TipsContext)!
	const isClosed = tips.closed.has(id)
	// Its own close button takes it out the same way whether or not it was the last
	const isClosing = isClosed || tips.dismissing === id
	const isDismissed = !isClosing && tips.dismissing !== null
	const isLeaving = isClosing || isDismissed
	const offset = tips.offsets[id] ?? {x: 0, y: 0}
	const text = (
		<div className={cn('my-auto', variant === 'wide' && 'md:flex-1', variant === 'tall' && 'shrink-0')}>
			{iconBordered ? (
				<AppIcon src={icon} size={56} className='rounded-12' />
			) : (
				<img src={icon} alt='' draggable={false} className='size-14 rounded-12' />
			)}
			<h3 className='mt-2.5 text-16 font-semibold -tracking-2 md:text-17'>{title}</h3>
			<p className='mt-1 max-w-[44ch] text-13 leading-snug text-white/60'>{description}</p>
			<div className='mt-3 flex flex-wrap gap-2'>{action}</div>
		</div>
	)

	// The stage: accent light pooling behind the hero
	const stageEl = !stage ? null : (
		<div
			className={cn(
				'relative grid flex-1 place-items-center py-1',
				// Wide and tall stages bleed through the card padding, edge to edge
				variant === 'wide' &&
					'hidden md:-my-6 md:-mr-6 md:grid md:w-[260px] md:flex-none md:self-stretch md:overflow-hidden md:py-0 lg:w-[320px]',
				variant === 'tall' && '-mx-5 -mb-5 min-h-[220px] overflow-hidden py-0 md:-mx-6 md:-mb-6',
			)}
		>
			{glow && (
				<div
					aria-hidden
					className={cn(
						'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 transition-opacity duration-700 group-hover:opacity-100',
						variant === 'tall' ? 'top-2/3 size-64' : 'size-44',
					)}
					style={{
						background:
							'radial-gradient(closest-side, color-mix(in srgb, var(--accent) 40%, transparent), transparent)',
					}}
				/>
			)}
			{stage}
		</div>
	)

	const inner = (
		<>
			{ornament}
			<DarkTooltip label={t('desktop.welcome.dismiss')}>
				<button
					ref={(el) => tips.registerCloseButton(id, el)}
					type='button'
					// detail is 0 for a click made from the keyboard
					onClick={(e) => tips.close(id, e.detail === 0)}
					aria-label={t('desktop.welcome.dismiss')}
					className={cn(
						'absolute top-2 right-2 z-20 grid size-7 place-items-center rounded-full text-white/50 transition-[color,background-color,scale] hover:bg-white/10 hover:text-white active:scale-90 active:bg-white/5',
						focusRingOnWallpaperClass,
					)}
				>
					<RiCloseLine className='size-4' />
				</button>
			</DarkTooltip>
			<div
				className={cn(
					'relative z-10 flex h-full flex-col gap-4',
					variant === 'wide' && 'md:flex-row-reverse md:items-center md:gap-6',
					variant === 'tall' && 'gap-5',
				)}
			>
				{variant === 'tall' ? (
					<>
						{text}
						{stageEl}
					</>
				) : (
					<>
						{stageEl}
						{text}
					</>
				)}
			</div>
		</>
	)
	const style = {animationDelay: `${200 + index * 80}ms`, '--accent': accent} as React.CSSProperties

	return (
		// The cell: holds this tip's place in the grid whether it's open or not
		<motion.div
			ref={(el) => tips.registerCell(id, el)}
			inert={isClosed}
			initial={false}
			animate={tips.stacked && isClosed ? {height: 0, marginTop: -TIP_GAP} : {height: 'auto', marginTop: 0}}
			transition={tips.animated ? TIP_FOLD : TIP_SNAP}
			// A closing card fades beneath the ones gliding over its cell
			className={cn('relative', isClosed ? 'z-0 max-md:overflow-hidden' : 'z-10', className)}
		>
			<motion.div
				initial={false}
				animate={offset}
				transition={tips.animated ? TIP_MOVE : TIP_SNAP}
				className='md:h-full'
			>
				{/* The glass fades on the card itself (see WelcomeBento); only the
				    content takes the blur, as a filter would take the glass with it */}
				<motion.div
					initial={false}
					animate={isClosing ? TIP_CLOSED : isDismissed ? TIP_DISMISSED : {opacity: 1, scale: 1, y: 0}}
					transition={!tips.animated ? TIP_SNAP : tipExit(isDismissed ? tips.dismissDelay(id) : 0)}
					className={cn(
						bentoCardClass,
						// Off the GPU's books once it has faded
						isClosed && 'invisible [transition:visibility_0s_linear_250ms]',
					)}
					style={{...style, transformOrigin: isClosing ? TIP_CLOSED_ORIGIN : undefined}}
				>
					<motion.div
						initial={false}
						// No filter at all at rest: even blur(0) would wall the buttons' own
						// glass off from what's behind the card
						animate={isLeaving ? {filter: TIP_EXIT_BLUR} : {}}
						transition={!tips.animated ? TIP_SNAP : tipExit(isDismissed ? tips.dismissDelay(id) : 0)}
						className='relative h-full p-5 md:p-6'
					>
						{inner}
					</motion.div>
				</motion.div>
			</motion.div>
		</motion.div>
	)
}

const bentoCardClass = tw`umbrel-material group relative block h-full animate-in overflow-hidden rounded-24 duration-700 fade-in fill-mode-both slide-in-from-bottom-4 motion-reduce:animate-none`

const cardButtonClass = tw`h-8 gap-1.5 px-3.5 text-12`

// Real file icons drifting upward in three offset columns, each looping
// seamlessly — files on their way home. The mask fades them in and out at
// the edges; every column runs at its own speed.
const marqueeColumns = [
	{
		items: [PdfThumbnail, ImageThumbnail, DocxThumbnail, AudioThumbnail],
		duration: '22s',
		offset: 'mt-10',
	},
	{items: [VideoThumbnail, TxtThumbnail, PsdThumbnail, CsvThumbnail, EbookThumbnail], duration: '17s', offset: 'mt-0'},
	{items: [PptThumbnail, IsoThumbnail, AiThumbnail, DmgThumbnail, ExeThumbnail], duration: '26s', offset: 'mt-16'},
] as const

function FilesMarquee({paused}: {paused: boolean}) {
	return (
		<div
			className='absolute inset-0 flex items-start justify-center gap-5 overflow-hidden'
			style={{maskImage: 'linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)'}}
		>
			{marqueeColumns.map(({items, duration, offset}, column) => (
				<div
					key={column}
					className={cn('welcome-marquee flex flex-col', offset)}
					// Inline: the unlayered .welcome-marquee rule would beat a layered utility
					style={
						{'--marquee-duration': duration, animationPlayState: paused ? 'paused' : undefined} as React.CSSProperties
					}
				>
					{/* Rendered twice so the loop point is invisible */}
					{[...items, ...items].map((Thumbnail, i) => (
						<Thumbnail key={i} className='mb-5 size-16 shrink-0 drop-shadow-lg' draggable={false} />
					))}
				</div>
			))}
		</div>
	)
}

// The most-installed apps as a small deck of cards in the corner: every few
// seconds the front card is flicked over the pile and lands at the back,
// cycling through the whole set. The list comes from the storefront feed's
// "most installs" section when it's available, and falls back to this set.
const DECK_STOREFRONT_SECTION = 'most-installs'
const fallbackDeckApps = [
	'nextcloud',
	'jellyfin',
	'bitcoin',
	'openclaw',
	'ollama',
	'plex',
	'transmission',
	'home-assistant',
	'immich',
	'hermes-agent',
	'pi-hole',
	'open-webui',
] as const

const DECK_VISIBLE = 4
const DECK_INTERVAL_MS = 2800

// Poses by depth: a straight stack receding upward, each card behind a step
// higher, smaller and a touch dimmer, like cards seen from the front.
// Anything deeper than the visible stack rests at the back pose.
const deckPoses = [
	{y: 0, scale: 1, filter: 'brightness(1)'},
	{y: -12, scale: 0.9, filter: 'brightness(0.82)'},
	{y: -22, scale: 0.8, filter: 'brightness(0.66)'},
	{y: -30, scale: 0.7, filter: 'brightness(0.52)'},
]
const deckBackPose = {y: -36, scale: 0.62, filter: 'brightness(0.4)'}

// The front card gets dealt: it swings out to the right and around, then
// slots in at the back of the stack
const deckFlick = {
	x: [0, 56, 0],
	y: [0, -20, -36],
	rotate: [0, 10, 0],
	scale: [1, 1.05, 0.62],
	filter: ['brightness(1)', 'brightness(1)', 'brightness(0.4)'],
	zIndex: [DECK_VISIBLE + 1, DECK_VISIBLE + 1, 0],
}

type DeckCard = {id: string; icon: string}

function useDeckCards(appsKeyed: Record<string, RegistryApp> | undefined): DeckCard[] {
	const storefront = useStorefront()
	return useMemo(() => {
		const section = storefront.sections.find((s) => s.id === DECK_STOREFRONT_SECTION)
		// Tailscale has its own card right next to this one
		const apps = section?.type === 'app-list' ? section.apps.filter((app) => app.id !== 'tailscale') : []
		if (apps.length >= DECK_VISIBLE) {
			return apps.map((app) => ({id: app.id, icon: app.icon}))
		}
		// The registry icon is used when synced; the gallery URL is the same asset
		return fallbackDeckApps.map((id) => ({
			id,
			icon: appsKeyed?.[id]?.icon ?? `https://getumbrel.github.io/umbrel-apps-gallery/${id}/icon.svg`,
		}))
	}, [storefront.sections, appsKeyed])
}

function AppDeck({cards, paused}: {cards: DeckCard[]; paused: boolean}) {
	const [front, setFront] = useState(0)
	useEffect(() => {
		if (paused) return
		const id = setInterval(() => setFront((f) => (f + 1) % cards.length), DECK_INTERVAL_MS)
		return () => clearInterval(id)
	}, [cards.length, paused])
	const leaving = (front + cards.length - 1) % cards.length

	return (
		<div className='absolute top-10 right-6 z-0 size-16'>
			{cards.map(({id, icon}, i) => {
				const depth = (i - front + cards.length) % cards.length
				const isLeaving = i === leaving
				return (
					<motion.div
						key={id}
						className='absolute inset-0'
						initial={false}
						animate={
							isLeaving
								? deckFlick
								: {...(deckPoses[depth] ?? deckBackPose), x: 0, rotate: 0, zIndex: DECK_VISIBLE - depth}
						}
						transition={
							isLeaving
								? {duration: 0.62, times: [0, 0.42, 1], ease: ['easeOut', 'easeInOut'], zIndex: {duration: 0}}
								: // The rest of the pile snaps forward with some bounce
									{type: 'spring', stiffness: 520, damping: 17, mass: 0.8, zIndex: {duration: 0}}
						}
					>
						<AppIcon src={icon} size={64} className='rounded-15 border-slate-300/20 shadow-xl' />
					</motion.div>
				)
			})}
		</div>
	)
}

// The Umbrel phone app's backup screen, rising out of the bottom of the
// Photos card. The card clips it, so only the top of the phone shows; it
// lifts a touch on hover.
function PhoneShot() {
	return (
		<img
			src={PHONE_BACKUP_SHOT}
			alt=''
			draggable={false}
			className='absolute top-4 left-1/2 w-[210px] max-w-[80%] -translate-x-1/2 drop-shadow-2xl transition-transform duration-500 group-hover:-translate-y-1.5 motion-reduce:transition-none'
		/>
	)
}
