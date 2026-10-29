// CSS font stacks for the faces Office documents name. A document names fonts the viewer's device rarely has, so
// each is followed by stand-ins, metric-compatible ones where they exist (Files serves Carlito for Calibri and
// Caladea for Cambria itself) so lines break where Office broke them, then a generic family of the right kind.

import {lookup} from './lookup'

const SANS = 'sans-serif'
const SERIF = 'serif'
const MONO = 'monospace'

const JAPANESE = ['Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans CJK JP']
const JAPANESE_SERIF = ['Hiragino Mincho ProN', 'Noto Serif CJK JP']
const CHINESE = ['PingFang SC', 'Noto Sans CJK SC']
const CHINESE_SERIF = ['Songti SC', 'Noto Serif CJK SC']
const TAIWANESE = ['PingFang TC', 'Noto Sans CJK TC']
const KOREAN = ['Apple SD Gothic Neo', 'Noto Sans CJK KR']

const FACES = lookup<[string[], string]>({
	aptos: [['Carlito'], SANS],
	'aptos display': [['Carlito'], SANS],
	'aptos narrow': [['Carlito'], SANS],
	calibri: [['Carlito'], SANS],
	'calibri light': [['Carlito'], SANS],
	cambria: [['Caladea'], SERIF],
	'cambria math': [['Cambria', 'Caladea'], SERIF],
	arial: [['Liberation Sans', 'Arimo', 'Helvetica Neue', 'Helvetica'], SANS],
	'arial narrow': [['Liberation Sans Narrow'], SANS],
	helvetica: [['Arial', 'Liberation Sans', 'Arimo'], SANS],
	'helvetica neue': [['Helvetica', 'Arial', 'Liberation Sans'], SANS],
	'times new roman': [['Liberation Serif', 'Tinos', 'Times'], SERIF],
	times: [['Times New Roman', 'Liberation Serif', 'Tinos'], SERIF],
	'courier new': [['Liberation Mono', 'Cousine', 'Courier'], MONO],
	courier: [['Courier New', 'Liberation Mono', 'Cousine'], MONO],
	consolas: [['Menlo', 'Liberation Mono'], MONO],
	'lucida console': [['Monaco', 'Liberation Mono'], MONO],
	georgia: [['Gelasio'], SERIF],
	verdana: [['DejaVu Sans'], SANS],
	tahoma: [['DejaVu Sans'], SANS],
	'segoe ui': [['system-ui'], SANS],
	'century gothic': [['URW Gothic', 'Avant Garde'], SANS],
	'comic sans ms': [['Comic Neue'], SANS],
	garamond: [['EB Garamond'], SERIF],
	'book antiqua': [['Palatino', 'TeX Gyre Pagella'], SERIF],
	'palatino linotype': [['Palatino', 'TeX Gyre Pagella'], SERIF],
	'ms gothic': [JAPANESE, SANS],
	'ms pgothic': [JAPANESE, SANS],
	'ｍｓ ゴシック': [JAPANESE, SANS],
	'ｍｓ ｐゴシック': [JAPANESE, SANS],
	meiryo: [JAPANESE, SANS],
	メイリオ: [JAPANESE, SANS],
	'yu gothic': [JAPANESE, SANS],
	游ゴシック: [JAPANESE, SANS],
	'ms mincho': [JAPANESE_SERIF, SERIF],
	'ｍｓ 明朝': [JAPANESE_SERIF, SERIF],
	'yu mincho': [JAPANESE_SERIF, SERIF],
	simsun: [CHINESE_SERIF, SERIF],
	宋体: [CHINESE_SERIF, SERIF],
	'microsoft yahei': [CHINESE, SANS],
	微软雅黑: [CHINESE, SANS],
	dengxian: [CHINESE, SANS],
	等线: [CHINESE, SANS],
	simhei: [CHINESE, SANS],
	黑体: [CHINESE, SANS],
	pmingliu: [['PingFang TC', 'Noto Serif CJK TC'], SERIF],
	新細明體: [['PingFang TC', 'Noto Serif CJK TC'], SERIF],
	'microsoft jhenghei': [TAIWANESE, SANS],
	微軟正黑體: [TAIWANESE, SANS],
	'malgun gothic': [KOREAN, SANS],
	'맑은 고딕': [KOREAN, SANS],
	gulim: [KOREAN, SANS],
	굴림: [KOREAN, SANS],
})

const MONO_HINT = /mono|courier|consol|code|menlo|typewriter/i
const SERIF_HINT =
	/serif|times|roman|georgia|garamond|mincho|song|ming|batang|baskerville|bodoni|didot|palatino|cambria|caladea|caslon|book|century/i

const stacks = new Map<string, string>()

// The faces in order (latin first), each with its stand-ins and without repeats, ending in the first face's generic
// family. Every run asks, so the few distinct answers a document needs are shared (and the memo can't grow without
// bound).
export function fontStack(faces: Array<string | undefined>): string {
	const names = faces.map(clean)
	const key = names.join('\n')
	let stack = stacks.get(key)
	if (stack === undefined) {
		if (stacks.size >= 1000) stacks.clear()
		stacks.set(key, (stack = buildStack(names)))
	}
	return stack
}

// Names come from the document. What a family name can't hold goes before anything else sees one, so it's looked
// up, remembered and quoted as the name it will be.
const clean = (face: string | undefined) =>
	(face ?? '')
		.replace(/\p{Cc}/gu, '')
		.trim()
		.slice(0, 128)

function buildStack(names: string[]): string {
	const families: string[] = []
	let generic = ''
	for (const name of names) {
		if (!name) continue
		const [standIns, kind] = FACES[name.toLowerCase()] ?? [[], guessKind(name)]
		generic ||= kind
		families.push(name, ...standIns)
	}
	const unique = [...new Set(families)].map(quote)
	return [...unique, generic || SANS].join(', ')
}

const guessKind = (name: string) =>
	MONO_HINT.test(name) ? MONO : /sans/i.test(name) ? SANS : SERIF_HINT.test(name) ? SERIF : SANS

// A CSS string, so a family name can't be anything else; system-ui is the generic keyword itself
const quote = (name: string) => (name === 'system-ui' ? name : `"${name.replace(/["\\]/g, '\\$&')}"`)
