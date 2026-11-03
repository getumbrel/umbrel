import {useTranslation} from 'react-i18next'
import {Link} from 'react-router-dom'
import {arrayIncludes} from 'ts-extras'

import {AppIcon} from '@/components/app-icon'
import {ProgressButton} from '@/components/progress-button'
import {appPath} from '@/features/app-store/constants'
import {getAppStoreAction, type AppStoreStatus} from '@/features/app-store/data/catalog'
import {preloadFirstFewGalleryImages} from '@/features/app-store/data/gallery-preload'
import {useStoreActions} from '@/features/app-store/providers/store-actions'
import {canStart, pollStates} from '@/hooks/use-app-install'
import {cn} from '@/lib/utils'
import {appStateToString} from '@/modules/app-store/app-state-strings'
import {canPresentUpdateAction} from '@/modules/app-store/update-availability'
import type {AppStateOrLoading, RegistryApp} from '@/trpc/trpc'
import {tw} from '@/utils/tw'

// One primary app-card system with a small number of explicit variants:
// - AppCard: standard grid tile (icon, name, two-line tagline, working action)
// - AppCardCompact: horizontal rails and related-apps lists
// Cards navigate to details; the action button offers the one obvious verb
// (Install / Open / Start / Update) without leaving the page.

export function AppCard({
	app,
	status,
	lifecycleState,
	progress,
	to,
	className,
	style,
}: {
	app: RegistryApp
	status?: AppStoreStatus
	lifecycleState?: AppStateOrLoading
	progress?: number
	/** Override the link target (community stores) */
	to?: string
	className?: string
	style?: React.CSSProperties
}) {
	return (
		<div
			onMouseEnter={() => preloadFirstFewGalleryImages(app)}
			style={style}
			className={cn(
				'group relative flex w-full items-center gap-3 rounded-15 p-2.5 transition-colors duration-200 focus-within:bg-white/7 hover:bg-white/7',
				className,
			)}
		>
			{/* Stretched link: the whole card navigates, while the action button
			    below stays an independent, valid interactive element */}
			<Link
				to={to ?? appPath(app.id)}
				state={{fromAppStore: true}}
				aria-label={app.name}
				className='absolute inset-0 rounded-15 outline-hidden focus-visible:ring-2 focus-visible:ring-white/20'
			/>
			{/* Sized in CSS: AppIcon's size prop is an inline style, which would
			    silently beat the md: step */}
			<AppIcon src={app.icon} className='pointer-events-none relative size-[52px] rounded-12 md:size-14' />
			<div className='pointer-events-none relative flex min-w-0 flex-1 flex-col gap-0.5'>
				<h3 className='truncate text-14 leading-tight font-semibold -tracking-3 md:text-15'>{app.name}</h3>
				<p className='line-clamp-2 w-full min-w-0 text-12 leading-tight opacity-40 md:text-13'>{app.tagline}</p>
			</div>
			<AppCardAction app={app} status={status} lifecycleState={lifecycleState} progress={progress} />
		</div>
	)
}

// Faded action pill, matching the toast action buttons. Overrides the Button
// variant's border/shadow so idle and progress states share one silhouette.
const cardActionClass = tw`relative z-10 h-7 shrink-0 rounded-full border-0 bg-white/10 px-3 text-12 shadow-none hover:bg-white/16 focus-visible:ring-2 focus-visible:ring-white/25`
// Same subdued fill the updates dialog uses for its progress buttons
const cardActionProgressBg = {['--progress-button-bg' as string]: 'hsl(0 0 30%)'}

/**
 * The one obvious action for an app's current status: Install, Open, Start
 * or Update. One button per card, always mounted, so state changes (idle → live
 * progress fill → done) play out inside a single element with no shared
 * animation machinery — an app listed several times on one page just renders
 * several independent buttons.
 */
export function AppCardAction({
	app,
	status,
	lifecycleState,
	progress,
}: {
	app: RegistryApp
	status?: AppStoreStatus
	lifecycleState?: AppStateOrLoading
	progress?: number
}) {
	const {t} = useTranslation()
	const actions = useStoreActions()

	// No status data or no actions provider in this subtree: show nothing
	if (!status || !actions) return null

	const state = lifecycleState ?? (status === 'available' || status === 'incompatible' ? 'not-installed' : 'ready')
	// The live app state is the authority on "in progress" — it flips
	// optimistically the moment a mutation starts, ahead of the derived status
	const transitioning = arrayIncludes(pollStates, state)
	const showProgress = transitioning && arrayIncludes(['installing', 'updating'], state) && progress !== undefined
	const storeAction = getAppStoreAction(status, transitioning)
	// An installed app that isn't running can't be opened, so offer what tapping
	// its home screen icon does: start it. Members can't, so theirs reads Not running
	const notRunning = storeAction === 'open' && canStart(state)
	const candidateAction = notRunning ? (actions.startApp ? 'start' : undefined) : storeAction
	const appIdConflict =
		actions.isAppIdAmbiguous(app.id) && (candidateAction === 'install' || candidateAction === 'update')
	const action = appIdConflict
		? undefined
		: candidateAction === 'update' && !canPresentUpdateAction(state)
			? undefined
			: candidateAction

	// `in-progress` status without a transitioning state can only be a brief
	// cache mismatch; showing the transition label there too keeps it coherent
	const label = transitioning
		? `${appStateToString(state, t)}…`
		: status === 'in-progress'
			? `${t('app-store.status.in-progress')}…`
			: {
					// Incompatible apps get the same Install button; the click explains
					// the required OS update, exactly like the app page does
					available: t('app.install'),
					incompatible: t('app.install'),
					installed: notRunning ? (actions.startApp ? t('start') : t('app.offline')) : t('app.open'),
					'update-available': t('app-updates.update'),
				}[status]

	const onClick = () => {
		switch (action) {
			case 'install':
				return actions.installApp(app)
			case 'open':
				return actions.openApp(app.id)
			case 'start':
				return actions.startApp?.(app.id)
			case 'update':
				return actions.updateApp(app)
			case undefined:
				return
		}
	}

	return (
		<span
			className='relative z-10 shrink-0'
			title={appIdConflict ? t('app-store.app-id-conflict') : undefined}
			tabIndex={appIdConflict ? 0 : undefined}
		>
			<ProgressButton
				size='sm'
				// Not-installed statuses act regardless of the (absent) app state
				state={!transitioning && arrayIncludes(['available', 'incompatible'], status) ? 'not-installed' : state}
				progress={progress}
				onClick={onClick}
				disabled={!action}
				className={cardActionClass}
				style={cardActionProgressBg}
			>
				{label}
				{showProgress && (
					<span className='ml-1 inline-block w-[4ch] text-right opacity-60'>{Math.round(progress)}%</span>
				)}
			</ProgressButton>
		</span>
	)
}

/**
 * A rail tile in the style of the Machines OS catalog: its own card surface,
 * a blurred glow of the icon leaning in on hover, and the icon's reflection
 * off the card surface below it.
 */
export function AppCardCompact({app, status}: {app: RegistryApp; status?: AppStoreStatus}) {
	return (
		<Link
			to={appPath(app.id)}
			state={{fromAppStore: true}}
			onMouseEnter={() => preloadFirstFewGalleryImages(app)}
			className='group relative flex w-[140px] shrink-0 flex-col items-center gap-2.5 rounded-24 p-4 pt-5 outline-hidden focus-visible:ring-2 focus-visible:ring-white/25 md:w-[164px]'
		>
			{/* Card surface with the glow clipped inside it */}
			<div
				aria-hidden
				className='settings-edge-material absolute inset-0 overflow-hidden rounded-24 bg-white/5 transition-colors duration-300 group-hover:bg-white/8'
			>
				{/* The glow takes only the icon's hue/saturation, blended over a
				    fixed mid-gray luminosity base — so dark and bright icons cast
				    the same perceived amount of light (pure compositor work) */}
				<div className='absolute top-4 left-1/2 isolate h-20 w-20 -translate-x-1/2 scale-125 opacity-30 blur-xl transition-opacity duration-500 group-hover:opacity-45'>
					<div className='absolute inset-0 bg-neutral-400' />
					<img src={app.icon} alt='' className='absolute inset-0 h-full w-full mix-blend-color' draggable={false} />
				</div>
			</div>
			{/* w-full caps this column at the card's width: under the card's
			    items-center it would otherwise size to its content, so a long
			    name would widen it past the card instead of truncating */}
			<div className='relative flex w-full min-w-0 flex-col items-center gap-2'>
				{/* NOTE: AppIcon's size prop sets inline width/height, so responsive
				    size classes would silently lose — keep every copy at exactly 72 */}
				<AppIcon
					src={app.icon}
					size={72}
					className='rounded-15 transition-transform duration-300 group-hover:scale-[1.05]'
				/>
				{/* The icon's reflection off the card surface: a mirrored copy fading
				    downward behind the name (which is `relative`, painting above).
				    Origin sits at the mirrored icon's center so it grows away from
				    the contact line exactly as the icon grows toward it. */}
				<div aria-hidden className='pointer-events-none absolute top-[72px] left-1/2 h-12 w-[72px] -translate-x-1/2'>
					<div className='origin-[50%_40px] [mask-image:linear-gradient(to_bottom,black,transparent_70%)] opacity-10 blur-[2px] transition-transform duration-300 group-hover:scale-[1.05]'>
						<AppIcon src={app.icon} size={72} className='-scale-y-100 rounded-15' />
					</div>
				</div>
				<div className='relative flex w-full min-w-0 flex-col items-center gap-0.5 pt-0.5 text-center'>
					<h3 className='w-full truncate text-13 leading-tight font-semibold -tracking-2 md:text-14'>{app.name}</h3>
					<AppStatusLabel
						status={status && status !== 'available' && status !== 'incompatible' ? status : undefined}
						fallback={<span className='w-full truncate text-12 opacity-35'>{app.developer}</span>}
					/>
				</div>
			</div>
		</Link>
	)
}

export function AppStatusLabel({
	status,
	className,
	fallback,
}: {
	status?: AppStoreStatus
	className?: string
	fallback?: React.ReactNode
}) {
	const {t} = useTranslation()

	if (!status || status === 'available') return fallback ? <>{fallback}</> : null

	const labelClass = cn('text-11 leading-tight font-medium whitespace-nowrap', className)

	switch (status) {
		case 'installed':
			return <span className={cn(labelClass, 'text-white/35')}>{t('app.installed')}</span>
		case 'update-available':
			return <span className={cn(labelClass, 'text-brand-lightest')}>{t('app-store.status.update-available')}</span>
		case 'in-progress':
			return <span className={cn(labelClass, 'umbrel-pulse text-white/50')}>{t('app-store.status.in-progress')}</span>
		case 'incompatible':
			return <span className={cn(labelClass, 'text-white/30')}>{t('app-store.status.incompatible')}</span>
	}
}

// Small chip used inside artwork cards (spotlight / category features)
export function AppChip({app, className}: {app: RegistryApp; className?: string}) {
	return (
		<Link
			to={appPath(app.id)}
			state={{fromAppStore: true}}
			onMouseEnter={() => preloadFirstFewGalleryImages(app)}
			className={cn(
				'flex shrink-0 items-center gap-1.5 rounded-full bg-black/35 py-1.5 pr-3 pl-1.5 outline-hidden backdrop-blur-md transition-colors duration-200 hover:bg-black/55 focus-visible:ring-2 focus-visible:ring-white/40',
				className,
			)}
		>
			<AppIcon src={app.icon} size={22} className='rounded-6' />
			<span className='text-12 font-medium whitespace-nowrap text-white/90'>{app.name}</span>
		</Link>
	)
}
