// Fonts: the line height each Office face sets, and the symbol fonts Word uses for bullets and glyphs. A run's font
// stack (its faces and their stand-ins) comes from shared/fonts.ts.
import {lookup} from '@/features/files/components/file-viewer/shared/lookup'

// Each face's line height at single spacing, as a share of its size: its ascent, descent and line gap over the 2048
// units of its em, which is what Word makes a line of it. A line is as tall as the face the document names makes it,
// whichever face stands in for it here: Caladea's lines are a fiftieth shorter than those of the Cambria it's drawn
// for. A face that isn't listed has the height the browser measures of what it draws it in.
//
// Of an East Asian face Word makes a line three tenths taller than the face's ascent and descent together. The older
// faces fill their em with those and the later ones are taller. A document names such a face in English or in the
// face's own language.
const eastAsian = (height: number, ...names: string[]) => Object.fromEntries(names.map((name) => [name, 1.3 * height]))

const LINE_RATIOS = lookup<number>({
	calibri: 2500 / 2048,
	'calibri light': 2500 / 2048,
	carlito: 2500 / 2048,
	cambria: 2400 / 2048,
	arial: 2355 / 2048,
	helvetica: 2355 / 2048,
	'times new roman': 2355 / 2048,
	times: 2355 / 2048,
	'courier new': 2320 / 2048,
	georgia: 2327 / 2048,
	verdana: 2489 / 2048,
	tahoma: 2472 / 2048,
	'segoe ui': 2724 / 2048,
	...eastAsian(1, 'simsun', '宋体', 'nsimsun', '新宋体', 'simhei', '黑体', 'kaiti', '楷体', 'fangsong', '仿宋'),
	...eastAsian(1, 'kaiti_gb2312', '楷体_gb2312', 'fangsong_gb2312', '仿宋_gb2312'),
	...eastAsian(1, 'mingliu', '細明體', 'pmingliu', '新細明體', 'dfkai-sb', '標楷體'),
	...eastAsian(1, 'ms mincho', 'ｍｓ 明朝', 'ms pmincho', 'ｍｓ ｐ明朝'),
	...eastAsian(1, 'ms gothic', 'ｍｓ ゴシック', 'ms pgothic', 'ｍｓ ｐゴシック'),
	...eastAsian(1, 'batang', '바탕', 'gulim', '굴림', 'dotum', '돋움', 'gungsuh', '궁서'),
	...eastAsian(1.3, 'yu mincho', '游明朝', 'yu gothic', '游ゴシック'),
	...eastAsian(1.32, 'microsoft yahei', '微软雅黑'),
	...eastAsian(1.33, 'microsoft jhenghei', '微軟正黑體', 'malgun gothic', '맑은 고딕'),
	...eastAsian(1.5, 'meiryo', 'メイリオ'),
})

// A face's line height until it's measured
export const DEFAULT_LINE_RATIO = 1.17

export const lineRatio = (name: string | undefined) => (name ? LINE_RATIOS[name.toLowerCase()] : undefined)

// The Adobe Symbol encoding from 0x20 (index 0) to 0xFE; Word stores these as U+F020–U+F0FE
const SYMBOL =
	' !∀#∃%&∋()∗+,−./0123456789:;<=>?≅ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ[∴]⊥_‾αβχδεφγηιϕκλμνοπθρστυϖωξψζ{|}∼' +
	'\u0000'.repeat(33) +
	'€ϒ′≤⁄∞ƒ♣♦♥♠↔←↑→↓°±″≥×∝∂•÷≠≡≈…⏐⎯↵ℵℑℜ℘⊗⊕∅∩∪⊃⊇⊄⊂⊆∈∉∠∇®©™∏√⋅¬∧∨⇔⇐⇑⇒⇓◊〈®©™∑⎛⎜⎝⎡⎢⎣⎧⎨⎩⎪\u0000〉∫⌠⎮⌡⎞⎟⎠⎤⎥⎦⎫⎬⎭'

// Glyphs of a symbol font as the characters that depict them, in runs from the code each starts at
function glyphs(runs: Record<number, string>): Record<number, string> {
	const map: Record<number, string> = {}
	for (const [start, run] of Object.entries(runs)) Array.from(run).forEach((char, i) => (map[Number(start) + i] = char))
	return map
}

// The Wingdings glyphs that have a character of their own, or one drawn all but alike: bullets and check boxes, the
// arrows and faces Word makes of "-->" and ":)", and the signs of a letterhead. The others are left to Wingdings
// itself, where it's installed.
const WINGDINGS = glyphs({
	0x21: '✏✂✁',
	0x28: '☎✆✉',
	0x3e: '✇✍',
	0x41: '✌',
	0x45: '☜☞☝☟',
	0x4a: '☺',
	0x4c: '☹',
	0x4e: '☠⚐',
	0x51: '✈☼',
	0x54: '❄',
	0x56: '✞',
	0x58: '✠✡☪☯ॐ☸♈♉♊♋♌♍♎♏♐♑♒♓',
	0x6c: '●❍■□',
	0x71: '❑❒⬧⧫◆❖⬥⌧',
	0x7a: '⌘',
	0x7d: '❝❞',
	0x80: '⓪➀➁➂➃➄➅➆➇➈➉⓿➊➋➌➍➎➏➐➑➒➓',
	0x9e: '∙•▪○',
	0xa4: '◉◎',
	0xa7: '▪◻',
	0xaa: '✦★✶✷✹✵',
	0xb1: '⌖⟡⌑',
	0xb5: '✪✰',
	0xd5: '⌫⌦',
	0xd8: '➢',
	0xdf: '←→↑↓↖↗↙↘⬅➔⬆⬇⬉⬈⬋⬊⇦⇨⇧⇩⬄⇳⬁⬀⬃⬂',
	0xfb: '✗✓☒☑',
})

// And those of Wingdings 2 that tick and cross things, with the empty box to tick
const WINGDINGS_2 = glyphs({0x4f: '✗✓☒☑☒☒', 0xa3: '☐'})

const DINGBATS = lookup<Record<number, string>>({wingdings: WINGDINGS, 'wingdings 2': WINGDINGS_2})

// A symbol font's glyph is text, in the colour of its run: a character that has an emoji as well is asked for as text,
// where it may otherwise be drawn as the emoji. Nothing for a glyph that has no character.
function asText(char: string | undefined): string | undefined {
	if (!char || char === '\u0000') return undefined
	return /\p{Extended_Pictographic}/u.test(char) ? `${char}\ufe0e` : char
}

// A character from a symbol font as the Unicode character it depicts, or undefined to draw it in its own font
export function symbolChar(font: string | undefined, code: number): string | undefined {
	const byte = code >= 0xf000 && code <= 0xf0ff ? code - 0xf000 : code
	const face = font?.toLowerCase()
	if (face === 'symbol' && byte >= 0x20 && byte <= 0xfe) return asText(SYMBOL[byte - 0x20])
	if (face?.startsWith('wingdings')) return asText(DINGBATS[face]?.[byte])
	// Private-use code points mean nothing outside their font
	if (code >= 0xe000 && code <= 0xf8ff) return undefined
	return String.fromCodePoint(code)
}
