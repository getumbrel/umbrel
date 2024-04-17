import {FitAddon} from '@xterm/addon-fit'
import {Terminal} from '@xterm/xterm'
import {useEffect, useRef} from 'react'
import {useMeasure} from 'react-use'

import {useIsMobile} from '@/hooks/use-is-mobile'
import {BackLink} from '@/modules/immersive-picker'
import {t} from '@/utils/i18n'

import '@xterm/xterm/css/xterm.css'

export function TerminalTitleBackLink() {
	return <BackLink to='/settings/terminal'>{t('terminal')}</BackLink>
}

const fitAddon = new FitAddon()

export const XTermTerminal = ({appId}: {appId?: string}) => {
	const terminalRef = useRef<Terminal | null>(null)
	const ws = useRef<WebSocket | null>(null)

	const containerRef = useRef(null)

	const isMobile = useIsMobile()

	const fontSize = isMobile ? 11 : 13
	// TODO: link this to the theme
	const fontFamily = 'SF Mono, SFMono-Regular, ui-monospace, DejaVu Sans Mono, Menlo, Consolas, monospace'

	const [parentContainerRef, {width: containerWidth, height: containerHeight}] = useMeasure()
	const [terminalCharacterMeasureRef, {width: characterWidth, height: characterHeight}] = useMeasure()

	useEffect(() => {
		if (containerWidth === 0 || containerHeight === 0) return

		// Clean up previous instances if they exist
		terminalRef.current?.dispose()
		ws.current?.close()
		terminalRef.current = new Terminal({
			fontSize,
			fontFamily,
		})

		const terminal = terminalRef.current

		if (containerRef.current) {
			const cols = Math.floor(containerWidth / characterWidth)
			const rows = Math.floor(containerHeight / characterHeight)
			// Build ws url
			const path = `/terminal?appId=${appId ?? ''}&rows=${rows}&cols=${cols}&token=${localStorage.getItem('jwt')}`
			const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://'
			const port = window.location.port ? `:${window.location.port}` : ''
			const wsUrl = `${wsProtocol}${window.location.hostname}${port}${path}`

			ws.current = new WebSocket(wsUrl)

			terminal.loadAddon(fitAddon)

			// Attach the terminal to the div
			terminal.open(containerRef.current)
			// Auto-focus terminal
			terminal.focus()
			// Resize to fit the div
			fitAddon.fit()

			ws.current.onmessage = (event) => terminal?.write(event.data)

			terminal.onData((data) => {
				ws.current?.send(data)
			})
		}

		return () => {
			terminal?.dispose()
			ws.current?.close()
		}
		// Not doing exhausive deps for `isMobile` because we don't wanna dispose the terminal when the screen size changes
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [appId, containerWidth, containerHeight])

	return (
		<div
			ref={parentContainerRef as React.LegacyRef<HTMLDivElement>}
			className='h-full w-full overflow-hidden overflow-x-auto rounded-12 bg-black/50 pb-4 pr-3'
		>
			{/* Hidden character to calculate correct cols/rows based on its dimensions */}
			<div
				ref={terminalCharacterMeasureRef as React.LegacyRef<HTMLDivElement>}
				style={{fontFamily, fontSize, visibility: 'hidden', position: 'absolute', whiteSpace: 'nowrap'}}
			>
				W
			</div>
			{/* 980px min width (for mobile) cause side scrolling is better than wrapping */}
			{/* Using `tracking-normal` and `text-rendering: unset` to prevent cursor text selection from not selecting the correct text */}
			<div
				ref={containerRef}
				className='h-full w-full min-w-[980px] px-4 py-3 tracking-normal'
				style={{textRendering: 'unset'}}
			/>
		</div>
	)
}
