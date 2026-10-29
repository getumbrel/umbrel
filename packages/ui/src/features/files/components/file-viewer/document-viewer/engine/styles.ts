// The document's formatting context: theme, settings and styles.xml, and the cascade that turns a paragraph's or
// run's direct formatting into what it actually looks like (ECMA-376 17.7.2: document defaults, table style,
// numbering, paragraph style, character style, direct formatting).

import {schemeColors} from '@/features/files/components/file-viewer/shared/color'
import {lookup} from '@/features/files/components/file-viewer/shared/lookup'
import {attr, child, children, type XmlElement} from '@/features/files/components/file-viewer/shared/xml'

import {
	clamp,
	int,
	isOn,
	length,
	mergeCell,
	mergePara,
	mergeRun,
	mergeTable,
	onOff,
	parseCellProps,
	parseParaProps,
	parseRunProps,
	parseTableProps,
	value,
	type CellProps,
	type FontRef,
	type ParaProps,
	type RunProps,
	type TableProps,
	type Theme,
	type ThemeFonts,
} from './props'

// ---------------------------------------------------------------------------------------------------------------
// Theme

const SLOT_NAMES = lookup<string>({
	dk1: 'dark1',
	lt1: 'light1',
	dk2: 'dark2',
	lt2: 'light2',
	hlink: 'hyperlink',
	folHlink: 'followedHyperlink',
})
// The colour mapping's names as DrawingML spells them
const DRAWING_NAMES = lookup<string>({text1: 'tx1', background1: 'bg1', text2: 'tx2', background2: 'bg2'})
// The script whose theme font a language uses, for East Asian and complex-script text
const LANGUAGE_SCRIPTS = lookup<string>({
	ja: 'Jpan',
	ko: 'Hang',
	'zh-CN': 'Hans',
	'zh-SG': 'Hans',
	zh: 'Hant',
	ar: 'Arab',
	fa: 'Arab',
	ur: 'Arab',
	he: 'Hebr',
	th: 'Thai',
	hi: 'Deva',
})

const scriptOf = (lang: string | undefined) =>
	lang ? (LANGUAGE_SCRIPTS[lang] ?? LANGUAGE_SCRIPTS[lang.split('-')[0]]) : undefined

export function parseTheme(root: XmlElement | undefined, settings: Settings): Theme | undefined {
	const elements = root && child(root, 'themeElements')
	if (!elements) return undefined
	const scheme = child(elements, 'clrScheme')
	const fontScheme = child(elements, 'fontScheme')
	const fonts = (local: string): ThemeFonts => {
		const group = fontScheme && child(fontScheme, local)
		const typeface = (element: XmlElement | undefined) => (element && attr(element, 'typeface')) || undefined
		const forScript = (script: string | undefined) =>
			script ? typeface(children(group!, 'font').find((font) => attr(font, 'script') === script)) : undefined
		if (!group) return {}
		return {
			latin: typeface(child(group, 'latin')),
			eastAsia: typeface(child(group, 'ea')) ?? forScript(scriptOf(settings.languages.eastAsia)),
			cs: typeface(child(group, 'cs')) ?? forScript(scriptOf(settings.languages.bidi)),
		}
	}
	const palette = {
		scheme: schemeColors(scheme),
		map: Object.fromEntries([...settings.colorMapping].map(([name, slot]) => [DRAWING_NAMES[name] ?? name, slot])),
	}
	return {palette, major: fonts('majorFont'), minor: fonts('minorFont')}
}

// The font a run's slot names: a face, or a theme font looked up in the theme
export function fontName(ref: FontRef | undefined, theme: Theme | undefined): string | undefined {
	if (ref === undefined || typeof ref === 'string') return ref
	const fonts = ref.theme.startsWith('major') ? theme?.major : theme?.minor
	if (!fonts) return undefined
	if (ref.theme.endsWith('EastAsia')) return fonts.eastAsia ?? fonts.latin
	if (ref.theme.endsWith('Bidi')) return fonts.cs ?? fonts.latin
	return fonts.latin
}

// ---------------------------------------------------------------------------------------------------------------
// Settings

export type NoteSettings = {format: string; start: number}

export type Settings = {
	defaultTabStop: number
	evenAndOddHeaders: boolean
	mirrorMargins: boolean
	gutterAtTop: boolean
	autoHyphenation: boolean
	// Word versions change layout rules; 15 is Word 2013 and later
	compatibilityMode: number
	languages: {latin?: string; eastAsia?: string; bidi?: string}
	colorMapping: Map<string, string>
	displayBackgroundShape: boolean
	footnotes: NoteSettings
	endnotes: NoteSettings
	// What edits made here would break: Track Changes (they'd be saved untracked), or an editing restriction (they'd
	// get past it)
	protection?: 'tracked' | 'protected'
}

const DEFAULT_MAPPING: Array<[string, string]> = [
	['text1', 'dk1'],
	['background1', 'lt1'],
	['text2', 'dk2'],
	['background2', 'lt2'],
]
const MAPPING_ATTRIBUTES: Record<string, string> = {t1: 'text1', bg1: 'background1', t2: 'text2', bg2: 'background2'}

function noteSettings(element: XmlElement | undefined, format: string): NoteSettings {
	return {
		format: value(element && child(element, 'numFmt')) ?? format,
		start: clamp(int(value(element && child(element, 'numStart'))) ?? 1, 0, 32767),
	}
}

export function parseSettings(root: XmlElement | undefined): Settings {
	const get = (local: string) => (root ? child(root, local) : undefined)
	const colorMapping = new Map(DEFAULT_MAPPING)
	const mapping = get('clrSchemeMapping')
	if (mapping) {
		for (const [key, name] of Object.entries(MAPPING_ATTRIBUTES)) {
			const mapped = attr(mapping, key)
			// The mapping names scheme slots by their long names (dark1, light2…)
			const slot = mapped && Object.entries(SLOT_NAMES).find(([, long]) => long === mapped)?.[0]
			if (slot) colorMapping.set(name, slot)
		}
	}
	const compat = get('compat')
	const mode =
		compat && children(compat, 'compatSetting').find((setting) => attr(setting, 'name') === 'compatibilityMode')
	const languages = get('themeFontLang')
	const protection = get('documentProtection')
	const restricted = protection && isOn(attr(protection, 'enforcement')) ? attr(protection, 'edit') : undefined
	return {
		defaultTabStop: clamp(length(get('defaultTabStop'), 'val') ?? 48, 4, 31680 / 15),
		evenAndOddHeaders: onOff(get('evenAndOddHeaders')) ?? false,
		mirrorMargins: onOff(get('mirrorMargins')) ?? false,
		gutterAtTop: onOff(get('gutterAtTop')) ?? false,
		autoHyphenation: onOff(get('autoHyphenation')) ?? false,
		compatibilityMode: int(mode ? attr(mode, 'val') : undefined) ?? 12,
		languages: {
			latin: (languages && attr(languages, 'val')) || undefined,
			eastAsia: (languages && attr(languages, 'eastAsia')) || undefined,
			bidi: (languages && attr(languages, 'bidi')) || undefined,
		},
		colorMapping,
		displayBackgroundShape: onOff(get('displayBackgroundShape')) ?? false,
		footnotes: noteSettings(get('footnotePr'), 'decimal'),
		endnotes: noteSettings(get('endnotePr'), 'lowerRoman'),
		protection:
			restricted === 'readOnly' || restricted === 'comments' || restricted === 'forms'
				? 'protected'
				: restricted === 'trackedChanges' || onOff(get('trackRevisions'))
					? 'tracked'
					: undefined,
	}
}

// ---------------------------------------------------------------------------------------------------------------
// Styles

export type ConditionalType =
	| 'wholeTable'
	| 'band1Vert'
	| 'band2Vert'
	| 'band1Horz'
	| 'band2Horz'
	| 'firstCol'
	| 'lastCol'
	| 'firstRow'
	| 'lastRow'
	| 'neCell'
	| 'nwCell'
	| 'seCell'
	| 'swCell'

// Later entries win where a cell meets several conditions, per ECMA-376 17.7.6
export const CONDITIONAL_ORDER: ConditionalType[] = [
	'wholeTable',
	'band1Vert',
	'band2Vert',
	'band1Horz',
	'band2Horz',
	'firstCol',
	'lastCol',
	'firstRow',
	'lastRow',
	'neCell',
	'nwCell',
	'seCell',
	'swCell',
]

export type Formatting = {pPr: ParaProps; rPr: RunProps; tblPr: TableProps; tcPr: CellProps}

type StyleDefinition = {
	type: string
	basedOn?: string
	formatting: Formatting
	conditional: Map<string, Formatting>
}

export type TableStyle = Formatting & {conditional: Map<string, Formatting>}

const EMPTY: Formatting = {pPr: {}, rPr: {}, tblPr: {}, tcPr: {}}

function formatting(element: XmlElement, theme: Theme | undefined): Formatting {
	return {
		pPr: parseParaProps(child(element, 'pPr'), theme),
		rPr: parseRunProps(child(element, 'rPr'), theme),
		tblPr: parseTableProps(child(element, 'tblPr'), theme),
		tcPr: parseCellProps(child(element, 'tcPr'), theme),
	}
}

const mergeFormatting = (base: Formatting, over: Formatting): Formatting => ({
	pPr: mergePara(base.pPr, over.pPr),
	rPr: mergeRun(base.rPr, over.rPr),
	tblPr: mergeTable(base.tblPr, over.tblPr),
	tcPr: mergeCell(base.tcPr, over.tcPr),
})

// basedOn chains deeper than this are hostile or broken
const MAX_CHAIN = 32
const ON = new Set(['1', 'true', 'on'])

export class Styles {
	readonly runDefaults: RunProps
	readonly paraDefaults: ParaProps
	readonly defaultParagraph: string | undefined
	readonly defaultTable: string | undefined
	private definitions = new Map<string, StyleDefinition>()
	private resolved = new Map<string, TableStyle>()

	constructor(
		root: XmlElement | undefined,
		readonly theme: Theme | undefined,
	) {
		const defaults = root && child(root, 'docDefaults')
		const rPrDefault = defaults && child(defaults, 'rPrDefault')
		const pPrDefault = defaults && child(defaults, 'pPrDefault')
		this.runDefaults = parseRunProps(rPrDefault && child(rPrDefault, 'rPr'), theme)
		this.paraDefaults = parseParaProps(pPrDefault && child(pPrDefault, 'pPr'), theme)
		let defaultParagraph: string | undefined
		let defaultTable: string | undefined
		for (const style of root ? children(root, 'style') : []) {
			const id = attr(style, 'styleId')
			const type = attr(style, 'type') ?? 'paragraph'
			if (!id || this.definitions.has(id)) continue
			const conditional = new Map<string, Formatting>()
			for (const part of children(style, 'tblStylePr')) {
				const kind = attr(part, 'type')
				if (kind) conditional.set(kind, formatting(part, theme))
			}
			this.definitions.set(id, {
				type,
				basedOn: value(child(style, 'basedOn')),
				formatting: formatting(style, theme),
				conditional,
			})
			if (ON.has(attr(style, 'default') ?? '')) {
				if (type === 'paragraph') defaultParagraph ??= id
				if (type === 'table') defaultTable ??= id
			}
		}
		this.defaultParagraph = defaultParagraph
		this.defaultTable = defaultTable
	}

	// A style with its basedOn chain applied: own properties over inherited ones. Styles of a different type than the
	// one asked for don't apply, so a paragraph can't pick up a table style by id.
	private style(id: string | undefined, type: string): TableStyle {
		if (!id) return {...EMPTY, conditional: new Map()}
		const key = `${type}:${id}`
		const cached = this.resolved.get(key)
		if (cached) return cached
		const chain: StyleDefinition[] = []
		const seen = new Set<string>()
		for (let next: string | undefined = id; next && !seen.has(next) && chain.length < MAX_CHAIN; ) {
			seen.add(next)
			const definition = this.definitions.get(next)
			if (!definition || definition.type !== type) break
			chain.unshift(definition)
			next = definition.basedOn
		}
		let result: Formatting = EMPTY
		const conditional = new Map<string, Formatting>()
		for (const definition of chain) {
			result = mergeFormatting(result, definition.formatting)
			for (const [kind, part] of definition.conditional) {
				conditional.set(kind, mergeFormatting(conditional.get(kind) ?? EMPTY, part))
			}
		}
		const style = {...result, conditional}
		this.resolved.set(key, style)
		return style
	}

	paragraphStyle(id: string | undefined): Formatting {
		return this.style(this.has(id, 'paragraph') ? id : this.defaultParagraph, 'paragraph')
	}

	characterStyle(id: string | undefined): RunProps {
		return this.style(id, 'character').rPr
	}

	tableStyle(id: string | undefined): TableStyle {
		return this.style(this.has(id, 'table') ? id : this.defaultTable, 'table')
	}

	numberingStyle(id: string | undefined): ParaProps {
		return this.style(id, 'numbering').pPr
	}

	has(id: string | undefined, type: string): boolean {
		return id !== undefined && this.definitions.get(id)?.type === type
	}

	// The style a paragraph actually has: its own if defined, else the default
	paragraphStyleId(id: string | undefined): string | undefined {
		return this.has(id, 'paragraph') ? id : this.defaultParagraph
	}

	// Runs: the paragraph's base, a character style toggling over it, direct formatting setting outright
	run(base: RunProps, direct: RunProps): RunProps {
		const styled = direct.styleId ? mergeRun(base, this.characterStyle(direct.styleId), true) : base
		return mergeRun(styled, direct)
	}
}
