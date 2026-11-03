// Fonts: the line height each Office face sets, and the symbol fonts Word uses for bullets and glyphs. A run's font
// stack (its faces and their stand-ins) comes from shared/fonts.ts.
import {lookup} from '@/features/files/components/file-viewer/shared/lookup'

// Line height of each face at line-height: normal (ascent + descent + gap over the em), which is Word's single line
// spacing. Measured in the browser when possible; these cover tests and faces measured before they load.
const LINE_RATIOS = lookup<number>({
	calibri: 1.2207,
	'calibri light': 1.2207,
	carlito: 1.2207,
	cambria: 1.1719,
	caladea: 1.1719,
	arial: 1.1499,
	helvetica: 1.1499,
	'times new roman': 1.1499,
	times: 1.1499,
	'courier new': 1.1328,
	georgia: 1.1362,
	verdana: 1.2153,
	tahoma: 1.2075,
	'segoe ui': 1.3301,
	aptos: 1.2,
})

export const DEFAULT_LINE_RATIO = 1.17

export const lineRatio = (name: string | undefined) => (name && LINE_RATIOS[name.toLowerCase()]) || DEFAULT_LINE_RATIO

// The Adobe Symbol encoding from 0x20 (index 0) to 0xFE; Word stores these as U+F020–U+F0FE
const SYMBOL =
	' !∀#∃%&∋()∗+,−./0123456789:;<=>?≅ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ[∴]⊥_‾αβχδεφγηιϕκλμνοπθρστυϖωξψζ{|}∼' +
	'\u0000'.repeat(33) +
	'€ϒ′≤⁄∞ƒ♣♦♥♠↔←↑→↓°±″≥×∝∂•÷≠≡≈…⏐⎯↵ℵℑℜ℘⊗⊕∅∩∪⊃⊇⊄⊂⊆∈∉∠∇®©™∏√⋅¬∧∨⇔⇐⇑⇒⇓◊〈®©™∑⎛⎜⎝⎡⎢⎣⎧⎨⎩⎪\u0000〉∫⌠⎮⌡⎞⎟⎠⎤⎥⎦⎫⎬⎭'

// The Wingdings glyphs documents actually use, mostly as bullets and check boxes
const WINGDINGS: Record<number, string> = {
	0x4a: '☺',
	0x4c: '☹',
	0x6c: '●',
	0x6e: '■',
	0x6f: '□',
	0x71: '❑',
	0x75: '◆',
	0x76: '❖',
	0x77: '⬥',
	0xa1: '○',
	0xa7: '▪',
	0xa8: '◻',
	0xab: '★',
	0xd8: '➢',
	0xe8: '➔',
	0xfb: '✗',
	0xfc: '✓',
	0xfd: '☒',
	0xfe: '☑',
}

// A character from a symbol font as the Unicode character it depicts, or undefined to draw it in its own font
export function symbolChar(font: string | undefined, code: number): string | undefined {
	const byte = code >= 0xf000 && code <= 0xf0ff ? code - 0xf000 : code
	const face = font?.toLowerCase()
	if (face === 'symbol' && byte >= 0x20 && byte <= 0xfe) {
		const mapped = SYMBOL[byte - 0x20]
		return mapped && mapped !== '\u0000' ? mapped : undefined
	}
	if (face?.startsWith('wingdings')) return face === 'wingdings' ? WINGDINGS[byte] : undefined
	// Private-use code points mean nothing outside their font
	if (code >= 0xe000 && code <= 0xf8ff) return undefined
	return String.fromCodePoint(code)
}
