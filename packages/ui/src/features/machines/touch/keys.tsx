// The guest and controller are mutable objects, which the React Compiler can't
// see change
'use no memo'

import {ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, Delete, TextCursorInput} from 'lucide-react'
import {useEffect, useRef, useState, useSyncExternalStore, type PointerEvent, type ReactNode} from 'react'

import {cn} from '@/lib/utils'
import {t} from '@/utils/i18n'

import type {Controller, Modifier} from './controller'
import type {GuestFamily} from './guest'
import {functionKey, XK} from './keysyms'

export const KEY_ROW_HEIGHT = 48
export const COMPACT_KEY_ROW_HEIGHT = 38

function useControllerState(controller: Controller) {
	useSyncExternalStore(controller.subscribe, controller.getVersion)
}

// The system keyboard stays up while keys are pressed only if the touch never
// reaches the page: pointer events still arrive, a click doesn't.
export function useKeepFocus() {
	const element = useRef<HTMLDivElement>(null)
	useEffect(() => {
		const node = element.current
		if (!node) return
		const stop = (event: TouchEvent) => {
			if ((event.target as HTMLElement).closest('textarea')) return
			event.preventDefault()
		}
		node.addEventListener('touchstart', stop, {passive: false})
		return () => node.removeEventListener('touchstart', stop)
	}, [])
	return element
}

function Cap({
	children,
	label,
	className,
	state = 'off',
	onDown,
	onUp,
}: {
	children: ReactNode
	label: string
	className?: string
	state?: 'off' | 'latched' | 'locked'
	onDown?: () => void
	onUp?: () => void
}) {
	const [pressed, setPressed] = useState(false)
	const down = (event: PointerEvent<HTMLButtonElement>) => {
		event.preventDefault()
		event.currentTarget.setPointerCapture(event.pointerId)
		setPressed(true)
		onDown?.()
	}
	const up = () => {
		if (!pressed) return
		setPressed(false)
		onUp?.()
	}
	return (
		<button
			type='button'
			tabIndex={-1}
			aria-label={label}
			aria-pressed={state === 'off' ? undefined : true}
			onPointerDown={down}
			onPointerUp={up}
			onPointerCancel={up}
			onContextMenu={(event) => event.preventDefault()}
			data-pressed={pressed || undefined}
			data-state={state === 'off' ? undefined : state}
			className={cn(
				'console-key relative grid min-w-0 flex-1 touch-none place-items-center rounded-[9px] text-[13px] font-medium -tracking-[0.01em] transition-[background-color,color] duration-100 outline-none select-none',
				className,
			)}
		>
			{children}
			{state === 'locked' && <span className='absolute bottom-[3px] h-[2px] w-3 rounded-full bg-current opacity-70' />}
		</button>
	)
}

function KeyCap({
	controller,
	keysym,
	label,
	children,
	className,
}: {
	controller: Controller
	keysym: number
	label: string
	children: ReactNode
	className?: string
}) {
	return (
		<Cap
			label={label}
			className={className}
			onDown={() => controller.keyDown(keysym)}
			onUp={() => controller.keyUp(keysym)}
		>
			{children}
		</Cap>
	)
}

function ModifierCap({
	controller,
	modifier,
	children,
	className,
}: {
	controller: Controller
	modifier: Modifier
	children: ReactNode
	className?: string
}) {
	useControllerState(controller)
	return (
		<Cap
			label={modifier}
			className={className}
			state={controller.modifiers[modifier]}
			onDown={() => controller.tapModifier(modifier)}
		>
			{children}
		</Cap>
	)
}

function ChordCap({
	controller,
	keysyms,
	label,
	children,
	className,
}: {
	controller: Controller
	keysyms: number[]
	label: string
	children: ReactNode
	className?: string
}) {
	return (
		<Cap label={label} className={className} onDown={() => controller.chord(...keysyms)}>
			{children}
		</Cap>
	)
}

const iconClass = 'size-[15px]'
const SUPER_LABEL: Record<GuestFamily, string> = {windows: 'win', linux: 'super', android: 'home'}

// A modifier stays on after its keys are out of sight, so whatever hides them
// still shows it
export function ModifierDot({controller, className}: {controller: Controller; className?: string}) {
	useControllerState(controller)
	if (Object.values(controller.modifiers).every((state) => state === 'off')) return null
	return <span className={cn('pointer-events-none absolute size-[6px] rounded-full bg-[#0a84ff]', className)} />
}

// What a phone keyboard leaves out, riding on top of it. A wide screen has room
// for Super as well, and groups the keys instead of stretching them.
export function KeyRow({
	controller,
	height,
	wide,
	onDismiss,
	onCompose,
	composing,
}: {
	controller: Controller
	height: number
	wide: boolean
	onDismiss: () => void
	onCompose: () => void
	composing: boolean
}) {
	const element = useKeepFocus()
	const capClass = wide ? 'max-w-[68px]' : undefined
	const gap = wide ? 'flex-1' : 'w-[3px] shrink-0'
	return (
		<div ref={element} className='flex gap-[5px] px-[6px] py-[4px]' style={{height}}>
			<KeyCap controller={controller} keysym={XK.Escape} label='Escape' className={capClass}>
				esc
			</KeyCap>
			<KeyCap controller={controller} keysym={XK.Tab} label='Tab' className={capClass}>
				tab
			</KeyCap>
			<ModifierCap controller={controller} modifier='ctrl' className={capClass}>
				ctrl
			</ModifierCap>
			<ModifierCap controller={controller} modifier='alt' className={capClass}>
				alt
			</ModifierCap>
			{wide && (
				<KeyCap controller={controller} keysym={XK.Super} label='Super' className={capClass}>
					{SUPER_LABEL[controller.guest.family]}
				</KeyCap>
			)}
			<div className={gap} />
			<KeyCap controller={controller} keysym={XK.Left} label='Left' className='max-w-9'>
				<ArrowLeft className={iconClass} />
			</KeyCap>
			<KeyCap controller={controller} keysym={XK.Up} label='Up' className='max-w-9'>
				<ArrowUp className={iconClass} />
			</KeyCap>
			<KeyCap controller={controller} keysym={XK.Down} label='Down' className='max-w-9'>
				<ArrowDown className={iconClass} />
			</KeyCap>
			<KeyCap controller={controller} keysym={XK.Right} label='Right' className='max-w-9'>
				<ArrowRight className={iconClass} />
			</KeyCap>
			<div className={gap} />
			<Cap
				label={t('machines.touch-compose')}
				state={composing ? 'latched' : 'off'}
				className='max-w-9'
				onDown={onCompose}
			>
				<TextCursorInput className={iconClass} />
			</Cap>
			<Cap label={t('machines.touch-hide-keyboard')} className='max-w-9' onUp={onDismiss}>
				<ChevronDown className='size-[18px]' />
			</Cap>
		</div>
	)
}

const fKeys = Array.from({length: 12}, (_, index) => index + 1)

// The half of a PC keyboard a phone doesn't have. Laid out like the real thing,
// so a key is where you'd reach for it, and as a strip along a tablet's deck.
// Chords run at once: a Ctrl+Alt+Del can't wait for a second tap at a Windows login.
export function KeysPanel({
	controller,
	strip,
	className,
}: {
	controller: Controller
	strip?: boolean
	className?: string
}) {
	const rowClass = 'flex min-h-0 gap-[5px]'
	const clusterClass = 'grid flex-1 grid-cols-3 grid-rows-2 gap-[5px]'
	const functionKeys = (from: number, to: number) =>
		fKeys
			.slice(from, to)
			.map((n) => <KeyCap key={n} controller={controller} keysym={functionKey(n)} label={`F${n}`}>{`F${n}`}</KeyCap>)
	const escape = (
		<KeyCap controller={controller} keysym={XK.Escape} label='Escape'>
			esc
		</KeyCap>
	)
	const tabAndModifiers = (
		<>
			<KeyCap controller={controller} keysym={XK.Tab} label='Tab'>
				tab
			</KeyCap>
			<ModifierCap controller={controller} modifier='ctrl'>
				ctrl
			</ModifierCap>
			<ModifierCap controller={controller} modifier='alt'>
				alt
			</ModifierCap>
			<ModifierCap controller={controller} modifier='shift'>
				shift
			</ModifierCap>
			<KeyCap controller={controller} keysym={XK.Super} label='Super'>
				{SUPER_LABEL[controller.guest.family]}
			</KeyCap>
		</>
	)
	const clusters = (
		<>
			<div className={clusterClass}>
				<KeyCap controller={controller} keysym={XK.Insert} label='Insert'>
					ins
				</KeyCap>
				<KeyCap controller={controller} keysym={XK.Home} label='Home'>
					home
				</KeyCap>
				<KeyCap controller={controller} keysym={XK.PageUp} label='Page Up'>
					pg up
				</KeyCap>
				<KeyCap controller={controller} keysym={XK.Delete} label='Delete'>
					<Delete className={iconClass} />
				</KeyCap>
				<KeyCap controller={controller} keysym={XK.End} label='End'>
					end
				</KeyCap>
				<KeyCap controller={controller} keysym={XK.PageDown} label='Page Down'>
					pg dn
				</KeyCap>
			</div>
			<div className={clusterClass}>
				<div />
				<KeyCap controller={controller} keysym={XK.Up} label='Up'>
					<ArrowUp className={iconClass} />
				</KeyCap>
				<div />
				<KeyCap controller={controller} keysym={XK.Left} label='Left'>
					<ArrowLeft className={iconClass} />
				</KeyCap>
				<KeyCap controller={controller} keysym={XK.Down} label='Down'>
					<ArrowDown className={iconClass} />
				</KeyCap>
				<KeyCap controller={controller} keysym={XK.Right} label='Right'>
					<ArrowRight className={iconClass} />
				</KeyCap>
			</div>
		</>
	)
	const chords = (
		<div className={rowClass}>
			<ChordCap
				controller={controller}
				keysyms={[XK.Control, XK.Alt, XK.Delete]}
				label='Control Alt Delete'
				className='flex-[1.5]'
			>
				ctrl alt del
			</ChordCap>
			<ChordCap controller={controller} keysyms={[XK.Alt, XK.Tab]} label='Alt Tab'>
				alt tab
			</ChordCap>
			<ChordCap controller={controller} keysyms={[XK.Alt, functionKey(4)]} label='Alt F4'>
				alt F4
			</ChordCap>
			<KeyCap controller={controller} keysym={XK.Print} label='Print Screen'>
				prt sc
			</KeyCap>
		</div>
	)

	if (strip) {
		return (
			<div className={cn('grid grid-rows-3 gap-[5px]', className)}>
				<div className={rowClass}>
					{escape}
					{functionKeys(0, 12)}
				</div>
				<div className='row-span-2 flex min-h-0 gap-[5px]'>
					<div className='grid flex-[2] grid-rows-2 gap-[5px]'>
						<div className={rowClass}>{tabAndModifiers}</div>
						{chords}
					</div>
					{clusters}
				</div>
			</div>
		)
	}
	return (
		<div className={cn('grid grid-rows-6 gap-[5px]', className)}>
			<div className={rowClass}>
				{escape}
				{tabAndModifiers}
			</div>
			<div className={rowClass}>{functionKeys(0, 6)}</div>
			<div className={rowClass}>{functionKeys(6, 12)}</div>
			<div className='row-span-2 flex min-h-0 gap-[5px]'>{clusters}</div>
			{chords}
		</div>
	)
}
