import {ChevronDown, Minus, Plus} from 'lucide-react'
import {useEffect, useRef, useState, type ComponentType} from 'react'
import {useTranslation} from 'react-i18next'

import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {useReturnFocus} from '@/features/files/components/file-viewer/shell/context'
import {cn} from '@/lib/utils'
import {touchTargetClass} from '@/utils/element-classes'
import {tw} from '@/utils/tw'

// Fits follow the stage as it resizes; a number is a fixed scale (1 = 100%)
export type ZoomPreset = 'page-width' | 'page-fit' | number

const PERCENTS = [50, 75, 100, 125, 150, 200, 300, 400]
// How long a floating pill stays once nothing is happening, and how near it a moving mouse has to come to bring it back
const IDLE_MS = 1500
const NEAR = 120

// Floating controls sit over white paper as often as over the dark stage: a
// denser glass than the chrome's keeps their white legible over both
export const floatingGlassClass = tw`settings-edge-material bg-black/65 backdrop-blur-xl`
// The menus that open from them, made as dense
export const floatingMenuClass = tw`[--material-brightness:75%] [--material-tint-opacity:0.65]`

// A round icon button inside a floating pill
export const pillButtonClass = cn(
	touchTargetClass,
	tw`flex size-8 shrink-0 items-center justify-center rounded-full text-white/80 transition-[background-color,color,transform] duration-200 hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:outline-hidden active:scale-90 disabled:pointer-events-none disabled:opacity-35`,
)

// Like Safari everywhere: a press on a control leaves the keyboard where it was (the document scrolling, a find field
// or an annotation being typed in, Space and the arrows turning slides)
export const keepFocus = (event: React.MouseEvent) => event.preventDefault()

// True for `ms` after each wake(): for controls that fade out of the way once nothing is happening
export function useAwake(ms = IDLE_MS) {
	const [awake, setAwake] = useState(true)
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
	useEffect(() => {
		timer.current = setTimeout(() => setAwake(false), ms)
		return () => clearTimeout(timer.current)
	}, [ms])
	const wake = () => {
		setAwake(true)
		clearTimeout(timer.current)
		timer.current = setTimeout(() => setAwake(false), ms)
	}
	return [awake, wake] as const
}

// Whether a pointer brings a floating pill back: a finger anywhere, or a mouse with no button down coming near it. A
// mouse elsewhere on the page (reading, drawing, selecting) leaves it be.
export const wakesPill = (event: PointerEvent | React.PointerEvent, pill: HTMLElement | null) =>
	event.pointerType === 'touch' ||
	(event.buttons === 0 && event.clientY > (pill?.getBoundingClientRect().top ?? Infinity) - NEAR)

// Controls floating over the bottom of the stage, which keep out of the way: up while `awake` or `held` (a menu of
// their own open), hovered or focused from the keyboard, and gone once things settle, never while they're in use
export function FloatingPill({
	label,
	awake,
	held = false,
	pillRef,
	className,
	children,
	...props
}: React.HTMLAttributes<HTMLDivElement> & {
	label: string
	awake: boolean
	held?: boolean
	pillRef?: React.Ref<HTMLDivElement>
}) {
	const [hovered, setHovered] = useState(false)
	const [focused, setFocused] = useState(false)
	const shown = awake || held || hovered || focused
	return (
		<div className={cn('pointer-events-none absolute inset-x-0 z-10 flex justify-center px-4', className)}>
			<div
				ref={pillRef}
				role='toolbar'
				aria-label={label}
				onPointerEnter={() => setHovered(true)}
				onPointerLeave={() => setHovered(false)}
				// Focus from the keyboard holds it; a clicked button keeps focus too, and
				// mustn't keep the pill up forever
				onFocus={(event) => event.target.matches(':focus-visible') && setFocused(true)}
				onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && setFocused(false)}
				className={cn(
					floatingGlassClass,
					'flex h-10 items-center rounded-full px-1 text-13 font-medium text-white/85 tabular-nums transition-opacity duration-300 motion-reduce:transition-none',
					shown ? 'pointer-events-auto opacity-100' : 'opacity-0',
				)}
				{...props}
			>
				{children}
			</div>
		</div>
	)
}

// The document's zoom and place, floating over the bottom of the stage. It
// keeps out of the way: present while the document scrolls, or a finger
// touches it, or the mouse comes near — gone once things settle, never while
// it's being used.
export function ZoomPill({
	zoom,
	preset,
	onZoomIn,
	onZoomOut,
	onPreset,
	page,
	pageCount,
	onPage,
	target,
}: {
	// Percent, as shown
	zoom: number
	// The fit in force, if the zoom is one
	preset?: ZoomPreset
	onZoomIn: () => void
	onZoomOut: () => void
	onPreset: (preset: ZoomPreset) => void
	page: number
	pageCount: number
	onPage: (page: number) => void
	// Where scrolling and pointer movement wake the pill
	target: HTMLElement | null
}) {
	const {t, i18n} = useTranslation()
	const returnFocus = useReturnFocus()
	const percent = new Intl.NumberFormat(i18n.language, {style: 'percent', maximumFractionDigits: 0})
	const pillRef = useRef<HTMLDivElement>(null)
	const [awake, wake] = useAwake()
	const [menu, setMenu] = useState(false)

	useEffect(() => {
		if (!target) return
		const near = (event: PointerEvent) => wakesPill(event, pillRef.current) && wake()
		wake()
		// Scrolling doesn't bubble, but it can be captured
		const abort = new AbortController()
		const options = {capture: true, passive: true, signal: abort.signal}
		target.addEventListener('scroll', wake, options)
		target.addEventListener('wheel', wake, options)
		target.addEventListener('pointermove', near, options)
		target.addEventListener('pointerdown', near, options)
		return () => abort.abort()
	}, [target])

	return (
		<FloatingPill label={t('files-viewer.zoom')} awake={awake} held={menu} pillRef={pillRef} className='bottom-4'>
			<PillButton icon={Minus} label={t('files-viewer.zoom-out')} onClick={onZoomOut} className='max-md:hidden' />
			<DropdownMenu onOpenChange={setMenu}>
				<DarkTooltip label={t('files-viewer.zoom')}>
					<DropdownMenuTrigger asChild>
						<button
							type='button'
							aria-label={t('files-viewer.zoom-level', {zoom: percent.format(zoom / 100)})}
							className={cn(pillButtonClass, 'w-auto gap-1 px-2.5')}
						>
							{percent.format(zoom / 100)}
							<ChevronDown className='size-3.5 opacity-60' />
						</button>
					</DropdownMenuTrigger>
				</DarkTooltip>
				<DropdownMenuContent
					side='top'
					align='center'
					sideOffset={10}
					// Back to the document, not to the button (and its tooltip)
					onCloseAutoFocus={returnFocus}
					className={cn(floatingMenuClass, 'min-w-40')}
				>
					<DropdownMenuCheckboxItem checked={preset === 'page-width'} onSelect={() => onPreset('page-width')}>
						{t('files-viewer.fit-width')}
					</DropdownMenuCheckboxItem>
					<DropdownMenuCheckboxItem checked={preset === 'page-fit'} onSelect={() => onPreset('page-fit')}>
						{t('files-viewer.fit-page')}
					</DropdownMenuCheckboxItem>
					<DropdownMenuItem onSelect={() => onPreset(1)}>{t('files-viewer.actual-size')}</DropdownMenuItem>
					<DropdownMenuSeparator />
					{PERCENTS.map((value) => (
						<DropdownMenuCheckboxItem
							key={value}
							checked={typeof preset !== 'string' && Math.round(zoom) === value}
							onSelect={() => onPreset(value / 100)}
							className='tabular-nums'
						>
							{percent.format(value / 100)}
						</DropdownMenuCheckboxItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			<PillButton icon={Plus} label={t('files-viewer.zoom-in')} onClick={onZoomIn} className='max-md:hidden' />
			<PillDivider />
			<PageField page={page} pageCount={pageCount} onPage={onPage} />
		</FloatingPill>
	)
}

// A round button inside a floating pill: an icon, or what it shows instead (a stroke's width, a text size). One that
// toggles says whether it's on through `active`.
export function PillButton({
	icon: Icon,
	label,
	active,
	className,
	tooltipSide,
	children,
	...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
	icon?: ComponentType<{className?: string}>
	label: string
	active?: boolean
	tooltipSide?: 'top' | 'bottom'
}) {
	return (
		<DarkTooltip label={label} side={tooltipSide}>
			<button
				type='button'
				aria-label={label}
				aria-pressed={active}
				onMouseDown={keepFocus}
				className={cn(pillButtonClass, active && 'bg-white/20 text-white hover:bg-white/25', className)}
				{...props}
			>
				{Icon ? <Icon className='size-4' /> : children}
			</button>
		</DarkTooltip>
	)
}

// Between groups of controls in a floating pill
export function PillDivider() {
	return <div className='mx-1 h-4 w-px shrink-0 bg-white/15' />
}

// The page number, typed over to jump: Enter goes, Escape (or leaving the
// field) puts back the page the document is on
function PageField({page, pageCount, onPage}: {page: number; pageCount: number; onPage: (page: number) => void}) {
	const {t} = useTranslation()
	const inputRef = useRef<HTMLInputElement>(null)
	const [draft, setDraft] = useState<string>()

	return (
		<div className='flex items-center gap-1.5 pr-3 pl-1 text-white/50'>
			{/* A field can't reach further than itself: its label does, for a fingertip */}
			<label className={cn(touchTargetClass, 'flex')}>
				<input
					ref={inputRef}
					// Text, not number: no spinner, and editors' shortcuts leave text fields alone
					type='text'
					inputMode='numeric'
					aria-label={t('files-viewer.page')}
					value={draft ?? String(page)}
					onFocus={(event) => {
						setDraft(String(page))
						event.target.select()
					}}
					// Safari puts the caret where a click landed once the button comes up, undoing that selection: a new
					// number typed would join the old one
					onMouseUp={(event) => event.preventDefault()}
					onBlur={() => setDraft(undefined)}
					onChange={(event) => setDraft(event.target.value.replace(/\D/g, ''))}
					onKeyDown={(event) => {
						if (event.key !== 'Enter') return
						const target = Number(draft)
						if (target >= 1) onPage(Math.min(target, pageCount))
						setDraft(undefined)
						inputRef.current?.blur()
					}}
					style={{width: `${Math.max(String(pageCount).length, 1) + 1.5}ch`}}
					className='h-7 rounded-8 bg-white/8 text-center text-white/90 transition-colors outline-none hover:bg-white/12 focus:bg-white/15'
				/>
			</label>
			<span aria-hidden='true'>/</span>
			<span>{pageCount}</span>
		</div>
	)
}
