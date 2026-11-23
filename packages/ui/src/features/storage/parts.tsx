// The pieces the storage screens share. They follow what umbrelOS already uses, so the new
// screens sit in the same system:
//   type     24 title, 15 card title, 14 body, 13 secondary, 12 caption
//   corners  24 group, 17 card, 12 note, full pill
//   icons    20 leading a card, 16 inline, 14 in a pill
// The drives themselves are drawn in art.tsx.

import {createContext, useContext, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbAlertTriangle, TbCheck, TbChevronDown, TbChevronLeft, TbChevronRight, TbInfoCircle} from 'react-icons/tb'

import {FadeScroller} from '@/components/fade-scroller'
import {Button} from '@/components/ui/button'
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogPortal,
	DialogScrollableContent,
	DialogTitle,
} from '@/components/ui/dialog'
import {Drawer, DrawerContent, DrawerDescription, DrawerTitle} from '@/components/ui/drawer'
import {
	ImmersiveDialog,
	ImmersiveDialogContent,
	ImmersiveDialogOverlay,
	immersiveDialogTitleClass,
} from '@/components/ui/immersive-dialog'
import {useIsPhone} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

import {DriveArt, DriveSlab, DriveTone, DriveView} from './art'
import {Drive} from './model'
import {driveOfSize, identityOf} from './phrases'

export const titleGlow = {textShadow: '0 0 8px rgba(255, 255, 255, 0.2), 0 0 16px rgba(255, 255, 255, 0.15)'}

// The ring keyboard users see on anything that can be acted on
export const focusRing = 'outline-hidden focus-visible:ring-2 focus-visible:ring-white/70'

// ---------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------

// The head of a setup step, with a way back for the steps inside
export function StepHeader({
	title,
	onBack,
	children,
}: {
	title: string
	onBack?: () => void
	children?: React.ReactNode
}) {
	const {t} = useTranslation()
	return (
		<div className='flex flex-col gap-1 md:gap-2'>
			<div className='flex items-center gap-1'>
				{onBack && (
					<button
						type='button'
						onClick={onBack}
						aria-label={t('back')}
						className={cn(
							'-ml-2 flex size-9 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white',
							focusRing,
						)}
					>
						<TbChevronLeft className='size-5' />
					</button>
				)}
				<h1 className='text-[20px] font-bold text-white/85 md:text-24' style={titleGlow}>
					{title}
				</h1>
			</div>
			{children && <p className='text-14 leading-relaxed text-white/50 md:text-15'>{children}</p>}
		</div>
	)
}

export function SectionLabel({children, className}: {children: React.ReactNode; className?: string}) {
	return <span className={cn('text-13 font-semibold text-white/50', className)}>{children}</span>
}

// ---------------------------------------------------------------------------
// The picture's side of a two-sided page
// ---------------------------------------------------------------------------

// Beside the words, the picture of the drives never starts above the line under the page's title:
// the words' 16px, the title's row and the gap under it. That room is kept outside what scrolls,
// so a picture taller than its space scrolls under that line instead of sliding up beside the
// title, and fades at whichever end has more. A short picture sits in the middle of what is left.
// On a phone the picture simply follows the words.
export function PictureSide({isPro, children}: {isPro: boolean; children: React.ReactNode}) {
	return (
		<div className='flex min-w-0 shrink-0 flex-col md:pt-[60px] two-up:min-h-0 two-up:flex-1 two-up:shrink two-up:max-md:pt-14'>
			<FadeScroller
				direction='y'
				fadeSize={24}
				className={cn(
					// The foot's room holds the reach of the link under the drives, which is taller than its text
					'flex flex-col two-up:min-h-0 two-up:flex-1 two-up:overflow-y-auto two-up:pb-3',
					isPro ? 'items-end' : 'items-center two-up:pr-2',
				)}
			>
				<div
					className={cn(
						'my-auto flex w-full flex-col items-center gap-3',
						// The tray's photo carries a long shadow that fades to nothing below it: it is not
						// something to scroll to
						isPro ? 'max-w-[400px] overflow-y-clip' : 'max-w-[440px]',
					)}
				>
					{children}
				</div>
			</FadeScroller>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Choices: the cards the mode display already uses, made to hold any choice
// ---------------------------------------------------------------------------

export function OptionGroup({
	label,
	children,
	className,
	readOnly,
}: {
	// What is being chosen, for screen readers
	label: string
	children: React.ReactNode
	className?: string
	// The choice was made earlier and is only shown here
	readOnly?: boolean
}) {
	return (
		<div
			role='radiogroup'
			aria-label={label}
			aria-readonly={readOnly || undefined}
			className={cn('flex flex-col gap-2 rounded-24 bg-white/5 p-2', className)}
		>
			{children}
		</div>
	)
}

export function OptionCard({
	selected,
	onSelect,
	icon,
	iconCaption,
	title,
	badge,
	value,
	description,
	disabledReason,
	readable,
}: {
	selected: boolean
	// Nothing to do in a list that is only shown
	onSelect?: () => void
	icon?: React.ReactNode
	// The technical name of what the icon stands for, small beside or beneath it
	iconCaption?: string
	title: string
	badge?: React.ReactNode
	// What choosing it gives, at the card's right edge
	value?: React.ReactNode
	description?: React.ReactNode
	// A choice that can't be made says why, in a few words
	disabledReason?: string | null
	// For a list that is as much there to be read as to be chosen from, like Storage Manager's
	// modes: a choice that can't be made keeps words that are easy to read, and says why at the
	// card's edge, where a chosen one has its mark
	readable?: boolean
}) {
	const disabled = !!disabledReason
	// A card that is there to be read stays within reach of the keyboard and of a screen reader's
	// Tab, and says that it can't be chosen. Otherwise it is skipped like any disabled button.
	const pressable = {
		onClick: disabled ? undefined : onSelect,
		disabled: disabled && !readable,
		'aria-disabled': (disabled && readable) || undefined,
	}
	const mark = icon && (
		<span
			className={cn(
				'flex shrink-0 items-center transition-opacity',
				selected ? 'text-white' : 'text-white/80',
				disabled && (readable ? 'opacity-55' : 'opacity-35'),
			)}
		>
			{icon}
		</span>
	)
	const titleAndTag = (
		<>
			<span className='flex min-w-0 items-center gap-2'>
				{!iconCaption && mark}
				<span
					className={cn(
						'text-15 font-semibold',
						selected ? 'text-white' : disabled ? (readable ? 'text-white/65' : 'text-white/40') : 'text-white/80',
					)}
				>
					{title}
				</span>
			</span>
			{!disabled ? (
				badge
			) : readable ? null : (
				<span className='rounded-full bg-white/10 px-2 py-px text-11 font-medium text-white/55'>{disabledReason}</span>
			)}
		</>
	)
	// What choosing it gives, and whether it is chosen. In a list to be read, why it can't be.
	const worth = disabled ? (
		readable && (
			<span className='rounded-full bg-white/10 px-2 py-0.5 text-11 leading-[15px] font-medium whitespace-nowrap text-white/65'>
				{disabledReason}
			</span>
		)
	) : (
		<>
			{value !== undefined && (
				<span className={cn('text-15 font-semibold', selected ? 'text-white' : 'text-white/60')}>{value}</span>
			)}
			{/* The chosen option carries the mark. The others keep its place empty, so that what
			    each option gives stays in one column. */}
			{selected ? (
				<span className='-mr-1 flex size-[22px] shrink-0 items-center justify-center rounded-full bg-brand'>
					<TbCheck className='size-3.5 text-white' strokeWidth={3.5} />
				</span>
			) : (
				<span className='-mr-1 size-[22px] shrink-0' aria-hidden />
			)}
		</>
	)
	const aboutClass = cn(
		'text-13 leading-snug font-medium',
		disabled ? (readable ? 'text-white/45' : 'text-white/35') : 'text-white/60',
		// Sentences to be read don't leave a last word on a line of its own
		readable && 'text-pretty',
	)
	const cardClass = cn(
		'w-full rounded-17 border px-4 py-3 text-left transition-[background-color,border-color] duration-200',
		focusRing,
		selected ? 'border-brand bg-brand/15' : 'border-transparent',
		!selected && !disabled && 'cursor-pointer hover:bg-white/[0.05]',
	)

	// With a technical name the card lays itself out by its own width. A narrow one, on a phone or
	// in one side of a tablet, gives the mark and its name a line of their own beside the value, so
	// the words under it have the whole card. A wide one stands the mark in a column beside the
	// words, wide enough for the longest mark, so every title in the group starts at the same place.
	if (iconCaption)
		return (
			<button
				type='button'
				role='radio'
				aria-checked={selected}
				{...pressable}
				className={cn('@container block', cardClass)}
			>
				<span className='grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 @[340px]:grid-cols-[auto_minmax(0,1fr)_auto] @[340px]:gap-x-3.5 @[340px]:gap-y-1'>
					<span className='col-start-1 row-start-1 flex items-center gap-2 @[340px]:row-span-2 @[340px]:min-w-[62px] @[340px]:flex-col @[340px]:items-start @[340px]:gap-1.5 @[340px]:pt-px'>
						{mark}
						<span
							className={cn(
								'font-mono text-[10px] leading-none tracking-tight whitespace-nowrap',
								disabled
									? readable
										? 'text-white/35'
										: 'text-white/25'
									: selected
										? 'text-white/60'
										: 'text-white/40',
							)}
						>
							{iconCaption}
						</span>
					</span>
					<span className='col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 @[340px]:col-span-1 @[340px]:col-start-2 @[340px]:row-start-1'>
						{titleAndTag}
					</span>
					{worth && (
						<span className='col-start-2 row-start-1 flex items-center gap-2.5 self-start @[340px]:col-start-3'>
							{worth}
						</span>
					)}
					{description && (
						<span className={cn('col-span-2 row-start-3 @[340px]:col-start-2 @[340px]:row-start-2', aboutClass)}>
							{description}
						</span>
					)}
				</span>
			</button>
		)

	return (
		<button
			type='button'
			role='radio'
			aria-checked={selected}
			{...pressable}
			className={cn('flex flex-col gap-1.5', cardClass)}
		>
			<span className='flex w-full items-start gap-2'>
				{/* The title keeps its words together. On a narrow screen the tag drops beneath it. */}
				<span className='flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1'>{titleAndTag}</span>
				{worth && <span className='flex shrink-0 items-center gap-2.5 pl-1'>{worth}</span>}
			</span>
			{description && <span className={aboutClass}>{description}</span>}
		</button>
	)
}

export function Tag({children}: {children: React.ReactNode}) {
	return (
		<span className='rounded-full bg-white/10 px-[7px] py-px text-11 leading-[15px] font-medium text-white/80'>
			{children}
		</span>
	)
}

// ---------------------------------------------------------------------------
// Rows: something that is set, and a way in to see or change it
// ---------------------------------------------------------------------------

export function Rows({children, className}: {children: React.ReactNode; className?: string}) {
	return (
		<div
			className={cn(
				'@container flex flex-col divide-y divide-white/[0.06] overflow-hidden rounded-17 bg-white/5',
				className,
			)}
		>
			{children}
		</div>
	)
}

export function Row({
	label,
	hint,
	value,
	onClick,
	leading,
	trailing,
	trailingBelow,
}: {
	label: React.ReactNode
	hint?: React.ReactNode
	value?: React.ReactNode
	onClick?: () => void
	leading?: React.ReactNode
	// In place of the chevron
	trailing?: React.ReactNode
	// For a button with a sentence beside it: in a narrow group the button goes under the
	// sentence, so the sentence isn't left a sliver to wrap in
	trailingBelow?: boolean
}) {
	const Tag = onClick ? 'button' : 'div'
	const plainValue = value !== undefined && !hint
	return (
		<Tag
			type={onClick ? 'button' : undefined}
			onClick={onClick}
			className={cn(
				'flex min-h-[48px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
				trailingBelow &&
					'@max-[380px]:flex-col @max-[380px]:items-stretch @max-[380px]:gap-3 @max-[380px]:pt-3 @max-[380px]:pb-4',
				onClick && 'cursor-pointer hover:bg-white/[0.04] active:bg-white/[0.07]',
				onClick && 'outline-hidden focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-inset',
			)}
		>
			{leading}
			{plainValue ? (
				// A label and its value share a line when both fit on it whole. When they don't, the
				// value goes under the label instead of wrapping in what room the label leaves it.
				<span className='flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5'>
					<span className='text-14 font-medium text-white/85'>{label}</span>
					<span className='min-w-0 text-13 text-white/50'>{value}</span>
				</span>
			) : (
				<>
					<span className='flex min-w-0 flex-1 flex-col gap-0.5'>
						<span className='text-14 font-medium text-white/85'>{label}</span>
						{hint && <span className='text-12 leading-snug text-white/45'>{hint}</span>}
					</span>
					{value !== undefined && (
						<span className='max-w-[58%] text-right text-13 text-balance text-white/50'>{value}</span>
					)}
				</>
			)}
			{trailing ?? (onClick && <TbChevronRight className='size-4 shrink-0 text-white/30' />)}
		</Tag>
	)
}

// ---------------------------------------------------------------------------
// Words that explain
// ---------------------------------------------------------------------------

// Neutral for something worth knowing, amber and red for trouble
export function Note({
	children,
	tone = 'neutral',
	className,
}: {
	children: React.ReactNode
	tone?: 'neutral' | 'warning' | 'danger'
	className?: string
}) {
	const Icon = tone === 'neutral' ? TbInfoCircle : TbAlertTriangle
	return (
		<div
			className={cn(
				'flex items-start gap-2.5 rounded-12 p-3 text-13 leading-snug',
				tone === 'danger'
					? 'bg-[#FF3434]/10 text-[#FF7A7A]'
					: tone === 'warning'
						? 'bg-[#F5A623]/10 text-[#F5A623]'
						: 'bg-white/5 text-white/60',
				className,
			)}
		>
			<Icon className='mt-px size-4 shrink-0' aria-hidden />
			<div className='min-w-0 flex-1'>{children}</div>
		</div>
	)
}

export function Steps({steps}: {steps: React.ReactNode[]}) {
	return (
		<ol className='flex flex-col gap-2'>
			{steps.map((step, index) => (
				<li
					key={index}
					className='flex items-start gap-3 rounded-12 bg-white/5 px-3 py-2.5 text-13 leading-snug text-white/75'
				>
					<span
						aria-hidden
						className='flex size-5 shrink-0 items-center justify-center rounded-full bg-white/12 text-11 font-semibold text-white/85'
					>
						{index + 1}
					</span>
					<span className='min-w-0 flex-1'>{step}</span>
				</li>
			))}
		</ol>
	)
}

// The detail people only sometimes want: closed until asked for
// A line of text that can be pressed is only as tall as its letters. This gives it a fingertip's
// height to be pressed in, without moving anything around it.
const tallTarget = tw`relative before:absolute before:inset-x-0 before:-inset-y-3`

export function Disclosure({
	summary,
	children,
	plain,
}: {
	summary: string
	children: React.ReactNode
	// What it opens brings its own surface
	plain?: boolean
}) {
	return (
		<details className='group text-13 text-white/50'>
			<summary
				className={cn(
					'flex w-fit cursor-pointer list-none items-center gap-1 rounded-full text-white/55 transition-colors hover:text-white/85 [&::-webkit-details-marker]:hidden',
					tallTarget,
					focusRing,
				)}
			>
				{summary}
				<TbChevronDown className='size-3.5 transition-transform duration-200 group-open:rotate-180' />
			</summary>
			<div className={cn('mt-2.5', !plain && 'flex flex-col gap-2 rounded-12 bg-white/5 px-3.5 py-3 leading-relaxed')}>
				{children}
			</div>
		</details>
	)
}

// Technical names stay out of the main copy. They show up here, small, for people who look for them.
export function TechTag({children}: {children: React.ReactNode}) {
	return (
		<span className='rounded-md border border-white/12 px-1.5 py-px font-mono text-11 tracking-tight whitespace-nowrap text-white/50'>
			{children}
		</span>
	)
}

// A quiet action that sits in running text
export function TextButton({
	children,
	onClick,
	className,
}: {
	children: React.ReactNode
	onClick: () => void
	className?: string
}) {
	return (
		<button
			type='button'
			onClick={onClick}
			className={cn(
				'w-fit rounded-sm text-13 text-white/50 underline-offset-2 transition-colors hover:text-white/80 hover:underline',
				tallTarget,
				focusRing,
				className,
			)}
		>
			{children}
		</button>
	)
}

export function ProgressBar({value, label, className}: {value: number; label: string; className?: string}) {
	const clamped = Math.min(100, Math.max(0, value))
	return (
		<div
			role='progressbar'
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.floor(clamped)}
			className={cn('h-1.5 w-full overflow-hidden rounded-full bg-white/10', className)}
		>
			<div
				className='h-full rounded-full bg-white/90 transition-[width] duration-300 ease-linear'
				style={{width: `${clamped}%`}}
			/>
		</div>
	)
}

// A status button, as tall as a fingertip and as wide as the screen on a phone. It never
// grows past the card it is in.
export function ActionButton({className, ...props}: React.ComponentProps<typeof Button>) {
	return <Button size='md' className={cn('max-w-full max-sm:min-h-11 max-sm:w-full', className)} {...props} />
}

// ---------------------------------------------------------------------------
// Asking umbreld for something: it takes a moment to start, and it can be refused
// ---------------------------------------------------------------------------

// A sheet's own request changes the storage it was opened for, the moment it is sent. Whoever
// holds the sheet is told while a request is on its way, so the sheet stays until umbreld has
// answered: a refusal needs somewhere to be said.
const RequestingContext = createContext<(requesting: boolean) => void>(() => undefined)
export const RequestingProvider = RequestingContext.Provider

// Runs a request and keeps what happened to it: still starting, or refused and why
export function useRun() {
	const report = useContext(RequestingContext)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const run = async (request: () => Promise<unknown>) => {
		setPending(true)
		report(true)
		setError(null)
		try {
			await request()
			return true
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause))
			return false
		} finally {
			setPending(false)
			report(false)
		}
	}
	return {pending, error, run, clear: () => setError(null)}
}

// When umbreld says no: one plain sentence, and its own words for anyone who wants them
export function RunError({message, error}: {message: string; error: string | null}) {
	const {t} = useTranslation()
	if (!error) return null
	return (
		<div role='alert' className='flex flex-col gap-2'>
			<Note tone='danger'>{message}</Note>
			<Disclosure summary={t('storage-ui.technical-details')}>
				<code className='text-12 break-words text-white/55'>{error}</code>
			</Disclosure>
		</div>
	)
}

// ---------------------------------------------------------------------------
// One drive, named
// ---------------------------------------------------------------------------

// The drive at the head of a sheet: the same row it has in the bay
export function DriveBanner({drive, tone, note, slot}: {drive: Drive; tone: DriveTone; note?: string; slot?: number}) {
	const view: DriveView = {id: drive.id, drive, tone, note}
	return <DriveSlab view={view} mode='plain' slot={slot} />
}

// A drive in a list: its picture, what it is, and how to tell it from the next one
export function DriveLine({
	drive,
	tone = 'in',
	slot,
	detail,
	below,
	trailing,
	className,
}: {
	drive: Drive
	tone?: DriveTone
	// Umbrel Pro's slot leads the line when it's known
	slot?: number
	// In place of the model and serial
	detail?: React.ReactNode
	// One more line under them
	below?: React.ReactNode
	trailing?: React.ReactNode
	className?: string
}) {
	const {t} = useTranslation()
	// An SSD's chip already carries its size, so the title doesn't repeat it
	const named = drive.kind === 'ssd' && !slot && !!drive.model
	const title =
		drive.kind === 'ssd' ? (slot ? `SSD ${slot}` : drive.model || driveOfSize(t, drive)) : driveOfSize(t, drive)
	const identity = named ? drive.serial : identityOf(drive)
	return (
		<div className={cn('flex min-h-[56px] items-center gap-3 px-3.5 py-2', className)}>
			<span className='flex w-[60px] shrink-0 justify-center'>
				<DriveArt drive={drive} tone={tone} />
			</span>
			<span className='flex min-w-0 flex-1 flex-col gap-0.5'>
				<span className='text-14 font-medium text-white/85'>{title}</span>
				<span className='text-12 leading-snug text-white/45'>{detail ?? identity}</span>
				{below && <span className='text-12 leading-snug text-white/60 empty:hidden'>{below}</span>}
			</span>
			{trailing}
		</div>
	)
}

// ---------------------------------------------------------------------------
// A sheet: a question, or one thing looked at closely
// ---------------------------------------------------------------------------

// On a phone a sheet comes up from the bottom edge as a drawer, the way umbrelOS's sheets do
// everywhere else, and holds its buttons at the foot where a thumb reaches. Anywhere wider it is
// a window in the middle. Either way it scrolls when it is taller than the screen: the plain
// dialog only does that in a very short window, and a sheet here can be taller than a phone.
const SheetIsDrawer = createContext(false)

export function SheetRoot({
	open,
	onOpenChange,
	children,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	children: React.ReactNode
}) {
	const isPhone = useIsPhone()
	const Root = isPhone ? Drawer : Dialog
	return (
		<SheetIsDrawer.Provider value={isPhone}>
			<Root open={open} onOpenChange={onOpenChange}>
				{children}
			</Root>
		</SheetIsDrawer.Provider>
	)
}

export function SheetContent({
	children,
	wide,
}: {
	children: React.ReactNode
	// A window with more to lay side by side than a question and its answer
	wide?: boolean
}) {
	const isDrawer = useContext(SheetIsDrawer)
	if (isDrawer)
		return (
			<DrawerContent className='max-h-[calc(100%-48px)] gap-0 px-0 pb-0'>
				{/* No padding at the foot: the buttons bring it (see SheetFooter) */}
				<div className='sheet-drawer mt-3 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5'>{children}</div>
			</DrawerContent>
		)
	return (
		<DialogScrollableContent className={wide ? 'sm:max-w-[560px]' : undefined}>
			<div className='flex flex-col gap-5 p-8'>{children}</div>
		</DialogScrollableContent>
	)
}

// A list inside a sheet: in a window it scrolls by itself so the buttons stay close. In a drawer
// the whole sheet scrolls and the buttons are held anyway, so the list is simply as long as it is.
export const sheetListClass = tw`max-h-[220px] overflow-y-auto in-[.sheet-drawer]:max-h-none in-[.sheet-drawer]:overflow-visible`

export function SheetHeader({children}: {children: React.ReactNode}) {
	return useContext(SheetIsDrawer) ? (
		<div className='flex flex-col gap-1.5'>{children}</div>
	) : (
		<DialogHeader>{children}</DialogHeader>
	)
}

export function SheetTitle({children}: {children: React.ReactNode}) {
	return useContext(SheetIsDrawer) ? <DrawerTitle>{children}</DrawerTitle> : <DialogTitle>{children}</DialogTitle>
}

export function SheetDescription({children}: {children: React.ReactNode}) {
	return useContext(SheetIsDrawer) ? (
		// These are sentences to read, not a line of small print
		<DrawerDescription className='text-13 leading-snug tracking-normal'>{children}</DrawerDescription>
	) : (
		<DialogDescription>{children}</DialogDescription>
	)
}

// In a drawer the buttons stay at its foot while what is above them scrolls underneath. The
// footer runs to the drawer's very edge and brings the 40px under the buttons itself: a sticky
// box stops short of its scroller's own padding, and padding there leaves a strip under the
// buttons for the sheet to show through. It also closes the gap to what is above it, so the last
// row ends under the fade the footer casts instead of standing clear of it.
export function SheetFooter({children}: {children: React.ReactNode}) {
	return useContext(SheetIsDrawer) ? (
		<div className='sticky bottom-0 z-10 -mx-5 -mt-5 flex shrink-0 flex-col gap-2.5 bg-[#0A0A0A] px-5 pt-3 pb-10 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-3 before:bg-linear-to-t before:from-[#0A0A0A] before:to-transparent'>
			{children}
		</div>
	) : (
		<DialogFooter>{children}</DialogFooter>
	)
}

// ---------------------------------------------------------------------------
// The Storage Manager window: umbrelOS's own window, with the glass today's has
// ---------------------------------------------------------------------------

export function Window({
	title,
	onClose,
	children,
	narrow,
}: {
	title: string
	onClose: () => void
	children: React.ReactNode
	narrow?: boolean
}) {
	return (
		<ImmersiveDialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
			<DialogPortal>
				<ImmersiveDialogOverlay />
				<ImmersiveDialogContent
					aria-describedby={undefined}
					size={narrow ? 'sm' : 'lg'}
					short
					showScroll
					// Focus lands on the window, not on the first drive in it, which would then look singled out
					onOpenAutoFocus={(event) => {
						event.preventDefault()
						;(event.currentTarget as HTMLElement).focus()
					}}
					// The inline glass outranks the window tint, which turns solid with Increase contrast
					className='outline-hidden contrast-more:bg-black!'
					style={{
						backgroundColor: 'rgba(8, 8, 8, 0.5)',
						backdropFilter: 'blur(80px)',
						WebkitBackdropFilter: 'blur(80px)',
						boxShadow: '0px 32px 32px 0px #00000052, inset 1px 1px 1px 0px #FFFFFF14',
					}}
				>
					<div className='flex flex-col gap-6'>
						<DialogTitle asChild className={immersiveDialogTitleClass}>
							<h1>{title}</h1>
						</DialogTitle>
						{children}
					</div>
				</ImmersiveDialogContent>
			</DialogPortal>
		</ImmersiveDialog>
	)
}
