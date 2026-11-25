import {markTerms, type SnippetSegment} from '@/features/search/snippet'

// Where the text read off a picture is in the picture, and the arithmetic of
// pointing at it. Search keeps one quad per line of the text: the line's four
// corners from its top left clockwise, as fractions of the picture. Signs and
// receipts are rarely level, so these are true quadrilaterals, and everything
// here keeps them so. There are no boxes for single words: a word is placed
// inside its line by how far along the line its characters are.

// x0, y0 … x3, y3: top left, top right, bottom right, bottom left
export type Quad = readonly [number, number, number, number, number, number, number, number]

export type TextLine = {
	text: string
	// Where the line starts in the whole text
	start: number
	// Absent where Search kept no place for the line
	quad?: Quad
}

export type TextRegion = {line: number; quad: Quad}

// Which of the picture's text the inspector is pointing at: one line (the
// one under the pointer in its card), every line, or none
export type TextFocus = {line: number} | 'all' | null

// How many matches are pointed at before the rest are left alone: a dense
// document that says the word on every row must not turn into confetti
const MAX_MATCH_REGIONS = 24

// The text as its lines, each with its place in the picture where one is
// known. Quads pair with lines by index; a list shorter than the text (it was
// cut for length), a missing one or a malformed one just leaves lines without
// a place.
export function textLines(text: string, textQuads: readonly (readonly number[])[] | undefined): TextLine[] {
	let start = 0
	return text.split('\n').map((line, index) => {
		const entry: TextLine = {text: line, start, quad: toQuad(textQuads?.[index])}
		start += line.length + 1
		return entry
	})
}

function toQuad(value: readonly number[] | undefined): Quad | undefined {
	if (!Array.isArray(value) || value.length !== 8 || !value.every(Number.isFinite)) return undefined
	// A corner a hair outside the picture is the detector's rounding, not a
	// place off it
	return value.map((n: number) => Math.min(1, Math.max(0, n))) as unknown as Quad
}

// How wide a character runs against an average one. Glyph widths vary, and
// all that is known is the line's two ends: without this an "i" would be
// given the room of an "m" and a word late in a line of narrow letters would
// be pointed at a word too early. Coarse classes are enough — the highlight
// is padded, and it only has to land on the right word.
function characterWidth(character: string) {
	if (/[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-｠]/.test(character)) return 1.8
	if (/[ijlI.,:;'’`!|()[\]]/.test(character)) return 0.5
	if (/[\sft1r\-/"]/.test(character)) return 0.7
	if (/[mwMW@%—]/.test(character)) return 1.5
	if (/[A-Z0-9£$€&#]/.test(character)) return 1.15
	return 1
}

// The part of a line's quad that characters `from` up to `to` of it take up:
// the same share along the top edge and the bottom edge, so a tilted or
// receding line keeps its shape. Widened by `pad` average characters either
// side, and never past the line's own ends.
export function rangeQuad(quad: Quad, line: string, from: number, to: number, pad = 0.35): Quad {
	const widths = [...line].map(characterWidth)
	const total = widths.reduce((sum, width) => sum + width, 0)
	if (total === 0) return quad
	// Offsets are in UTF-16 units, as a match reports them; widths are per character
	let before = 0
	let within = 0
	let unit = 0
	;[...line].forEach((character, index) => {
		if (unit < from) before += widths[index]!
		else if (unit < to) within += widths[index]!
		unit += character.length
	})
	const padding = (pad * total) / widths.length
	const t0 = Math.max(0, (before - padding) / total)
	const t1 = Math.min(1, (before + within + padding) / total)
	const along = (ax: number, ay: number, bx: number, by: number, t: number) => [ax + (bx - ax) * t, ay + (by - ay) * t]
	const [x0, y0, x1, y1, x2, y2, x3, y3] = quad
	return [
		...along(x0, y0, x1, y1, t0),
		...along(x0, y0, x1, y1, t1),
		...along(x3, y3, x2, y2, t1),
		...along(x3, y3, x2, y2, t0),
	] as unknown as Quad
}

// The text line by line as runs of plain and matched text (see markTerms): a
// match that runs over a line break — words a sign stacks — is matched in
// both lines it touches.
export function lineSegments(text: string, terms: readonly string[]): SnippetSegment[][] {
	const lines: SnippetSegment[][] = [[]]
	for (const segment of markTerms(text, terms)) {
		segment.text.split('\n').forEach((piece, index) => {
			if (index > 0) lines.push([])
			if (piece) lines[lines.length - 1]!.push({text: piece, highlighted: segment.highlighted})
		})
	}
	return lines
}

// Where the matched words are in the picture: for each run of matched text,
// the part of its line's quad it takes up. In reading order, and no more than
// MAX_MATCH_REGIONS of them.
export function matchRegions(lines: readonly TextLine[], terms: readonly string[]) {
	const regions: TextRegion[] = []
	if (terms.length === 0) return regions
	const text = lines.map((line) => line.text).join('\n')
	lineSegments(text, terms).forEach((segments, index) => {
		const line = lines[index]
		let offset = 0
		for (const segment of segments) {
			const from = offset
			offset += segment.text.length
			if (!segment.highlighted || !line?.quad) continue
			// The space around a word is not the word
			const lead = segment.text.length - segment.text.trimStart().length
			const trail = segment.text.length - segment.text.trimEnd().length
			if (lead + trail >= segment.text.length) continue
			if (regions.length < MAX_MATCH_REGIONS) {
				regions.push({line: index, quad: rangeQuad(line.quad, line.text, from + lead, offset - trail)})
			}
		}
	})
	return regions
}

// Every line that has a place, whole
export function lineRegions(lines: readonly TextLine[]): TextRegion[] {
	return lines.flatMap((line, index) => (line.quad ? [{line: index, quad: line.quad}] : []))
}

// How strongly each of `count` highlights is drawn at rest, against one
// alone: a few can each be as present as one, a page of them is quietened
// so that together they tint the picture no more than a few would.
export function restingStrength(count: number) {
	return count <= 4 ? 1 : Math.max(0.55, 1 - (count - 4) * 0.03)
}

// A quad as an SVG path in a `width` by `height` user space
export function quadPath(quad: Quad, width: number, height: number) {
	const point = (index: number) => `${round(quad[index]! * width)} ${round(quad[index + 1]! * height)}`
	return `M${point(0)}L${point(2)}L${point(4)}L${point(6)}Z`
}

const round = (n: number) => Math.round(n * 100) / 100
