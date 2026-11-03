import {Highlighter, ImagePlus, MousePointer2, PenLine, Redo2, Signature, Type, Undo2} from 'lucide-react'
import {useEffect, useRef, useState, type ComponentType} from 'react'
import {useTranslation} from 'react-i18next'

import {FadeScroller} from '@/components/fade-scroller'
import {DarkTooltip} from '@/components/ui/dark-tooltip'
import type {PdfSession} from '@/features/files/components/file-viewer/pdf-viewer'
import {
	AnnotationEditorParamsType,
	AnnotationEditorType,
} from '@/features/files/components/file-viewer/pdf-viewer/pdfjs'
import {
	floatingGlassClass,
	keepFocus,
	PillButton,
	PillDivider,
} from '@/features/files/components/file-viewer/shell/zoom-pill'
import {cn} from '@/lib/utils'
import {touchTargetClass} from '@/utils/element-classes'

const {NONE, HIGHLIGHT, INK, FREETEXT, SIGNATURE, STAMP} = AnnotationEditorType
const PARAM = AnnotationEditorParamsType

// pdf.js's own highlighter colours (named as pdf.js names them), then a pen's
export const HIGHLIGHTS = [
	{name: 'yellow', color: '#FFFF98', label: 'files-pdf.color-yellow'},
	{name: 'green', color: '#53FFBC', label: 'files-pdf.color-green'},
	{name: 'blue', color: '#80EBFF', label: 'files-pdf.color-blue'},
	{name: 'pink', color: '#FFCBE6', label: 'files-pdf.color-pink'},
	{name: 'red', color: '#FF4F5F', label: 'files-pdf.color-red'},
]
const INKS = [
	{color: '#000000', label: 'files-pdf.color-black'},
	{color: '#FF3B30', label: 'files-pdf.color-red'},
	{color: '#FF9500', label: 'files-pdf.color-orange'},
	{color: '#34C759', label: 'files-pdf.color-green'},
	{color: '#007AFF', label: 'files-pdf.color-blue'},
	{color: '#AF52DE', label: 'files-pdf.color-purple'},
]
const STROKES = [
	{value: 2, label: 'files-pdf.stroke-thin'},
	{value: 4, label: 'files-pdf.stroke-medium'},
	{value: 8, label: 'files-pdf.stroke-thick'},
]
const TEXT_SIZES = [
	{value: 12, label: 'files-pdf.text-small'},
	{value: 18, label: 'files-pdf.text-medium'},
	{value: 28, label: 'files-pdf.text-large'},
]
// What new annotations start as, until a colour or size is picked
const DEFAULTS: Record<number, string | number> = {
	[PARAM.HIGHLIGHT_COLOR]: HIGHLIGHTS[0].color,
	[PARAM.INK_COLOR]: INKS[0].color,
	[PARAM.INK_THICKNESS]: STROKES[0].value,
	[PARAM.FREETEXT_COLOR]: INKS[0].color,
	[PARAM.FREETEXT_SIZE]: TEXT_SIZES[0].value,
}

// The strokes drawn on the signature pad, in the pad's own pixels
export type Drawing = {curves: {points: number[]}[]; thickness: number; width: number; height: number}
// The pdf.js signature editor waiting on the pad
export type SignatureRequest = {
	getDrawnSignature: (drawing: Drawing) => unknown
	addSignature: (outline: unknown, heightInPage: number, description: string, uuid: null) => void
	remove: () => void
}

type Markup = ReturnType<typeof useMarkup>

// pdf.js's annotation editors, driven from Umbrel's toolbar. Each tool is one
// of pdf.js's editing modes; Select is none of them, where text selects, links
// and forms answer, and a double-clicked annotation opens in its tool.
export function useMarkup(session: PdfSession | undefined, editable: boolean) {
	const [on, setOn] = useState(false)
	const [tool, setTool] = useState<number>(NONE)
	const [defaults, setDefaults] = useState(DEFAULTS)
	// What pdf.js reports of the annotation in hand, when there is one
	const [selected, setSelected] = useState<Record<number, unknown>>({})
	const [state, setState] = useState({hasSomethingToUndo: false, hasSomethingToRedo: false, hasSelectedEditor: false})
	const started = useRef(false)
	const switching = useRef<() => void>(undefined)

	const dispatch = (type: number, value?: unknown) =>
		session?.eventBus.dispatch('switchannotationeditorparams', {source: null, type, value})
	// pdf.js's defaults are thinner and smaller than Umbrel's; they're set once,
	// before the first annotation is in hand
	const start = () => {
		if (started.current) return
		started.current = true
		for (const [type, value] of Object.entries(DEFAULTS)) dispatch(Number(type), value)
	}

	useEffect(() => {
		if (!session || !editable) return
		const {eventBus, viewer} = session
		const listeners = {
			annotationeditormodechanged: ({mode}: {mode: number}) => setTool(mode),
			annotationeditorparamschanged: ({details}: {details: [number, unknown][]}) =>
				setSelected((selected) => ({...selected, ...Object.fromEntries(details)})),
			editingstateschanged: ({details}: {details: typeof state}) => setState(details),
			// Selecting an annotation of another kind asks for its tool, as does
			// double-clicking one with markup off
			switchannotationeditormode: (options: {mode: number}) => {
				if (options.mode !== NONE) {
					start()
					setOn(true)
				}
				viewer.annotationEditorMode = options
			},
		}
		for (const [name, listener] of Object.entries(listeners)) eventBus.on(name, listener)
		return () => {
			switching.current?.()
			for (const [name, listener] of Object.entries(listeners)) eventBus.off(name, listener)
		}
	}, [session, editable])

	// Resolves once pdf.js has readied the pages for the tool; a switch that's
	// overtaken by another never does
	const use = (mode: number) =>
		new Promise<void>((resolve) => {
			if (!session) return
			switching.current?.()
			if (mode === tool) return resolve()
			const {eventBus, viewer} = session
			const changed = (event: {mode: number}) => {
				if (event.mode !== mode) return
				switching.current?.()
				resolve()
			}
			eventBus.on('annotationeditormodechanged', changed)
			switching.current = () => {
				eventBus.off('annotationeditormodechanged', changed)
				switching.current = undefined
			}
			viewer.annotationEditorMode = {mode}
		})

	return {
		on,
		tool,
		params: state.hasSelectedEditor ? {...defaults, ...selected} : defaults,
		canUndo: state.hasSomethingToUndo,
		canRedo: state.hasSomethingToRedo,
		toggle: () => {
			if (on) void use(NONE)
			else start()
			setOn(!on)
		},
		use,
		// The annotation in hand takes the change; with none, it's what the next
		// one gets
		set: (type: number, value: string | number) => {
			dispatch(type, value)
			if (state.hasSelectedEditor) setSelected((selected) => ({...selected, [type]: value}))
			else setDefaults((defaults) => ({...defaults, [type]: value}))
		},
		undo: () => session?.eventBus.dispatch('editingaction', {source: null, name: 'undo'}),
		redo: () => session?.eventBus.dispatch('editingaction', {source: null, name: 'redo'}),
		// An empty signature goes on the page, and pdf.js asks the viewer to
		// fill it (see its signature seam)
		sign: async () => {
			await use(SIGNATURE)
			dispatch(PARAM.CREATE)
		},
		addImage: async (file: File) => {
			await use(STAMP)
			dispatch(PARAM.CREATE, {bitmapFile: file})
		},
		// Escape lets go of the annotation in hand (pdf.js's own Escape does
		// that), then of the tool, then of markup itself, as Escape leaves a
		// document's or a deck's editing
		unwind: () => {
			if (state.hasSelectedEditor) return true
			if (tool !== NONE) void use(NONE)
			else if (on) setOn(false)
			else return false
			return true
		},
	}
}

export function MarkupToolbar({markup}: {markup: Markup}) {
	const {t} = useTranslation()
	const imageInput = useRef<HTMLInputElement>(null)
	const {tool, params} = markup
	const tools: {mode: number; icon: ComponentType<{className?: string}>; label: string; onClick?: () => void}[] = [
		{mode: NONE, icon: MousePointer2, label: t('files-pdf.tool-select')},
		{mode: HIGHLIGHT, icon: Highlighter, label: t('files-pdf.tool-highlight')},
		{mode: INK, icon: PenLine, label: t('files-pdf.tool-draw')},
		{mode: FREETEXT, icon: Type, label: t('files-pdf.tool-text')},
		{mode: SIGNATURE, icon: Signature, label: t('files-pdf.tool-signature'), onClick: () => void markup.sign()},
		{mode: STAMP, icon: ImagePlus, label: t('files-pdf.tool-image'), onClick: () => imageInput.current?.click()},
	]
	const colors =
		tool === HIGHLIGHT
			? {type: PARAM.HIGHLIGHT_COLOR, options: HIGHLIGHTS}
			: tool === INK
				? {type: PARAM.INK_COLOR, options: INKS}
				: tool === FREETEXT
					? {type: PARAM.FREETEXT_COLOR, options: INKS}
					: undefined
	const sizes =
		tool === INK
			? {type: PARAM.INK_THICKNESS, options: STROKES}
			: tool === FREETEXT
				? {type: PARAM.FREETEXT_SIZE, options: TEXT_SIZES}
				: undefined

	return (
		<div className='pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-4'>
			<div
				role='toolbar'
				aria-label={t('files-pdf.markup')}
				// A press anywhere on it leaves the keyboard on the page: an annotation
				// being typed keeps its caret, the pages their scrolling keys
				onMouseDown={keepFocus}
				className={cn(
					floatingGlassClass,
					'pointer-events-auto flex h-10 max-w-full rounded-full px-1 motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in motion-safe:slide-in-from-top-1',
				)}
			>
				{/* On a phone the tools scroll sideways, and an edge with more beyond it fades */}
				<FadeScroller
					direction='x'
					fadeSize={24}
					className='umbrel-hide-scrollbar flex items-center gap-0.5 overflow-x-auto'
				>
					{tools.map(({mode, icon, label, onClick}) => (
						<PillButton
							key={mode}
							icon={icon}
							label={label}
							tooltipSide='bottom'
							active={tool === mode}
							onClick={onClick ?? (() => void markup.use(mode))}
						/>
					))}
					{colors && (
						<>
							<PillDivider />
							{colors.options.map(({color, label}) => {
								const active = String(params[colors.type]).toUpperCase() === color
								return (
									<DarkTooltip key={color} label={t(label)} side='bottom'>
										<button
											type='button'
											aria-label={t(label)}
											aria-pressed={active}
											onClick={() => markup.set(colors.type, color)}
											className={cn(
												touchTargetClass,
												'group flex size-7 shrink-0 items-center justify-center rounded-full focus-visible:outline-hidden',
											)}
										>
											<span
												className={cn(
													'size-[18px] rounded-full ring-1 ring-white/25 transition-transform duration-200 ring-inset group-hover:scale-110 group-active:scale-90',
													active && 'shadow-[0_0_0_2px_rgb(0_0_0/0.5),0_0_0_3.5px_white]',
												)}
												style={{backgroundColor: color}}
											/>
										</button>
									</DarkTooltip>
								)
							})}
						</>
					)}
					{sizes && (
						<>
							<PillDivider />
							{sizes.options.map(({value, label}, index) => (
								<PillButton
									key={value}
									label={t(label)}
									tooltipSide='bottom'
									active={params[sizes.type] === value}
									onClick={() => markup.set(sizes.type, value)}
								>
									{sizes.type === PARAM.INK_THICKNESS ? (
										<span className='rounded-full bg-current' style={{width: 3 + index * 3, height: 3 + index * 3}} />
									) : (
										<span className='leading-none font-semibold' style={{fontSize: 10 + index * 3}}>
											A
										</span>
									)}
								</PillButton>
							))}
						</>
					)}
					<PillDivider />
					<PillButton
						icon={Undo2}
						label={t('files-pdf.undo')}
						tooltipSide='bottom'
						disabled={!markup.canUndo}
						onClick={markup.undo}
					/>
					<PillButton
						icon={Redo2}
						label={t('files-pdf.redo')}
						tooltipSide='bottom'
						disabled={!markup.canRedo}
						onClick={markup.redo}
					/>
				</FadeScroller>
				<input
					ref={imageInput}
					type='file'
					accept='image/*'
					hidden
					onChange={(event) => {
						const file = event.target.files?.[0]
						event.target.value = ''
						if (file) void markup.addImage(file)
					}}
				/>
			</div>
		</div>
	)
}
