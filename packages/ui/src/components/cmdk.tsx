import {Search as SearchIcon} from 'lucide-react'
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type SetStateAction,
} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useTranslation} from 'react-i18next'

import {CommandDialog, CommandInput} from '@/components/ui/command'
import {DialogTitle} from '@/components/ui/dialog'
import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {materialSurfaceClasses} from '@/components/ui/shared/material'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {IS_DEV} from '@/utils/misc'

import {CmdkDomainChip, nextCmdkDomain, useCmdkDomainCopy, type CmdkDomain} from './cmdk-domain'
import {useCmdkGridNavigation} from './cmdk-navigation'
import {CmdkResultsList} from './cmdk-results'
import {cmdkMoreValue, useCmdkResults} from './cmdk-sources'
import {Orb, useOrbPalette} from './orb/orb'
import {rgbCss, type OrbPalette} from './orb/orb-palette'

// Cmd+K: the wallpaper's orb over a glass card. Type and the orb stirs; the
// card grows and shrinks with what it finds. Tab widens or narrows where it
// looks (Everywhere, Files, Photos, App Store, Settings), and the arrows walk
// results laid out as rows and as grids of tiles alike.

type CmdkContextValue = {
	open: boolean
	setOpen: (value: SetStateAction<boolean>) => void
}

const CmdkContext = createContext<CmdkContextValue | null>(null)

function useCmdk() {
	const ctx = useContext(CmdkContext)
	if (!ctx) throw new Error('useCmdk must be used within a CmdkProvider')
	return ctx
}

export function useCmdkOpen() {
	return useCmdk()
}

export function CmdkProvider({children}: {children: React.ReactNode}) {
	const [open, setOpen] = useState(false)

	// Register Cmd+K listener once here, not in useCmdkOpen (which is called
	// by multiple components and would register duplicate listeners).
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault()
				setOpen((open) => !open)
			}
		}
		document.addEventListener('keydown', handler)
		return () => document.removeEventListener('keydown', handler)
	}, [])

	// A refresh-safe way to land on the open palette while working on it
	useEffect(() => {
		if (IS_DEV && new URLSearchParams(window.location.search).get('cmdk') === 'open') setOpen(true)
	}, [])

	const value = useMemo(() => ({open, setOpen}), [open])
	return <CmdkContext value={value}>{children}</CmdkContext>
}

const ORB_SIZE = {desktop: 88, mobile: 64}
// Matches the stage's close hold in index.css
const EXIT_HOLD_MS = 240
// Keys that move the selection, ours or cmdk's own
const NAVIGATION_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])
// How long after the last keystroke the orb settles
const STIR_SETTLE_MS = 450

export function CmdkMenu() {
	const {t} = useTranslation()
	const {open, setOpen} = useCmdk()
	const isMobile = useIsMobile()
	const palette = useOrbPalette()
	const {placeholder} = useCmdkDomainCopy()
	const [domain, setDomain] = useState<CmdkDomain>('everywhere')
	const [query, setQuery] = useState('')
	const [value, setValue] = useState('')
	const [energy, setEnergy] = useState(0)
	const [pressed, setPressed] = useState(false)
	const [pulseKey, setPulseKey] = useState(0)
	const inputRef = useRef<HTMLInputElement>(null)
	const listRef = useRef<HTMLDivElement>(null)
	const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const close = useCallback(() => setOpen(false), [setOpen])
	// Searches run while open and through the exit animation, so the card
	// doesn't empty as it leaves; on the next open they fetch afresh
	const active = useHeldOpen(open, EXIT_HOLD_MS)
	const results = useCmdkResults({domain, query, active, close})
	const navigateGrid = useCmdkGridNavigation(listRef, value, setValue)

	// The search survives closing — picking a result, or a route change under
	// the palette, doesn't throw away what was typed; only clearing does.
	// Reopening selects the text whole, so typing replaces it and Enter
	// re-runs it. Selection starts fresh, before paint.
	useLayoutEffect(() => {
		if (!open) {
			setPressed(false)
			return
		}
		setValue('')
		setEnergy(0)
	}, [open])

	useEffect(() => {
		if (!open) return
		const frame = requestAnimationFrame(() => inputRef.current?.select())
		return () => cancelAnimationFrame(frame)
	}, [open])

	// The selection is controlled, and a value set through the prop skips
	// cmdk's own scroll-into-view and its aria-activedescendant refresh. Do
	// both here, once the list has committed. The item is found by value:
	// its own aria-selected render can still be a beat behind.
	useEffect(() => {
		if (!open) return
		const list = listRef.current
		const input = inputRef.current
		if (!list || !input) return
		const selected = value ? list.querySelector<HTMLElement>(`[cmdk-item][data-value="${CSS.escape(value)}"]`) : null
		if (!selected) {
			input.removeAttribute('aria-activedescendant')
			return
		}
		selected.scrollIntoView({block: 'nearest'})
		input.setAttribute('aria-activedescendant', selected.id)
	}, [open, value])

	// cmdk selects the first item when the search changes, but the server
	// searches land a beat later and can reorder the sections, and a scope
	// switch can keep the same items mounted. So whenever the set of results
	// changes, the selection follows the best result — unless the user has
	// moved it since the last keystroke, in which case theirs stays as long as
	// it is still something on offer: a result, a section's "More", the footer.
	const userMovedRef = useRef(false)
	// cmdk moves the selection itself on Home, End, Alt+arrows and its vim
	// bindings; a change that arrives while one of those keys is down is the
	// user's too
	const navKeyDownRef = useRef(false)
	const resultValues = useMemo(
		() =>
			results.sections.flatMap((section) => section.items.filter((item) => !item.disabled).map((item) => item.value)),
		[results.sections],
	)
	const selectableValues = useMemo(
		() => [
			...resultValues,
			...results.sections.filter((section) => section.more).map((section) => cmdkMoreValue(section.id)),
			...(results.footer ? [results.footer.value] : []),
		],
		[resultValues, results.sections, results.footer],
	)
	const selectableSignature = selectableValues.join('\n')
	const valueRef = useRef(value)
	valueRef.current = value
	useEffect(() => {
		if (!open || resultValues.length === 0) return
		if (!userMovedRef.current || !selectableValues.includes(valueRef.current)) setValue(resultValues[0])
	}, [open, selectableSignature])

	// A new query starts at the top. cmdk only scrolls when the selected value
	// changes, and the best match often stays the same from one keystroke to
	// the next, so a list scrolled by earlier browsing would sit where it was.
	useLayoutEffect(() => {
		listRef.current?.scrollTo({top: 0})
	}, [query, domain])

	useEffect(() => () => clearTimeout(settleTimer.current), [])

	const stir = () => {
		setEnergy(1)
		clearTimeout(settleTimer.current)
		settleTimer.current = setTimeout(() => setEnergy(0), STIR_SETTLE_MS)
	}

	const switchDomain = (next: CmdkDomain) => {
		if (next === domain) return
		setDomain(next)
		setValue('')
		userMovedRef.current = false
		setPulseKey((key) => key + 1)
	}

	return (
		<CommandDialog
			open={open}
			onOpenChange={setOpen}
			onEscapeKeyDown={(event) => {
				// Escape clears a search first; a second press closes
				if (!query) return
				event.preventDefault()
				setQuery('')
			}}
			commandProps={{
				value,
				onValueChange: (next) => {
					if (navKeyDownRef.current) userMovedRef.current = true
					setValue(next)
				},
			}}
		>
			<DialogTitle className='sr-only'>{t('search')}</DialogTitle>
			<CmdkOrbStage
				size={isMobile ? ORB_SIZE.mobile : ORB_SIZE.desktop}
				palette={palette}
				energy={energy}
				pressed={pressed}
				pulseKey={pulseKey}
			/>
			<CmdkCard>
				<CommandInput
					ref={inputRef}
					autoFocus
					value={query}
					onValueChange={(next) => {
						setQuery(next)
						userMovedRef.current = false
						stir()
					}}
					placeholder={placeholder(domain)}
					aria-label={t('search')}
					leading={<SearchIcon className='size-4' strokeWidth={2.25} aria-hidden='true' />}
					trailing={
						<CmdkDomainChip
							domain={domain}
							palette={palette}
							onChange={switchDomain}
							onCloseAutoFocus={() => inputRef.current?.focus()}
						/>
					}
					onClear={() => setQuery('')}
					clearLabel={t('cmdk.clear-search')}
					wrapperClassName='h-11 rounded-full bg-white/6 pr-1.5 pl-3.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_0_0_0.5px_rgb(255_255_255/0.08)] sm:h-12'
					className='px-2.5 text-14 sm:text-15'
					onKeyDown={(event) => {
						// An IME owns the keys while composing (Tab, arrows and space pick candidates)
						if (event.nativeEvent.isComposing || event.keyCode === 229) return
						navKeyDownRef.current = NAVIGATION_KEYS.has(event.key) || (event.ctrlKey && /^[npjk]$/i.test(event.key))
						if (event.key === 'Tab') {
							// Ours, not the dialog's focus trap: the field keeps focus
							event.preventDefault()
							event.stopPropagation()
							switchDomain(nextCmdkDomain(domain, event.shiftKey ? -1 : 1))
							return
						}
						// Typing presses the orb; a space, ending a word, flashes it
						const typing =
							!event.metaKey &&
							!event.ctrlKey &&
							!event.altKey &&
							(event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete')
						if (typing && !event.repeat) {
							setPressed(true)
							if (event.key === ' ') setPulseKey((key) => key + 1)
						}
						navigateGrid(event)
						if (event.defaultPrevented) userMovedRef.current = true
					}}
					onKeyUp={() => {
						navKeyDownRef.current = false
						setPressed(false)
					}}
					onBlur={() => setPressed(false)}
				/>
				<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
					{/* cmdk selects whatever the pointer passes over; that counts as the user's choice too */}
					<div onPointerMove={() => (userMovedRef.current = true)} className='contents'>
						<CmdkResultsList results={results} listRef={listRef} />
					</div>
				</ErrorBoundary>
			</CmdkCard>
		</CommandDialog>
	)
}

// The orb and its glow. It rises into place as the palette opens and sinks
// away as it closes (keyframes in index.css); keys press it, a space flashes it.
function CmdkOrbStage({
	size,
	palette,
	energy,
	pressed,
	pulseKey,
}: {
	size: number
	palette: OrbPalette
	energy: number
	pressed: boolean
	pulseKey: number
}) {
	return (
		<div className='cmdk-orb-stage relative mb-4 shrink-0 sm:mb-5' style={{width: size, height: size}}>
			<div
				aria-hidden='true'
				className='pointer-events-none absolute -inset-[45%] rounded-full'
				style={{
					background: `radial-gradient(circle, ${rgbCss(palette.primary, 0.32)} 0%, ${rgbCss(palette.secondary, 0.1)} 38%, transparent 66%)`,
				}}
			/>
			<div className='cmdk-orb-body relative' data-pressed={pressed ? '' : undefined}>
				<Orb size={size} palette={palette} energy={energy} pulseKey={pulseKey} />
			</div>
		</div>
	)
}

// The glass card. Its height follows the content through a transition, so
// results arriving or leaving glide the card open and closed rather than
// snap it. The first measurement snaps, before anything has been seen.
function CmdkCard({children}: {children: React.ReactNode}) {
	const outerRef = useRef<HTMLDivElement>(null)
	const innerRef = useRef<HTMLDivElement>(null)

	useLayoutEffect(() => {
		const outer = outerRef.current
		const inner = innerRef.current
		if (!outer || !inner) return
		let measured = false
		const observer = new ResizeObserver(() => {
			const height = inner.offsetHeight
			if (!measured) {
				measured = true
				outer.style.transition = 'none'
				outer.style.height = `${height}px`
				void outer.offsetHeight
				outer.style.transition = ''
				return
			}
			outer.style.height = `${height}px`
		})
		observer.observe(inner)
		return () => observer.disconnect()
	}, [])

	return (
		<div ref={outerRef} className={cn(materialSurfaceClasses.modal, 'cmdk-card w-full overflow-hidden')}>
			<div ref={innerRef} className='p-3'>
				{children}
			</div>
		</div>
	)
}

// `open`, but staying true for `holdMs` after it turns false
function useHeldOpen(open: boolean, holdMs: number) {
	const [held, setHeld] = useState(open)
	useEffect(() => {
		if (open) {
			setHeld(true)
			return
		}
		const timer = setTimeout(() => setHeld(false), holdMs)
		return () => clearTimeout(timer)
	}, [open, holdMs])
	return held || open
}
