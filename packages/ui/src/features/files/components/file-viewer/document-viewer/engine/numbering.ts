// List numbering (numbering.xml): abstract definitions, the w:num instances paragraphs point at, and the counters
// that turn "%1.%2." into "3.1." as the document is read in order.

import {attr, child, children, type XmlElement} from '@/features/files/components/file-viewer/shared/xml'

import {clamp, int, parseParaProps, parseRunProps, value, type ParaProps, type RunProps, type Theme} from './props'
import type {Styles} from './styles'

export type Level = {
	start: number
	format: string
	text: string
	// After which level (1-based) this one starts over; 0 never, undefined after any shallower level
	restart?: number
	legal: boolean
	suffix: 'tab' | 'space' | 'nothing'
	align: 'left' | 'center' | 'right'
	pPr: ParaProps
	rPr: RunProps
	style?: string
}

type Instance = {abstract: string; overrides: Map<number, {start?: number; level?: Level}>}

function parseLevel(element: XmlElement, theme: Theme | undefined): Level {
	const suffix = value(child(element, 'suff'))
	const align = value(child(element, 'lvlJc'))
	const restart = int(value(child(element, 'lvlRestart')))
	return {
		start: clamp(int(value(child(element, 'start'))) ?? 0, 0, 32767),
		format: value(child(element, 'numFmt')) ?? 'decimal',
		text: value(child(element, 'lvlText')) ?? '',
		restart: restart === undefined ? undefined : clamp(restart, 0, 9),
		legal: child(element, 'isLgl') !== undefined && value(child(element, 'isLgl')) !== '0',
		suffix: suffix === 'space' || suffix === 'nothing' ? suffix : 'tab',
		align: align === 'center' ? 'center' : align === 'right' || align === 'end' ? 'right' : 'left',
		pPr: parseParaProps(child(element, 'pPr'), theme),
		rPr: parseRunProps(child(element, 'rPr'), theme),
		style: value(child(element, 'pStyle')),
	}
}

export class Numbering {
	private abstracts = new Map<string, {levels: Array<Level | undefined>; numStyleLink?: string}>()
	private instances = new Map<number, Instance>()

	constructor(
		root: XmlElement | undefined,
		theme: Theme | undefined,
		private styles: Styles,
	) {
		if (!root) return
		for (const element of children(root, 'abstractNum')) {
			const id = attr(element, 'abstractNumId')
			if (id === undefined || this.abstracts.has(id)) continue
			const levels: Array<Level | undefined> = []
			for (const lvl of children(element, 'lvl')) {
				const ilvl = int(attr(lvl, 'ilvl'))
				if (ilvl !== undefined && ilvl >= 0 && ilvl < 9) levels[ilvl] ??= parseLevel(lvl, theme)
			}
			this.abstracts.set(id, {
				levels,
				numStyleLink: value(child(element, 'numStyleLink')),
			})
		}
		for (const element of children(root, 'num')) {
			const numId = int(attr(element, 'numId'))
			const abstract = value(child(element, 'abstractNumId'))
			if (numId === undefined || abstract === undefined || this.instances.has(numId)) continue
			const overrides = new Map<number, {start?: number; level?: Level}>()
			for (const override of children(element, 'lvlOverride')) {
				const ilvl = int(attr(override, 'ilvl'))
				if (ilvl === undefined || ilvl < 0 || ilvl > 8) continue
				const start = int(value(child(override, 'startOverride')))
				const lvl = child(override, 'lvl')
				overrides.set(ilvl, {
					start: start === undefined ? undefined : clamp(start, 0, 32767),
					level: lvl ? parseLevel(lvl, theme) : undefined,
				})
			}
			this.instances.set(numId, {abstract, overrides})
		}
	}

	// The abstract definition that actually holds an instance's levels: one with w:numStyleLink borrows them from
	// the definition its numbering style points at
	private definition(numId: number) {
		let id = this.instances.get(numId)?.abstract
		for (let hops = 0; id !== undefined && hops < 4; hops++) {
			const abstract = this.abstracts.get(id)
			if (!abstract?.numStyleLink) return abstract && {id, abstract}
			const linked = this.styles.numberingStyle(abstract.numStyleLink).numId
			const next = linked === undefined ? undefined : this.instances.get(linked)?.abstract
			if (next === undefined || next === id) return {id, abstract}
			id = next
		}
		return undefined
	}

	level(numId: number, ilvl: number): Level | undefined {
		return this.instances.get(numId)?.overrides.get(ilvl)?.level ?? this.definition(numId)?.abstract.levels[ilvl]
	}

	// The level a paragraph style is bound to through w:pStyle, for styles that name a list but not a level
	levelOfStyle(numId: number, styleId: string): number | undefined {
		const index = this.definition(numId)?.abstract.levels.findIndex((level) => level?.style === styleId)
		return index === undefined || index < 0 ? undefined : index
	}

	// Counters for one story (the body, or a header…). Instances of the same abstract definition share them, so a
	// list continues across them, unless an instance overrides a level's start: that restarts it where it's first used.
	counters(): (numId: number, ilvl: number) => string | undefined {
		const values = new Map<string, Array<number | undefined>>()
		const started = new Set<number>()
		return (numId, ilvl) => {
			const definition = this.definition(numId)
			const level = this.level(numId, ilvl)
			if (!definition || !level) return undefined
			const counts = values.get(definition.id) ?? []
			values.set(definition.id, counts)
			const overrides = this.instances.get(numId)!.overrides
			if (!started.has(numId)) {
				started.add(numId)
				for (const [overridden, override] of overrides) {
					if (override.start !== undefined) counts[overridden] = override.start - 1
				}
			}
			const startOf = (index: number) =>
				overrides.get(index)?.start ?? this.level(numId, index)?.start ?? (index === ilvl ? level.start : 1)
			counts[ilvl] = (counts[ilvl] ?? startOf(ilvl) - 1) + 1
			for (let deeper = ilvl + 1; deeper < 9; deeper++) {
				const restart = this.level(numId, deeper)?.restart
				if (restart === undefined || (restart !== 0 && ilvl < restart)) counts[deeper] = undefined
			}
			if (level.format === 'bullet') return level.text
			return level.text.replace(/%([1-9])/g, (_, digit: string) => {
				const index = Number(digit) - 1
				const shown = this.level(numId, index)
				if (!shown || index > ilvl) return ''
				const format = level.legal && shown.format !== 'none' ? 'decimal' : shown.format
				return formatNumber(counts[index] ?? startOf(index), format)
			})
		}
	}
}

const ROMAN: Array<[number, string]> = [
	[1000, 'M'],
	[900, 'CM'],
	[500, 'D'],
	[400, 'CD'],
	[100, 'C'],
	[90, 'XC'],
	[50, 'L'],
	[40, 'XL'],
	[10, 'X'],
	[9, 'IX'],
	[5, 'V'],
	[4, 'IV'],
	[1, 'I'],
]

function roman(n: number): string {
	let out = ''
	let rest = n
	for (const [amount, digits] of ROMAN) {
		while (rest >= amount) {
			out += digits
			rest -= amount
		}
	}
	return out
}

// Word's alphabetic numbering repeats the letter rather than counting in base 26: …, z, aa, bb, …
const letter = (n: number) => (n < 1 ? '' : String.fromCharCode(65 + ((n - 1) % 26)).repeat(Math.ceil(n / 26)))

function ordinalSuffix(n: number): string {
	const tens = n % 100
	if (tens >= 11 && tens <= 13) return 'th'
	return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
}

const ONES = [
	'zero',
	'one',
	'two',
	'three',
	'four',
	'five',
	'six',
	'seven',
	'eight',
	'nine',
	'ten',
	'eleven',
	'twelve',
	'thirteen',
	'fourteen',
	'fifteen',
	'sixteen',
	'seventeen',
	'eighteen',
	'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const ORDINAL_WORDS: Record<string, string> = {
	one: 'first',
	two: 'second',
	three: 'third',
	five: 'fifth',
	eight: 'eighth',
	nine: 'ninth',
	twelve: 'twelfth',
}

function cardinal(n: number): string {
	if (n < 20) return ONES[n]
	if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '')
	if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${cardinal(n % 100)}` : ''}`
	return `${cardinal(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${cardinal(n % 1000)}` : ''}`
}

function ordinalWords(n: number): string {
	const words = cardinal(n)
	return words.replace(
		/([a-z]+)$/,
		(last) => ORDINAL_WORDS[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`),
	)
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const CHICAGO = ['*', '†', '‡', '§']

export function formatNumber(n: number, format: string): string {
	switch (format) {
		case 'none':
		case 'bullet':
			return ''
		case 'decimalZero':
			return n < 10 && n >= 0 ? `0${n}` : String(n)
		case 'upperRoman':
			return roman(n)
		case 'lowerRoman':
			return roman(n).toLowerCase()
		case 'upperLetter':
			return letter(n)
		case 'lowerLetter':
			return letter(n).toLowerCase()
		case 'ordinal':
			return `${n}${ordinalSuffix(n)}`
		case 'cardinalText':
			return n >= 0 && n < 1_000_000 ? capitalize(cardinal(n)) : String(n)
		case 'ordinalText':
			return n > 0 && n < 1_000_000 ? capitalize(ordinalWords(n)) : String(n)
		case 'decimalEnclosedCircle':
			return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n)
		case 'decimalEnclosedParen':
			return n >= 1 && n <= 20 ? String.fromCharCode(0x2474 + n - 1) : `(${n})`
		case 'decimalEnclosedFullstop':
			return n >= 1 && n <= 20 ? String.fromCharCode(0x2488 + n - 1) : `${n}.`
		case 'chicago':
			return n < 1 ? '' : CHICAGO[(n - 1) % 4].repeat(Math.ceil(n / 4))
		case 'decimalFullWidth':
			return String(n).replace(/\d/g, (digit) => String.fromCharCode(0xff10 + Number(digit)))
		default:
			return String(n)
	}
}
