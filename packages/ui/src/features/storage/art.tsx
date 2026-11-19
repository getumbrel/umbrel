// The drives, drawn with the artwork umbrelOS already has. Umbrel Pro gets the photo of its
// tray with an SSD in each slot. Other hardware gets a bay of drive rows, since umbreld can't
// know what the machine looks like inside: the SSD artwork from the health dialog, and the
// hard drive render.
//
// A drive is annotated the way the tray always has been: a hairline outline and a light tint,
// never paint over the render. The outline's colour is the drive's state, and none of the
// states use the wallpaper's brand colour: on a red wallpaper a healthy drive must not look
// failed. In use is white, new is teal, trouble is amber, failed is red.

import {motion, useReducedMotion} from 'motion/react'
import {useId} from 'react'
import {useTranslation} from 'react-i18next'
import {IoShieldHalf} from 'react-icons/io5'
import {PiCheckCircleFill, PiXCircleFill} from 'react-icons/pi'
import {TbCheck, TbPlus, TbShieldOff, TbX} from 'react-icons/tb'
import {TiInfoLarge} from 'react-icons/ti'

import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {useAnimatedNumber} from '@/features/files/hooks/use-animated-number'
import hardDrive from '@/features/storage/assets/hard-drive.webp'
import ssdChip from '@/features/storage/assets/ssd-chip.svg'
import {cn} from '@/lib/utils'

import {Capacity, DeviceModel, Drive, formatSize, GB, Layout, parityOf, TB} from './model'
import {driveOfSize} from './phrases'

export type DriveTone =
	// Part of the storage
	| 'in'
	// Present, deliberately not used
	| 'out'
	// Just detected, not part of anything yet
	| 'new'
	| 'failed'
	// A member the machine can no longer see
	| 'missing'
	// Working, but reporting trouble
	| 'warning'

export type DriveView = {
	id: string
	drive: Drive
	tone: DriveTone
	// A word or two about the drive, when there is something to say
	note?: string
	// How much of the drive the storage can't reach, in bytes
	unusable?: number
	// Shown in place of the note on a healthy drive that is only partly used: how much the
	// storage uses and how much it can't, side by side, so a wasteful mix shows at a glance
	split?: {usable: number; unusable: number}
	// 0 to 100 while the drive is being rebuilt or is joining
	progress?: number
	// A left-out drive that is also in trouble keeps its mark
	alert?: 'attention' | 'critical'
	// Why the drive is as it is and what would change that, said when the pointer rests on it
	hint?: string
}

// What a tap on a drive means right now
export type DriveMode =
	// Open its details
	| 'info'
	// Take it in or out of the storage
	| 'select'
	// Nothing: the drive is only shown
	| 'plain'

export type DrivePicking = {
	onPick?: (id: string) => void
	mode?: DriveMode
	pickedIds?: string[]
}

const teal = '45, 212, 191'
const red = '255, 52, 52'
const amber = '245, 166, 35'

// One palette for every picture of a drive
const looks: Record<DriveTone, {border: string; tint: string; wash: string; text: string}> = {
	in: {
		border: 'rgba(255, 255, 255, 0.4)',
		tint: 'rgba(255, 255, 255, 0.06)',
		wash: 'rgba(255, 255, 255, 0.13)',
		text: 'text-white/80',
	},
	out: {
		border: 'rgba(255, 255, 255, 0.2)',
		tint: 'transparent',
		wash: 'rgba(255, 255, 255, 0.04)',
		text: 'text-white/50',
	},
	new: {border: `rgb(${teal})`, tint: `rgba(${teal}, 0.12)`, wash: `rgba(${teal}, 0.3)`, text: 'text-[#2DD4BF]'},
	failed: {border: `rgb(${red})`, tint: `rgba(${red}, 0.16)`, wash: `rgba(${red}, 0.4)`, text: 'text-[#FF6B6B]'},
	missing: {
		border: `rgba(${red}, 0.75)`,
		tint: `rgba(${red}, 0.05)`,
		wash: `rgba(${red}, 0.14)`,
		text: 'text-[#FF6B6B]',
	},
	warning: {
		border: `rgb(${amber})`,
		tint: `rgba(${amber}, 0.12)`,
		wash: `rgba(${amber}, 0.32)`,
		text: 'text-[#F5A623]',
	},
}

export const hatch = 'repeating-linear-gradient(135deg, rgba(255,255,255,0.34) 0 1px, transparent 1px 5px)'

// Drives settle into place once, when they are found
const arrive = {type: 'spring', duration: 0.7, bounce: 0.14} as const

// The pill every drive carries in today's UI: it says there is more to see. A drive in
// trouble gets the same pinging dot.
function InfoPill({alert, className}: {alert?: 'attention' | 'critical'; className?: string}) {
	return (
		<span
			className={cn(
				'relative flex items-center justify-center rounded-full border border-white/[0.16] bg-white/[0.08] transition-colors group-hover:bg-white/[0.16]',
				className,
			)}
		>
			<TiInfoLarge className='size-full text-white/60' />
			{alert && (
				<span className='absolute -top-0.5 -right-0.5 size-[38%] min-h-1.5 min-w-1.5'>
					<span
						className={cn('absolute inset-0 rounded-full', alert === 'critical' ? 'bg-[#FF3434]' : 'bg-[#F5A623]')}
					/>
					<span
						className={cn(
							'absolute inset-0 animate-ping rounded-full opacity-75',
							alert === 'critical' ? 'bg-[#FF3434]' : 'bg-[#F5A623]',
						)}
					/>
				</span>
			)}
		</span>
	)
}

// A sentence about a drive, shown when the pointer rests on it. A tap opens the drive's own
// sheet, which says the same.
function Hinted({hint, children}: {hint?: string; children: React.ReactElement}) {
	if (!hint) return children
	return (
		<DarkTooltip label={hint} className='max-w-64 rounded-12 px-3 py-2 text-center leading-snug whitespace-normal'>
			{children}
		</DarkTooltip>
	)
}

// Chosen or not, the way a photo is ticked
function Tick({on, className}: {on: boolean; className?: string}) {
	return (
		<span
			className={cn(
				'flex items-center justify-center rounded-full border transition-colors duration-200',
				on ? 'border-white bg-white' : 'border-white/35 bg-black/20',
				className,
			)}
		>
			<TbCheck
				className={cn('size-[68%] text-black transition-opacity', on ? 'opacity-100' : 'opacity-0')}
				strokeWidth={3.5}
			/>
		</span>
	)
}

const alertOf = (view: DriveView) =>
	view.alert ??
	(view.tone === 'failed' || view.tone === 'missing' ? 'critical' : view.tone === 'warning' ? 'attention' : undefined)

// What a screen reader hears for a drive: enough to tell it from its neighbours
function useDriveLabel() {
	const {t} = useTranslation()
	return (view: DriveView, note: string | undefined, slot?: number) =>
		[slot ? `SSD ${slot}` : undefined, driveOfSize(t, view.drive), view.drive.model, view.drive.serial, note]
			.filter(Boolean)
			.join(', ')
}

// ---------------------------------------------------------------------------
// Umbrel Pro: the tray itself
// ---------------------------------------------------------------------------

type TraySlot = DriveView | null

// A word on an SSD in the tray has a slot's width to fit in, which is under a fifth of the
// tray's: it follows the tray down in size so that "responding" or "unusable" stays inside
const trayNoteSize = 'clamp(9.5px, 2.9cqi, 11px)'

// The tray's four slots are 18% of its width each and 19% apart, from 17.5% in: together they
// run from 17.5% to 92.5%. What sums the SSDs up underneath, the bar of space above all, is made
// exactly that wide, so its ends sit under the first slot's left edge and the last slot's right
// edge instead of somewhere between the slots, the tray and the card.
//
// It goes straight after the tray, as wide as the tray is: pass the same limit on width and the
// same side to hold to. The insets are on a box inside, because a percentage of padding is
// taken from the width of what holds a box, not from the box's own.
export function UnderTray({children, className}: {children: React.ReactNode; className?: string}) {
	return (
		// Above the tray's shadow, which fades out over this
		<div className={cn('relative z-10 -mt-3 w-full', className)}>
			{/* The bar keeps to the slots. Its legend may run a little past them on both sides, to
			    stay on one line where three things are named. */}
			<div
				className='flex flex-col items-center gap-3 **:data-legend:-mx-5'
				style={{paddingLeft: '17.5%', paddingRight: '7.5%'}}
			>
				{children}
			</div>
		</div>
	)
}

// The photo is 511x686: the tray runs off its right edge and casts a long shadow below, so it
// belongs against the right edge of whatever holds it. Everything is placed in percentages of
// the photo, on the same grid as the tray always used: slots sit 19% apart.
export function ProTray({
	slots,
	mode = 'info',
	onPick,
	pickedIds = [],
	onEmptySlot,
	className,
}: {
	slots: [TraySlot, TraySlot, TraySlot, TraySlot]
	// Storage Manager only: an empty slot is an invitation
	onEmptySlot?: () => void
	className?: string
} & DrivePicking) {
	const {t} = useTranslation()
	const reduceMotion = useReducedMotion()
	const labelOf = useDriveLabel()
	return (
		<div
			className={cn('relative w-full', className)}
			// Only the tray, not the length of its shadow, takes up room
			style={{aspectRatio: '511 / 560', containerType: 'inline-size'}}
		>
			<div
				// An SSD's picture is a little wider than its slot: the fourth one must not widen the page
				className='absolute inset-x-0 top-0 overflow-x-clip'
				style={{
					aspectRatio: '511 / 686',
					maskImage: 'linear-gradient(to bottom, black 76%, transparent 96%)',
					WebkitMaskImage: 'linear-gradient(to bottom, black 76%, transparent 96%)',
				}}
			>
				<img src='/assets/onboarding/ssd-tray.webp' alt='' draggable={false} className='absolute inset-0 size-full' />

				{slots.map((view, index) => {
					const left = 17.5 + index * 19
					const tone = view?.tone
					const look = tone ? looks[tone] : undefined
					const dim = tone === 'out'
					const gone = tone === 'missing'
					const lit = !!view && !dim && !gone
					const picked = !!view && pickedIds.includes(view.id)
					const working = view?.progress !== undefined
					const total = view?.drive.size || 1
					// The part of the SSD the storage reaches is tinted, from its foot up
					const unusedPart = !working && view?.unusable ? (view.unusable / total) * 100 : 0
					const reach = working ? view!.progress! : 100 - unusedPart
					// The word about unusable space sits in the part it describes when that part reaches
					// well below the size, which is printed across the SSD's upper third. Otherwise, and
					// for a whole SSD that is left out, it is where every other word is: above the mark.
					const noteInHatch = unusedPart >= 58 && unusedPart < 100
					const note = view?.note
					return (
						<div key={index}>
							{/* The slot's name, as printed on the tray */}
							<div
								className={cn(
									'absolute text-center font-medium transition-colors duration-500',
									lit ? 'text-white' : 'text-[#656565]',
								)}
								style={{
									left: `${left + 0.5}%`,
									top: '14%',
									width: '17%',
									fontSize: 'clamp(9px, 2.5cqi, 12px)',
									textShadow: lit ? '0 0 6px rgba(255, 255, 255, 0.25)' : undefined,
								}}
							>
								SSD {index + 1}
							</div>

							{!view && onEmptySlot && (
								// The touch target is the size of a fingertip, whatever the mark's size
								<button
									type='button'
									onClick={onEmptySlot}
									aria-label={t('storage-ui.add-ssd-to-slot', {slot: index + 1})}
									className='group absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-white/60'
									style={{left: `${left + 9}%`, top: '39%'}}
								>
									<span className='flex size-7 items-center justify-center rounded-full bg-white/90 text-neutral-700 shadow-[0_2px_8px_rgba(0,0,0,0.45)] transition-[background-color,color,scale] duration-200 group-hover:scale-105 group-hover:bg-white group-hover:text-neutral-900 group-active:scale-95'>
										<TbPlus className='size-4' strokeWidth={2.75} />
									</span>
								</button>
							)}

							{view && look && (
								<motion.div
									key={view.id}
									initial={reduceMotion ? false : {opacity: 0, y: '-2%'}}
									animate={{opacity: 1, y: 0}}
									transition={{...arrive, delay: 0.08 + index * 0.07}}
									// Each SSD's layer covers the whole tray, so only its button may take the pointer
									className='pointer-events-none absolute inset-0'
								>
									{!gone && (
										<img
											src='/assets/onboarding/ssd.webp'
											alt=''
											draggable={false}
											className={cn(
												'absolute transition-[filter] duration-500',
												// Dimmed, never see-through: the empty slot's grille must not show through an SSD
												dim && 'brightness-[0.42] saturate-[0.5]',
												tone === 'failed' && 'brightness-[0.55] saturate-[0.6]',
											)}
											style={{left: `${left - 0.5}%`, top: '17%', width: '27.2%'}}
										/>
									)}

									{/* The size, printed up the SSD like its label */}
									{!gone && (
										<div
											className='absolute grid place-items-center'
											style={{left: `${left - 4.5}%`, top: '-2%', width: '27.2%', height: '60%'}}
										>
											<span
												className='font-bold whitespace-nowrap transition-opacity duration-500'
												style={{
													fontSize: 'clamp(12px, 6cqi, 24px)',
													writingMode: 'vertical-rl',
													transform: 'rotate(180deg)',
													background: 'linear-gradient(180deg, #FFFFFF 0%, #999999 100%)',
													WebkitBackgroundClip: 'text',
													backgroundClip: 'text',
													WebkitTextFillColor: 'transparent',
													opacity: dim ? 0.5 : tone === 'failed' ? 0.7 : 1,
												}}
											>
												{formatSize(view.drive.size)}
											</span>
										</div>
									)}

									{/* The outline: one pixel of colour and a little tint */}
									<div
										className={cn(
											'absolute overflow-hidden rounded-lg border transition-[border-color] duration-500',
											(dim || gone) && 'border-dashed',
										)}
										style={{left: `${left}%`, top: '13%', width: '18%', height: '53%', borderColor: look.border}}
									>
										<div
											className='absolute inset-x-0 bottom-0 transition-[height,background-color] duration-700 ease-out'
											style={{height: `${reach}%`, backgroundColor: look.tint}}
										/>
										{/* What the storage can't reach on this SSD */}
										{unusedPart > 0 && (
											<div
												className={cn(
													'absolute inset-x-0 top-0 flex items-end justify-center',
													unusedPart < 100 && 'border-b border-dashed border-white/30',
												)}
												style={{height: `${unusedPart}%`}}
											>
												<span className='absolute inset-0' style={{backgroundImage: hatch, opacity: 0.42}} />
												{noteInHatch && note && (
													<span
														className='relative px-[3%] pb-[8%] text-center leading-[1.15] font-semibold text-balance text-white/85'
														style={{fontSize: trayNoteSize}}
													>
														{note}
													</span>
												)}
											</div>
										)}
										{working && (
											<div
												className='absolute inset-x-0 bottom-0 border-t border-white/70 transition-[height] duration-300 ease-linear'
												style={{height: `${reach}%`, backgroundColor: 'rgba(255, 255, 255, 0.1)'}}
											/>
										)}
									</div>

									{/* Below the size: a word about the drive, then the mark that says what a tap does */}
									<div
										className='absolute flex flex-col items-center justify-end'
										style={{
											left: `${left}%`,
											top: '13%',
											width: '18%',
											height: '47.5%',
											gap: 'clamp(3px, 1.4cqi, 7px)',
										}}
									>
										{tone === 'failed' && (
											<TbX
												className='text-[#FF6B6B]'
												strokeWidth={3}
												style={{width: 'clamp(12px, 4.4cqi, 20px)', height: 'clamp(12px, 4.4cqi, 20px)'}}
											/>
										)}
										{((note && !noteInHatch) || working) && (
											<span
												className={cn('px-[3%] text-center leading-[1.15] font-semibold text-balance', look.text)}
												style={{fontSize: trayNoteSize}}
											>
												{working && (
													<span className='block text-white tabular-nums'>{Math.floor(view.progress!)}%</span>
												)}
												{note}
											</span>
										)}
										{mode === 'select' ? (
											<Tick on={picked} className='size-[clamp(16px,5.4cqi,26px)]' />
										) : mode === 'info' ? (
											<InfoPill
												alert={alertOf(view)}
												className='size-[clamp(16px,5.4cqi,26px)] p-[clamp(1px,0.7cqi,3px)]'
											/>
										) : (
											<span className='size-[clamp(16px,5.4cqi,26px)]' />
										)}
									</div>

									{onPick && (
										<Hinted hint={view.hint}>
											<button
												type='button'
												onClick={() => onPick(view.id)}
												role={mode === 'select' ? 'checkbox' : undefined}
												aria-checked={mode === 'select' ? picked : undefined}
												aria-label={labelOf(view, note, index + 1)}
												className='group pointer-events-auto absolute cursor-pointer rounded-lg outline-hidden transition-colors hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-white/70 active:bg-white/[0.09]'
												style={{left: `${left}%`, top: '13%', width: '18%', height: '53%'}}
											/>
										</Hinted>
									)}
								</motion.div>
							)}
						</div>
					)
				})}
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Other hardware: a bay of drive rows
// ---------------------------------------------------------------------------

function Led({color, pulse}: {color: 'red' | 'amber' | 'teal' | 'off'; pulse?: boolean}) {
	const rgb = {red, amber, teal, off: '64, 64, 66'}[color]
	return (
		<span
			className={cn('absolute size-[11%] rounded-full', pulse && 'animate-pulse')}
			// The LED sits at 85%/86% of the render, where its green one is baked in
			style={{
				left: '85%',
				top: '86%',
				transform: 'translate(-50%, -50%)',
				backgroundColor: `rgb(${rgb})`,
				boxShadow: color === 'off' ? 'none' : `0 0 6px 1px rgba(${rgb}, 0.8)`,
			}}
		/>
	)
}

const ledOf = (tone: DriveTone, working: boolean) =>
	tone === 'failed' || tone === 'missing'
		? 'red'
		: tone === 'out'
			? 'off'
			: tone === 'warning' || working
				? 'amber'
				: tone === 'new'
					? 'teal'
					: undefined

// The hard drive render, its LED following the drive's state. One size wherever it stands in a
// row: small enough to leave the row's words the lead, and to have air above and below it.
export function HardDriveArt({
	led,
	pulse,
	className,
}: {
	led?: 'red' | 'amber' | 'teal' | 'off'
	pulse?: boolean
	className?: string
}) {
	return (
		<span className={cn('relative block h-[35px] w-10 shrink-0', className)}>
			<img
				src={hardDrive}
				alt=''
				draggable={false}
				className={cn('size-full object-contain transition-[filter]', led === 'off' && 'brightness-[0.55] grayscale')}
			/>
			{led && <Led color={led} pulse={pulse} />}
		</span>
	)
}

// A hard drive's row: its picture stands 16 in from the edge with about as much above and below
const HDD_ROW = 64
// The SSD artwork is 881x253. Its label area starts 88 in from the connector and leaves 37 above
// and 38 below, all of which follow the row's height.
const SSD_ROW = 80
const ssdLabel = {left: 88 / 253, top: 37 / 253, bottom: 38 / 253}

// One drive as a row. An SSD is the artwork the health dialog's card uses, a hard drive is its
// render, and both carry the same plate: an outline and a wash in the colour of the drive's
// state, fading out to the right. Every row has the full width of its bay, so a drive's serial
// number, the only way to tell one from the next on other hardware, is never cut.
export function DriveSlab({
	view,
	picked,
	mode = 'info',
	onPick,
	slot,
}: {
	view: DriveView
	picked?: boolean
	mode?: DriveMode
	onPick?: (id: string) => void
	// Umbrel Pro's slot, where the row is shown outside the tray
	slot?: number
}) {
	const {t} = useTranslation()
	const labelOf = useDriveLabel()
	const tone = view.tone
	const look = looks[tone]
	const working = view.progress !== undefined
	const split = working ? undefined : view.split
	const note = working
		? `${view.note ?? ''} ${Math.floor(view.progress!)}%`.trim()
		: split
			? `${t('storage-setup.split.usable', {size: formatSize(split.usable)})}, ${t('storage-setup.unusable', {size: formatSize(split.unusable)})}`
			: view.note
	const isSsd = view.drive.kind === 'ssd'
	const faded = tone === 'out' || tone === 'missing'
	const fade = 'linear-gradient(to right, black 40%, transparent 98%)'
	// What the storage can't reach on this drive, as a share of it: lined from the row's far end,
	// the way the tray lines an SSD from its top. A drive that is left out is lined whole.
	const unusedPart =
		!working && view.unusable && view.drive.size > 0 ? Math.min(100, (view.unusable / view.drive.size) * 100) : 0
	// An SSD's row is taller than a hard drive's. The artwork is a stick about three and a half
	// times as long as it is wide: at a hard drive's 60px it was a sliver, a third thinner than
	// the SSDs in Umbrel Pro's tray are drawn.
	const height = isSsd ? SSD_ROW : HDD_ROW
	// On an SSD the plate is the label area baked into the artwork, so it is placed in the
	// artwork's own proportions. On a hard drive it is the whole row.
	const plate = isSsd
		? {
				left: Math.round(height * ssdLabel.left),
				top: Math.round(height * ssdLabel.top),
				bottom: Math.round(height * ssdLabel.bottom),
				right: 4,
				borderRadius: 10,
			}
		: {inset: 0, borderRadius: 12}

	const body = (
		<div className='relative flex overflow-hidden rounded-xl' style={{minHeight: height}}>
			{isSsd && (
				// The SSD lies along the row's left edge and dissolves rightward, as in the health dialog
				<img
					src='/assets/onboarding/ssd-info.webp'
					alt=''
					draggable={false}
					className={cn(
						'pointer-events-none absolute inset-y-0 left-0 h-full w-auto max-w-none transition-[filter] duration-300',
						faded && 'brightness-[0.5] saturate-[0.5]',
					)}
					style={{
						maskImage: 'linear-gradient(to right, black 55%, transparent 100%)',
						WebkitMaskImage: 'linear-gradient(to right, black 55%, transparent 100%)',
					}}
				/>
			)}
			<div
				className={cn('pointer-events-none absolute border', faded && 'border-dashed')}
				style={{
					...plate,
					borderColor: look.border,
					background: `linear-gradient(90deg, ${look.wash} 0%, transparent 80%)`,
					maskImage: fade,
					WebkitMaskImage: fade,
				}}
			/>
			{unusedPart > 0 && (
				<div className='pointer-events-none absolute overflow-hidden' style={plate}>
					<div
						className={cn(
							'absolute inset-y-0 right-0 transition-[width] duration-500 ease-out',
							unusedPart < 100 && 'border-l border-dashed border-white/30',
						)}
						style={{width: `${unusedPart}%`}}
					>
						<span className='absolute inset-0' style={{backgroundImage: hatch, opacity: 0.42}} />
					</div>
				</div>
			)}
			<div
				className={cn('relative flex min-w-0 flex-1 items-center gap-3 pr-3', !isSsd && 'gap-3.5 py-2.5 pl-4')}
				// On an SSD the words start a little way into the label
				style={isSsd ? {paddingLeft: Math.round(height * ssdLabel.left) + 22} : undefined}
			>
				{!isSsd && (
					<HardDriveArt
						led={ledOf(tone, working)}
						pulse={working || tone === 'new'}
						className={cn('transition-opacity duration-300', tone === 'missing' && 'opacity-40')}
					/>
				)}
				<div className='@container flex min-w-0 flex-1 flex-col'>
					<span
						className={cn(
							'flex items-baseline gap-1.5 text-[16px] leading-tight font-bold',
							faded ? 'text-white/60' : 'text-white',
						)}
						style={{textShadow: faded ? undefined : '0 0 8px rgba(255, 255, 255, 0.2)'}}
					>
						{/* A drive the machine can no longer see may have left nothing but its name behind */}
						{view.drive.size > 0 ? formatSize(view.drive.size) : driveOfSize(t, view.drive)}
						{slot && <span className='text-12 font-medium text-white/50'>SSD {slot}</span>}
					</span>
					{/* What needs saying is never cut, and nor is the serial number, the only thing that
					    tells one drive from the next. Where the row is too narrow for both on a line, the
					    note takes a line of its own. The model gives way first: it shortens, and when too
					    little of it would be left to mean anything it steps aside altogether. */}
					<span className='flex min-w-0 flex-col text-12 text-white/50 @[230px]:flex-row @[230px]:items-center'>
						{split ? (
							<span className='flex shrink-0 items-center gap-2 font-semibold'>
								<span className='flex items-center gap-[3px]'>
									<SplitMark icon={PiCheckCircleFill} />
									<span className='sr-only'>{t('storage-setup.split.usable', {size: formatSize(split.usable)})}</span>
									<span aria-hidden>{formatSize(split.usable)}</span>
								</span>
								<span className='flex items-center gap-[3px]'>
									<SplitMark icon={PiXCircleFill} />
									<span className='sr-only'>{t('storage-setup.unusable', {size: formatSize(split.unusable)})}</span>
									<span aria-hidden>{formatSize(split.unusable)}</span>
								</span>
							</span>
						) : (
							note && <span className={cn('shrink-0 font-semibold', look.text)}>{note}</span>
						)}
						{(split || note) && <span className='hidden shrink-0 px-1 @[230px]:inline'>-</span>}
						{/* One line high, filled from the serial backwards: the model is last in line for
						    room, and when it gets none it wraps to a second line that is never seen */}
						<span className='flex h-[1lh] min-w-0 flex-row-reverse flex-wrap justify-end overflow-hidden @[230px]:flex-1'>
							<span className='min-w-0 truncate'>{view.drive.serial}</span>
							{view.drive.model && (
								<span className='flex max-w-max min-w-0 flex-[1_1_5.5em]'>
									<span className='min-w-0 truncate'>{view.drive.model}</span>
									{view.drive.serial && <span className='shrink-0 px-1'>-</span>}
								</span>
							)}
						</span>
					</span>
				</div>
				<div className='flex shrink-0 items-center'>
					{mode === 'select' ? (
						<Tick on={!!picked} className='size-[22px]' />
					) : mode === 'info' ? (
						<InfoPill alert={alertOf(view)} className='size-[26px] p-1' />
					) : tone === 'failed' ? (
						<TbX className='mr-1 size-5 text-[#FF6B6B]' strokeWidth={3} />
					) : null}
				</div>
			</div>
			{/* A rebuild or an expansion runs along the row's foot */}
			{working && (
				<span className='absolute inset-x-2.5 bottom-1 h-0.5 overflow-hidden rounded-full bg-white/10'>
					<span
						className='block h-full rounded-full bg-white/85 transition-[width] duration-300 ease-linear'
						style={{width: `${view.progress}%`}}
					/>
				</span>
			)}
		</div>
	)

	if (!onPick) return <div className='relative min-w-0'>{body}</div>
	return (
		<Hinted hint={view.hint}>
			<button
				type='button'
				onClick={() => onPick(view.id)}
				role={mode === 'select' ? 'checkbox' : undefined}
				aria-checked={mode === 'select' ? !!picked : undefined}
				aria-label={labelOf(view, note, slot)}
				className='group relative block w-full min-w-0 cursor-pointer rounded-xl text-left outline-hidden transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-white/70 active:bg-white/[0.07]'
			>
				{body}
			</button>
		</Hinted>
	)
}

// The mark beside each amount on a partly used drive: a filled disc with the check or cross cut out
// of it, so the row shows through, drawn as one shape so the mark can't sit off centre in its disc.
// Phosphor's disc fills 208 of its 256 units: at 17px it is 14px across, the size of the text's
// cap height and a little.
function SplitMark({icon: Icon}: {icon: typeof PiCheckCircleFill}) {
	return <Icon aria-hidden className='-mx-px size-[17px] shrink-0' />
}

// The badge on the seam between the two drives of a pair
function PairBadge({state}: {state: 'safe' | 'one-down' | 'lost'}) {
	return (
		<span
			className={cn(
				'pointer-events-none absolute top-full left-[21px] z-10 mt-0.5 flex size-[22px] -translate-y-1/2 items-center justify-center rounded-full shadow-md transition-colors duration-300',
				state === 'safe' && 'bg-white text-black',
				state === 'one-down' && 'bg-[#F5A623] text-black/80',
				state === 'lost' && 'bg-[#FF3434] text-white',
			)}
		>
			{state === 'lost' ? <TbShieldOff className='size-3' /> : <IoShieldHalf className='size-3' />}
		</span>
	)
}

const isBrokenView = (view: DriveView) =>
	view.tone === 'failed' || view.tone === 'missing' || view.progress !== undefined

// The bay: every drive of the storage, in the order the storage keeps them, one to a row.
// The two drives of a mirrored pair are held together, the shield on the seam between them.
export function DriveBay({
	drives,
	pairs = [],
	mode = 'info',
	onPick,
	pickedIds = [],
	header,
	footer,
	className,
}: {
	drives: DriveView[]
	pairs?: [string, string][]
	// Names the bay, when it isn't the storage itself
	header?: React.ReactNode
	// Closes the bay: an invitation to add a drive, in Storage Manager
	footer?: React.ReactNode
	className?: string
} & DrivePicking) {
	const reduceMotion = useReducedMotion()
	const slab = (view: DriveView) => (
		<DriveSlab view={view} picked={pickedIds.includes(view.id)} mode={mode} onPick={onPick} />
	)

	// Rows: a pair, or a single drive
	const drawn = new Set<string>()
	const rows: {key: string; views: DriveView[]}[] = []
	for (const view of drives) {
		if (drawn.has(view.id)) continue
		const pair = pairs.find((candidate) => candidate.includes(view.id))
		const partner = pair && drives.find((other) => other.id === pair.find((id) => id !== view.id))
		drawn.add(view.id)
		if (partner) {
			drawn.add(partner.id)
			rows.push({key: view.id, views: [view, partner]})
		} else rows.push({key: view.id, views: [view]})
	}

	const hasPairs = rows.some((row) => row.views.length === 2)

	return (
		<div
			// The rows sit 12 in from the bay's edge, and the bay's corners are drawn around theirs
			className={cn('flex w-full flex-col gap-2 rounded-24 border border-white/10 bg-white/[0.04] p-3', className)}
		>
			{header}
			{rows.map((row, index) => (
				<motion.div
					key={row.key}
					layout={reduceMotion ? false : 'position'}
					initial={reduceMotion ? false : {opacity: 0, y: 8}}
					animate={{opacity: 1, y: 0}}
					transition={{...arrive, delay: Math.min(index, 8) * 0.045}}
					className={cn(
						'relative min-w-0',
						row.views.length === 2 && 'flex flex-col gap-1 rounded-[14px] bg-white/[0.03] p-1 ring-1 ring-white/[0.07]',
						// Beside pairs, a drive on its own stands in by as much as a pair's frame holds
						// its two, so every drive in the bay is the same width and starts at the same place
						row.views.length === 1 && hasPairs && 'px-1',
					)}
				>
					{row.views.length === 2 ? (
						<>
							{/* The shield sits on the seam under the first drive, whatever height its row is */}
							<div className='relative min-w-0'>
								{slab(row.views[0])}
								<PairBadge
									state={row.views.every(isBrokenView) ? 'lost' : row.views.some(isBrokenView) ? 'one-down' : 'safe'}
								/>
							</div>
							{slab(row.views[1])}
						</>
					) : (
						slab(row.views[0])
					)}
				</motion.div>
			))}
			{footer}
		</div>
	)
}

// One part of the picture under a heading of its own, at the level of the section labels beside
// it. A picture with one part needs no heading: pass no title and the part is drawn alone.
export function ArtSection({
	title,
	className,
	children,
}: {
	title?: string
	className?: string
	children: React.ReactNode
}) {
	const headingId = useId()
	if (!title) return <div className={cn('flex w-full flex-col gap-2', className)}>{children}</div>
	return (
		<section aria-labelledby={headingId} className={cn('flex w-full flex-col gap-2', className)}>
			<h3 id={headingId} className='px-1.5 text-13 font-semibold text-white/50'>
				{title}
			</h3>
			{children}
		</section>
	)
}

// Acceleration SSDs: a bay of their own under their own heading, apart from the drives that hold
// the files. With FailSafe the two are mirrored, so they are drawn as the pair they are.
export function AccelBay({
	drives,
	className,
	...picking
}: {
	drives: DriveView[]
	className?: string
} & DrivePicking) {
	const {t} = useTranslation()
	if (drives.length === 0) return null
	return (
		// 8px on top of the column's gap: the heading stands 20px clear of the bay above it
		<ArtSection title={t('storage-ui.acceleration')} className={cn('mt-2', className)}>
			<DriveBay drives={drives} pairs={drives.length === 2 ? [[drives[0].id, drives[1].id]] : []} {...picking} />
		</ArtSection>
	)
}

// The right picture for the machine: the tray on Umbrel Pro, a bay anywhere else
export function StorageArt({
	device,
	drives,
	pairs,
	onEmptySlot,
	footer,
	...picking
}: {
	device: DeviceModel
	drives: DriveView[]
	pairs?: [string, string][]
	onEmptySlot?: () => void
	footer?: React.ReactNode
} & DrivePicking) {
	if (device === 'pro') {
		const slot = (number: number) => drives.find((view) => view.drive.slot === number) ?? null
		// The tray shows an SSD in its slot. One the machine can't place in a slot, which is what a
		// missing SSD usually is, is listed under the tray instead.
		const unplaced = drives.filter(({drive}) => !(drive.slot && drive.slot >= 1 && drive.slot <= 4))
		return (
			<div className='flex w-full flex-col gap-3'>
				<ProTray slots={[slot(1), slot(2), slot(3), slot(4)]} onEmptySlot={onEmptySlot} {...picking} />
				{unplaced.length > 0 && (
					<div className='relative z-10 -mt-3 pr-5 pl-[8%] md:pr-9'>
						<DriveBay drives={unplaced} {...picking} />
					</div>
				)}
			</div>
		)
	}
	return <DriveBay drives={drives} pairs={pairs} footer={footer} {...picking} />
}

// ---------------------------------------------------------------------------
// Where the drives' space goes
// ---------------------------------------------------------------------------

function AnimatedSize({bytes}: {bytes: number}) {
	const inTb = bytes >= TB
	const target = bytes / (inTb ? TB : GB)
	const shown = useAnimatedNumber(target, 360) ?? target
	const whole = Number.isInteger(Math.round(target * 10) / 10)
	const text = whole || !inTb ? Math.round(shown).toString() : (Math.round(shown * 10) / 10).toFixed(1)
	return (
		<span className='tabular-nums'>
			{text}
			{inTb ? 'TB' : 'GB'}
		</span>
	)
}

// One bar for all the drives together, and its key. Available is solid white, FailSafe a
// quieter white, and what can't be used is hatched: none of the three depends on the wallpaper.
export function SpaceBar({capacity, className}: {capacity: Capacity; className?: string}) {
	const {t} = useTranslation()
	const total = capacity.usable + capacity.protection + capacity.unused || 1
	const parts = [
		{label: t('storage-ui.available'), value: capacity.usable, fill: 'bg-white/90', style: undefined},
		{label: t('storage-ui.failsafe'), value: capacity.protection, fill: 'bg-white/35', style: undefined},
		{label: t('storage-ui.unusable'), value: capacity.unused, fill: 'bg-white/[0.07]', style: {backgroundImage: hatch}},
	]
	return (
		<div className={cn('flex w-full flex-col gap-2.5', className)}>
			<div className='flex h-2 w-full' aria-hidden>
				{parts.map((part, index) => (
					<div
						key={index}
						className={cn(
							'h-full min-w-0 rounded-full transition-[flex-grow,margin,opacity] duration-500 ease-out',
							part.fill,
						)}
						style={{
							...part.style,
							flexGrow: part.value / total,
							flexBasis: 0,
							marginLeft: index > 0 && part.value > 0 ? 3 : 0,
							opacity: part.value > 0 ? 1 : 0,
						}}
					/>
				))}
			</div>
			<div data-legend className='flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-12 text-white/50'>
				{parts
					.filter((part) => part.value > 0)
					.map((part, index) => (
						<span key={index} className='flex items-center gap-1.5'>
							<span className={cn('size-2 rounded-full', part.fill)} style={part.style} />
							{part.label}
							<span className='font-medium text-white/85'>
								<AnimatedSize bytes={part.value} />
							</span>
						</span>
					))}
			</div>
		</div>
	)
}

// A size that counts to its new value when a choice changes it
export function Size({bytes, className}: {bytes: number; className?: string}) {
	return (
		<span className={className}>
			<AnimatedSize bytes={bytes} />
		</span>
	)
}

// A layout at a glance: one mark per drive, the quieter ones each a drive's worth set aside
export function LevelGlyph({layout, count, className}: {layout: Layout; count: number; className?: string}) {
	const parity = parityOf(layout)
	const shown = Math.min(Math.max(count, parity + 1, layout === 'mirror' ? 2 : 1), 8)
	const mark = (aside: boolean, key: number) => (
		<span key={key} className={cn('h-[15px] w-[5px] rounded-[2px]', aside ? 'bg-white/35' : 'bg-white/90')} />
	)
	return (
		<span className={cn('flex h-5 shrink-0 items-center gap-[3px]', className)} aria-hidden>
			{layout === 'mirror'
				? Array.from({length: Math.max(1, Math.floor(shown / 2))}).map((_, pair) => (
						<span key={pair} className='flex gap-[2px]'>
							{mark(false, 0)}
							{mark(true, 1)}
						</span>
					))
				: Array.from({length: shown}).map((_, index) => mark(index >= shown - parity, index))}
		</span>
	)
}

// ---------------------------------------------------------------------------
// The storage's state, as one mark
// ---------------------------------------------------------------------------

export type StatusTone = 'protected' | 'unprotected' | 'healthy' | 'attention' | 'critical' | 'busy'

// A disc and a shield, the same on every wallpaper: solid white when protected, quiet when
// there is nothing to protect with, amber and red when something needs doing. While work is
// under way the disc becomes a ring that fills.
export function StatusBadge({tone, progress, className}: {tone: StatusTone; progress?: number; className?: string}) {
	const radius = 20
	const circumference = 2 * Math.PI * radius
	if (tone === 'busy') {
		const known = progress !== undefined
		return (
			<span className={cn('relative flex size-11 shrink-0 items-center justify-center', className)}>
				<svg viewBox='0 0 44 44' className={cn('absolute inset-0 -rotate-90', !known && 'animate-spin')} aria-hidden>
					<circle cx='22' cy='22' r={radius} fill='none' stroke='rgba(255,255,255,0.12)' strokeWidth='3' />
					<circle
						cx='22'
						cy='22'
						r={radius}
						fill='none'
						stroke='white'
						strokeWidth='3'
						strokeLinecap='round'
						strokeDasharray={circumference}
						strokeDashoffset={circumference * (1 - (known ? Math.max(2, progress) : 25) / 100)}
						className='transition-[stroke-dashoffset] duration-300 ease-linear'
					/>
				</svg>
				<IoShieldHalf className='size-[18px] text-white/75' />
			</span>
		)
	}
	return (
		<span
			className={cn(
				'flex size-11 shrink-0 items-center justify-center rounded-full',
				tone === 'protected' && 'bg-white text-black shadow-[0_6px_18px_-6px_rgba(255,255,255,0.55)]',
				(tone === 'unprotected' || tone === 'healthy') && 'bg-white/10 text-white/80',
				tone === 'attention' && 'bg-[#F5A623] text-black/80',
				tone === 'critical' && 'bg-[#FF3434] text-white',
				className,
			)}
		>
			{tone === 'healthy' ? (
				<TbCheck className='size-[22px]' strokeWidth={2.5} />
			) : tone === 'unprotected' || tone === 'critical' ? (
				<TbShieldOff className='size-[22px]' />
			) : (
				<IoShieldHalf className='size-[22px]' />
			)}
		</span>
	)
}

// ---------------------------------------------------------------------------
// One drive, small: for rows and lists
// ---------------------------------------------------------------------------

export function SsdChipArt({size, tone = 'in', className}: {size: number; tone?: DriveTone; className?: string}) {
	const failed = tone === 'failed' || tone === 'missing'
	return (
		<span className={cn('relative flex h-9 w-[60px] shrink-0 items-center justify-center', className)}>
			<img
				src={ssdChip}
				alt=''
				draggable={false}
				className={cn('size-full object-fill', (failed || tone === 'out') && 'brightness-[0.6]')}
			/>
			<span
				className={cn(
					'absolute rounded-[5px] border px-1.5 py-0.5 text-[11px] font-semibold tracking-tight whitespace-nowrap',
					failed
						? 'border-[#FF3434]/70 bg-[#3a1516] text-[#FF8080]'
						: tone === 'new'
							? 'border-[#2DD4BF]/60 bg-[#12302c] text-[#7CEBDC]'
							: tone === 'warning'
								? 'border-[#F5A623]/60 bg-[#33260f] text-[#F5C469]'
								: 'border-white/15 bg-[#232326] text-white',
					tone === 'out' && 'text-white/50',
				)}
			>
				{size > 0 ? formatSize(size) : 'SSD'}
			</span>
		</span>
	)
}

export function DriveArt({drive, tone = 'in', className}: {drive: Drive; tone?: DriveTone; className?: string}) {
	if (drive.kind === 'ssd') return <SsdChipArt size={drive.size} tone={tone} className={className} />
	return <HardDriveArt led={ledOf(tone, false)} pulse={tone === 'new'} className={className} />
}
