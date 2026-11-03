// The resolved, render-ready slide. Every inherited property has been looked up, every colour is a CSS colour
// and every length is CSS px at 96 dpi, so rendering is a straight walk and tests can read the model directly.

import type {ShapePath} from '@/features/files/components/file-viewer/slides-viewer/engine/geometry'

export type Box = {x: number; y: number; w: number; h: number}
export type Insets = {l: number; t: number; r: number; b: number}

export type Stop = {at: number; color: string}

export type Paint =
	| {kind: 'solid'; color: string}
	// `angle` in degrees clockwise from left-to-right; `scaled` stretches it with the shape like PowerPoint does
	| {kind: 'linear'; stops: Stop[]; angle: number; scaled: boolean}
	// A path gradient grows from `center` (fractions of the box) out to the corners
	| {kind: 'radial'; stops: Stop[]; center: {x: number; y: number}}
	// `crop` trims the picture (fractions, negative pads); `tile` repeats it at its natural size times `scale`;
	// `duotone` maps its darks and lights to two sRGB colours (channels 0–1)
	| {
			kind: 'image'
			part: string
			crop: Insets
			opacity: number
			tile?: {scale: {x: number; y: number}}
			duotone?: [[number, number, number], [number, number, number]]
			grayscale?: boolean
	  }

// Arrowhead sizes are multiples of the line width
export type LineEnd = {type: 'triangle' | 'stealth' | 'diamond' | 'oval' | 'arrow'; width: number; length: number}

export type Line = {
	width: number
	paint: Paint
	// Dash and gap lengths as multiples of the line width
	dash?: number[]
	cap: 'butt' | 'round' | 'square'
	join: 'round' | 'bevel' | 'miter'
	head?: LineEnd
	tail?: LineEnd
}

// The offset is in slide space unless the shadow turns with its shape
export type Shadow = {dx: number; dy: number; blur: number; color: string; rotateWithShape: boolean}

export type RunStyle = {
	// A CSS font-family list: the run's latin, east Asian and complex script faces with metric-compatible fallbacks
	family: string
	size: number
	bold: boolean
	italic: boolean
	underline?: 'solid' | 'double' | 'dotted' | 'dashed' | 'wavy'
	strike?: 'single' | 'double'
	caps?: 'all' | 'small'
	// Raised (positive) or lowered offset as a fraction of the font size
	baseline: number
	spacing: number
	color: string
	highlight?: string
}

export type Run =
	| {kind: 'text'; text: string; style: RunStyle; href?: string}
	// Field results (slide numbers, dates) and line breaks are fixed: editing never changes them
	| {kind: 'field'; text: string; style: RunStyle}
	| {kind: 'break'; style: RunStyle}

export type Paragraph = {
	align: 'left' | 'center' | 'right' | 'justify' | 'distributed'
	rtl: boolean
	marginLeft: number
	indent: number
	// A multiple of the font size, or an exact height
	lineHeight: {multiple: number} | {px: number}
	spaceBefore: number
	spaceAfter: number
	tabSize: number
	bullet?: {text: string; style: RunStyle}
	runs: Run[]
	// The paragraph mark's style: an empty paragraph's height, and text typed into one
	end: RunStyle
	// Index into the slide's editable paragraphs, when this one can be edited and saved
	key?: number
}

export type TextBody = {
	// The geometry's text rectangle within the shape box, before insets
	box: Box
	insets: Insets
	anchor: 'top' | 'middle' | 'bottom'
	anchorCenter: boolean
	wrap: boolean
	// Rotated a quarter turn either way, east Asian vertical (CJK upright, the rest turned), or stacked letters
	vertical?: 'vert' | 'vert270' | 'eaVert' | 'stacked'
	rotation: number
	columns: {count: number; gap: number}
	paragraphs: Paragraph[]
}

type Placement = {box: Box; rotation: number; flipH: boolean; flipV: boolean}

export type ShapeElement = Placement & {
	kind: 'shape'
	paths: ShapePath[]
	fill?: Paint
	// A picture's image, drawn over the fill and clipped to the outline
	picture?: Paint
	line?: Line
	shadow?: Shadow
	text?: TextBody
	// A video or audio poster, marked with a play badge
	media?: boolean
}

// Children are placed in the group's own px space, already scaled from its child coordinates
export type GroupElement = Placement & {kind: 'group'; children: SlideElement[]; shadow?: Shadow}

export type Border = Line | undefined
export type TableCell = {
	row: number
	col: number
	// Within the table
	box: Box
	fill?: Paint
	borders: {left: Border; right: Border; top: Border; bottom: Border; down: Border; up: Border}
	text: TextBody
}
export type TableElement = Placement & {kind: 'table'; columns: number[]; rows: number[]; cells: TableCell[]}

// Content drawn as a labelled frame: charts (titled when the chart caches one) and unreadable SmartArt
export type FrameElement = Placement & {kind: 'frame'; label?: string; color: string}

export type SlideElement = ShapeElement | GroupElement | TableElement | FrameElement

// A span of the slide part's text to replace: `before` + the escaped text + `after` goes in [start, end)
export type Splice = {start: number; end: number; before: string; after: string}

// One editable paragraph: where each of its runs' text sits in the slide part, and for each stretch between its
// fields and line breaks, where a run typed into the stretch would go: just before the field or break that ends it
// (copying its properties), or for the last, before the paragraph mark (copying the mark's)
export type EditableParagraph = {
	runs: Array<Splice & {text: string}>
	gaps: Splice[]
}

export type SlideModel = {
	background?: Paint
	elements: SlideElement[]
	paragraphs: EditableParagraph[]
}
