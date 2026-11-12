import {PlusCircle} from 'lucide-react'
import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {useEffect, useRef, type ReactNode} from 'react'
import {useTranslation} from 'react-i18next'
import {type IconType} from 'react-icons'
import {TbChevronDown, TbChevronLeft, TbChevronRight, TbInfoCircle} from 'react-icons/tb'

import {Button} from '@/components/ui/button'
import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {DialogDescription, DialogTitle} from '@/components/ui/dialog'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {immersiveDialogDescriptionClass, immersiveDialogTitleClass} from '@/components/ui/immersive-dialog'
import {cn} from '@/lib/utils'
import {useWallpaper} from '@/providers/wallpaper'

const settingsRowClass =
	'flex w-full items-start gap-x-2.5 rounded-12 bg-white/6 p-4 contrast-more:ring-1 contrast-more:ring-white/40 contrast-more:ring-inset'

// The redesigned Settings page tints each row's icon tile with the
// wallpaper's brand hue at a per-row lightness, lightest first
const settingsRowToneLightnesses = [82, 68, 54, 40, 26] as const
export type SettingsRowTone = 1 | 2 | 3 | 4 | 5

export function AppServiceSelect({
	services,
	serviceImages,
	value,
	onChange,
}: {
	services: string[]
	serviceImages: Record<string, string | null>
	value: string
	onChange: (serviceName: string) => void
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button size='input-short' className='w-full justify-between px-3'>
					<span className='truncate'>{value}</span>
					<TbChevronDown className='size-3.5 text-white/45' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='start' className='min-w-44'>
				{services.map((serviceName) => {
					const serviceImage = serviceImages[serviceName]

					return (
						<DropdownMenuItem
							key={serviceName}
							onSelect={() => onChange(serviceName)}
							className='flex flex-col items-start gap-0.5'
						>
							<span>{serviceName}</span>
							{serviceImage ? (
								<span className='max-w-72 truncate text-11 font-normal text-white/35'>{serviceImage}</span>
							) : null}
						</DropdownMenuItem>
					)
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

function SettingsRowIcon({icon: Icon, tone}: {icon: IconType; tone: SettingsRowTone}) {
	const {wallpaper} = useWallpaper()
	const [hue, saturation] = wallpaper.brandColorHsl.split(' ')
	const toneColor = `hsl(${hue} ${saturation} ${settingsRowToneLightnesses[tone - 1]}%)`

	return (
		<div
			aria-hidden='true'
			className='flex size-[33px] shrink-0 items-center justify-center self-center rounded-8'
			style={{
				// A top catch-light and a hairline inset ring instead of a hard
				// border, so the tile reads embossed rather than outlined
				boxShadow:
					'inset 0 1px 0 rgb(255 255 255 / 0.28), inset 0 0 0 1px rgb(255 255 255 / 0.08), 0 1px 2px rgb(0 0 0 / 0.25)',
				background: `linear-gradient(to bottom, rgb(255 255 255 / 0.18), rgb(0 0 0 / 0.28)), ${toneColor}`,
			}}
		>
			<Icon className='size-4 text-white' />
		</div>
	)
}

export function SettingsNavigationRow({
	title,
	description,
	onClick,
	modified,
	icon,
	tone = 3,
}: {
	title: string
	description: ReactNode
	onClick?: () => void
	modified?: boolean
	icon?: IconType
	tone?: SettingsRowTone
}) {
	const disabled = !onClick

	return (
		<button
			onClick={onClick}
			disabled={disabled}
			className={cn(settingsRowClass, 'text-left transition-colors', disabled ? 'opacity-60' : 'hover:bg-white/8')}
		>
			{icon ? <SettingsRowIcon icon={icon} tone={tone} /> : null}
			<CardText title={title} description={description} modified={modified} />
			{disabled ? null : <TbChevronRight className='size-4.5 shrink-0 self-center text-white/30' />}
		</button>
	)
}

// An inert sibling of SettingsNavigationRow: same row, but hosting an inline
// control (e.g. a switch) instead of navigating. Rendered dimmed with no
// control when the feature isn't applicable, so the row schema stays fixed
// across apps.
export function SettingsControlRow({
	title,
	description,
	control,
	icon,
	tone = 3,
}: {
	title: string
	description: ReactNode
	control?: ReactNode
	icon?: IconType
	tone?: SettingsRowTone
}) {
	return (
		// A control too wide to sit beside the text (a long button label) drops
		// below it, at the end of the row
		<div className={cn(settingsRowClass, 'flex-wrap gap-y-3', !control && 'opacity-60')}>
			{icon ? <SettingsRowIcon icon={icon} tone={tone} /> : null}
			<CardText title={title} description={description} />
			{control ? <div className='ms-auto max-w-full shrink-0 self-center'>{control}</div> : null}
		</div>
	)
}

function CardText({title, description, modified}: {title: string; description: ReactNode; modified?: boolean}) {
	return (
		<div className='min-w-0 flex-1 basis-40 space-y-0.5 self-center'>
			<h3 className='flex items-center gap-1.5 text-14 leading-tight font-medium -tracking-2 text-white/90'>
				{title}
				{modified ? <span aria-hidden='true' className='size-1.5 shrink-0 rounded-full bg-brand' /> : null}
			</h3>
			<p className='text-12 leading-tight -tracking-2 text-white/40'>{description}</p>
		</div>
	)
}

export function BackButton({onClick, children}: {onClick: () => void; children: ReactNode}) {
	return (
		<button
			onClick={onClick}
			className='-ml-1 flex items-center gap-0.5 self-start text-13 font-medium -tracking-2 text-white/50 transition-colors hover:text-white/70'
		>
			<TbChevronLeft className='size-4' />
			{children}
		</button>
	)
}

// Small badge for a list entry's status (read-only/read-write, modified,
// overrides default). Exported as a class too for pills that need to be
// interactive triggers rather than plain spans.
export const settingsPillClass =
	'inline-flex shrink-0 items-center rounded-full bg-white/[0.09] px-1.5 py-px text-11 font-medium text-white/45'

export function SettingsPill({children}: {children: ReactNode}) {
	return <span className={settingsPillClass}>{children}</span>
}

// The read-only/read-write badge on a folder access row. The whole pill is a
// tooltip trigger (dark glass, as in Machines) spelling out what the mode
// means for this app, so the terse label never has to.
export function FolderAccessPill({appName, readOnly}: {appName: string; readOnly: boolean}) {
	const {t} = useTranslation()
	const explanation = readOnly
		? t('app-settings.storage.read-only-tooltip', {app: appName})
		: t('app-settings.storage.read-write-tooltip', {app: appName})

	return (
		<DarkTooltip label={explanation} className='max-w-64 rounded-12 px-3 py-1.5 text-left whitespace-normal'>
			<button type='button' aria-label={explanation} className={cn(settingsPillClass, 'gap-1')}>
				{readOnly ? t('app-settings.storage.read-only') : t('app-settings.storage.read-write')}
				<TbInfoCircle className='size-3 shrink-0 text-white/35' />
			</button>
		</DarkTooltip>
	)
}

export function SettingsIconButton({
	label,
	onClick,
	children,
}: {
	label: string
	onClick: () => void
	children: ReactNode
}) {
	return (
		<button
			type='button'
			aria-label={label}
			title={label}
			onClick={onClick}
			className='flex size-[25px] shrink-0 items-center justify-center rounded-full bg-white/10 text-white/65 transition-colors hover:bg-white/15 hover:text-white'
		>
			{children}
		</button>
	)
}

// The inline panel for adding an entry to a settings list: dimmed backdrop, a
// title above the form fields, and a dialog-style footer — Cancel beside the
// primary action, like every confirmation in the OS.
export function SettingsAddForm({
	title,
	onCancel,
	submit,
	children,
}: {
	title: string
	onCancel: () => void
	/** The form's primary action button, rendered right of Cancel */
	submit?: ReactNode
	children: ReactNode
}) {
	const {t} = useTranslation()

	return (
		<div className='flex flex-col gap-3 bg-black/10 p-3'>
			<div className='text-13 font-medium text-white/75'>{title}</div>
			{children}
			<div className='flex items-center justify-end gap-2'>
				<Button size='sm' onClick={onCancel}>
					{t('cancel')}
				</Button>
				{submit}
			</div>
		</div>
	)
}

// The list row that opens a SettingsAddForm
export function SettingsAddRowButton({label, onClick}: {label: string; onClick: () => void}) {
	return (
		<button
			type='button'
			onClick={onClick}
			className='flex w-full items-center gap-2 p-3 text-left transition-colors hover:bg-white/8'
		>
			<PlusCircle className='size-3.5 shrink-0 text-white/45' />
			<div className='text-14 font-medium text-white/80'>{label}</div>
		</button>
	)
}

// Inline note under a form input: 'warning' for validation problems, muted
// for informational hints
export function SettingsInputHint({tone = 'muted', children}: {tone?: 'warning' | 'muted'; children: ReactNode}) {
	return (
		<div className={cn('mt-1.5 px-[5px] text-11', tone === 'warning' ? 'text-yellow-200/70' : 'text-white/40')}>
			{children}
		</div>
	)
}

const settingsViewVariants = {
	enter: (direction: number) => ({opacity: 0, x: direction * 28}),
	center: {opacity: 1, x: 0},
	exit: (direction: number) => ({opacity: 0, x: direction * -28}),
}

// Directional slide between settings views: drilling in enters from the
// right, going back enters from the left. `depth` decides the direction, so
// sibling views only need to say how deep they sit.
export function SettingsViewTransition({
	viewKey,
	depth,
	children,
}: {
	viewKey: string
	depth: number
	children: ReactNode
}) {
	const reduceMotion = useReducedMotion()
	const previousDepthRef = useRef(depth)
	const directionRef = useRef(1)
	if (depth !== previousDepthRef.current) {
		directionRef.current = depth > previousDepthRef.current ? 1 : -1
		previousDepthRef.current = depth
	}
	const direction = reduceMotion ? 0 : directionRef.current

	// Views open scrolled to the top instead of inheriting the previous view's
	// scroll position
	const contentRef = useRef<HTMLDivElement>(null)
	useEffect(() => {
		contentRef.current?.closest('[data-radix-scroll-area-viewport]')?.scrollTo({top: 0})
	}, [viewKey])

	return (
		<div className='relative min-w-0'>
			<AnimatePresence mode='popLayout' initial={false} custom={direction}>
				<motion.div
					ref={contentRef}
					key={viewKey}
					custom={direction}
					variants={settingsViewVariants}
					initial='enter'
					animate='center'
					exit='exit'
					transition={{duration: reduceMotion ? 0 : 0.2, ease: 'easeOut'}}
					className='flex w-full min-w-0 flex-col gap-y-5'
				>
					{children}
				</motion.div>
			</AnimatePresence>
		</div>
	)
}

// One header treatment for every view inside the app settings dialog.
// DialogTitle/DialogDescription keep the dialog accessible while the classes
// match the immersive dialog typography.
export function SettingsViewHeader({title, description}: {title: string; description?: ReactNode}) {
	return (
		<div className='space-y-1.5'>
			<DialogTitle className={immersiveDialogTitleClass}>{title}</DialogTitle>
			{description ? (
				<DialogDescription className={immersiveDialogDescriptionClass}>{description}</DialogDescription>
			) : null}
		</div>
	)
}
