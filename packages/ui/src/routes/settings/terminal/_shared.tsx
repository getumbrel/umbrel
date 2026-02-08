import {FitAddon} from '@xterm/addon-fit'
import {Terminal} from '@xterm/xterm'
import {useEffect, useRef, useState} from 'react'
import {TbArrowRight, TbClipboard, TbX} from 'react-icons/tb'
import {useMeasure} from 'react-use'

import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {BackLink} from '@/modules/immersive-picker'
import {Button} from '@/shadcn-components/ui/button'
import {t} from '@/utils/i18n'

import '@xterm/xterm/css/xterm.css'

export function TerminalTitleBackLink() {
	return <BackLink to='/settings/terminal'>{t('terminal')}</BackLink>
}

// Minimum columns for MOTD display (warning box is 79 chars wide)
const MIN_COLS = 80

export const XTermTerminal = ({appId}: {appId?: string}) => {
	const terminalRef = useRef<Terminal | null>(null)
	const ws = useRef<WebSocket | null>(null)
	const containerRef = useRef<HTMLDivElement | null>(null)
	const scrollContainerRef = useRef<HTMLDivElement | null>(null)
	const pasteInputRef = useRef<HTMLInputElement | null>(null)

	const isMobile = useIsMobile()
	const isTouchDevice = useIsTouchDevice()
	const fontSize = isMobile ? 11 : 13
	// TODO: link this to the theme
	const fontFamily = 'SF Mono, SFMono-Regular, ui-monospace, DejaVu Sans Mono, Menlo, Consolas, monospace'

	const [parentContainerRef, {width: containerWidth, height: containerHeight}] = useMeasure()
	const [charMeasureRef, {width: charWidth}] = useMeasure()

	// Paste UI state for touch devices
	const [showPasteInput, setShowPasteInput] = useState(false)

	// Submit pasted command to terminal
	const submitPasteInput = () => {
		const text = pasteInputRef.current?.value || ''
		if (text && ws.current?.readyState === WebSocket.OPEN) {
			ws.current.send(text + '\r')
		}
		setShowPasteInput(false)
		terminalRef.current?.focus()
	}

	// On narrow screens (e.g., mobile), terminal may be wider than container (due to MIN_COLS).
	// We auto-scroll horizontally to keep cursor visible as the user types, otherwise they can't see what they're typing.
	const scrollToCursor = () => {
		if (!scrollContainerRef.current || !terminalRef.current || charWidth === 0) return
		const cursorX = terminalRef.current.buffer.active.cursorX
		const cursorPixelX = cursorX * charWidth + 16 // 16px left padding
		const container = scrollContainerRef.current
		const {clientWidth, scrollLeft} = container
		const buffer = 40

		if (cursorPixelX < scrollLeft + buffer) {
			container.scrollLeft = Math.max(0, cursorPixelX - buffer)
		} else if (cursorPixelX > scrollLeft + clientWidth - buffer) {
			container.scrollLeft = cursorPixelX - clientWidth + buffer
		}
	}

	useEffect(() => {
		if (containerWidth === 0 || containerHeight === 0) return

		// Clean up previous instances if they exist
		terminalRef.current?.dispose()
		ws.current?.close()

		const terminal = new Terminal({fontSize, fontFamily})
		const fitAddon = new FitAddon()
		terminalRef.current = terminal

		if (containerRef.current) {
			terminal.loadAddon(fitAddon)
			terminal.open(containerRef.current)
			terminal.focus()
			fitAddon.fit()

			// Enforce minimum cols for MOTD display on narrow screens
			if (terminal.cols < MIN_COLS) {
				terminal.resize(MIN_COLS, terminal.rows)
			}

			// We read dimensions AFTER fit/resize so server PTY matches xterm exactly.
			// If mismatched, the server thinks lines wrap at a different column than xterm,
			// causing text to overwrite itself when typing past the (server's) line boundary.
			const cols = terminal.cols
			const rows = terminal.rows

			// Build ws url
			const path = `/terminal?appId=${appId ?? ''}&rows=${rows}&cols=${cols}&token=${localStorage.getItem('jwt')}`
			const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://'
			const port = window.location.port ? `:${window.location.port}` : ''
			ws.current = new WebSocket(`${wsProtocol}${window.location.hostname}${port}${path}`)

			ws.current.onmessage = (event) => {
				terminal.write(event.data)
				scrollToCursor()
			}
			terminal.onData((data) => ws.current?.send(data))
		}

		return () => {
			terminal.dispose()
			ws.current?.close()
		}
	}, [appId, containerWidth, containerHeight])

	return (
		<div
			ref={parentContainerRef as React.LegacyRef<HTMLDivElement>}
			className='relative h-full w-full overflow-hidden rounded-12 bg-black/50'
		>
			{/* Hidden character to measure monospace character width */}
			<div
				ref={charMeasureRef as React.LegacyRef<HTMLDivElement>}
				style={{fontFamily, fontSize, visibility: 'hidden', position: 'absolute', whiteSpace: 'nowrap'}}
			>
				W
			</div>

			{/* Paste button ONLY for touch devices. Without this, touch device users have no way to paste commands into the terminal. */}
			{/* xterm renders to a canvas which doesn't receive native paste gestures, so we allow users to paste via an input */}
			{isTouchDevice && (
				<>
					{showPasteInput ? (
						<form
							className='absolute inset-x-2 top-2 z-10 flex items-center gap-2 rounded-8 bg-neutral-900 p-2 shadow-lg'
							onSubmit={(e) => {
								e.preventDefault()
								submitPasteInput()
							}}
						>
							<input
								ref={pasteInputRef}
								type='text'
								autoFocus
								placeholder={t('terminal.paste-placeholder', 'Paste command here')}
								className='min-w-0 flex-1 rounded-4 bg-white/10 px-2 py-2 text-13 text-white placeholder:text-white/40 focus:outline-hidden'
							/>
							<button
								type='submit'
								className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20'
							>
								<TbArrowRight className='h-5 w-5' />
							</button>
							<button
								type='button'
								onClick={() => {
									setShowPasteInput(false)
									terminalRef.current?.focus()
								}}
								className='shrink-0 rounded-full p-1 text-white/60 hover:bg-white/10 hover:text-white'
							>
								<TbX className='h-4 w-4' />
							</button>
						</form>
					) : (
						<div className='absolute top-2 right-2 z-10'>
							<Button size='sm' className='bg-neutral-800 hover:bg-neutral-700' onClick={() => setShowPasteInput(true)}>
								<TbClipboard className='h-4 w-4' />
								{t('paste')}
							</Button>
						</div>
					)}
				</>
			)}
			{/* Scroll container for horizontal scrolling on narrow screens */}
			<div ref={scrollContainerRef} className='h-full w-full overflow-x-auto overflow-y-hidden'>
				{/* 980px min width (for mobile) cause side scrolling is better than wrapping */}
				{/* Using `tracking-normal` and `text-rendering: unset` to prevent cursor text selection from not selecting the correct text */}
				{/* Note: xterm.js handles text selection internally, so no `select-text` class needed */}
				<div
					ref={containerRef}
					className='h-full w-full min-w-[980px] px-4 py-3 tracking-normal'
					style={{textRendering: 'unset'}}
				/>
			</div>
		</div>
	)
}
