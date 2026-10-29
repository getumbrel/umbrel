// Excel number formats: how a cell's number, or text, becomes what the grid
// shows. Our own implementation of the format codes of ECMA-376 Part 1
// §18.8.31 as Excel interprets them, in its locale-neutral en-US form. Numbers
// display from the 15 significant digits Excel keeps and round half away from
// zero, so 1.005 shows as 1.01 although the double is a hair below it.

import {maxSerial, partsFromSerial, weekday} from '../formula/dates'

export type FormattedValue = {
	text: string
	// From a [Red]-style code, as #RRGGBB
	color?: string
	// From a `*x` code: the renderer repeats `char` at `index` of the text until the cell is full, which is how
	// accounting formats pin the currency symbol left and the number right. Dates Excel can't show (negative or past
	// 9999) come back as a fill of #.
	fill?: {char: string; index: number}
}

// Excel's default palette (indexed colours 0–63); [Color1]–[Color56] in number formats are entries 8–63
export const INDEXED_COLORS = (
	'000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF ' +
	'800000 008000 000080 808000 800080 008080 C0C0C0 808080 9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF ' +
	'000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF 00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 ' +
	'3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 003366 339966 003300 333300 993300 993366 333399 333333'
)
	.split(' ')
	.map((hex) => `#${hex}`)

// Built-in formats by numFmtId. Ids 5–8, 14 and 22 follow the system locale; these are the en-US forms.
const BUILTIN_FORMATS = new Map<number, string>([
	[0, 'General'],
	[1, '0'],
	[2, '0.00'],
	[3, '#,##0'],
	[4, '#,##0.00'],
	[5, '"$"#,##0_);("$"#,##0)'],
	[6, '"$"#,##0_);[Red]("$"#,##0)'],
	[7, '"$"#,##0.00_);("$"#,##0.00)'],
	[8, '"$"#,##0.00_);[Red]("$"#,##0.00)'],
	[9, '0%'],
	[10, '0.00%'],
	[11, '0.00E+00'],
	[12, '# ?/?'],
	[13, '# ??/??'],
	[14, 'm/d/yyyy'],
	[15, 'd-mmm-yy'],
	[16, 'd-mmm'],
	[17, 'mmm-yy'],
	[18, 'h:mm AM/PM'],
	[19, 'h:mm:ss AM/PM'],
	[20, 'h:mm'],
	[21, 'h:mm:ss'],
	[22, 'm/d/yyyy h:mm'],
	[37, '#,##0_);(#,##0)'],
	[38, '#,##0_);[Red](#,##0)'],
	[39, '#,##0.00_);(#,##0.00)'],
	[40, '#,##0.00_);[Red](#,##0.00)'],
	[41, '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)'],
	[42, '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)'],
	[43, '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)'],
	[44, '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)'],
	[45, 'mm:ss'],
	[46, '[h]:mm:ss'],
	[47, 'mm:ss.0'],
	[48, '##0.0E+0'],
	[49, '@'],
])

// The East Asian built-ins (27–36, 50–81) depend on the workbook's locale. A file that uses one without defining
// it gets the nearest locale-neutral format, so its dates still read as dates.
const ALIASES: Record<number, number> = {32: 20, 33: 21, 59: 1, 60: 2, 61: 3, 62: 4, 67: 9, 68: 10, 69: 12, 70: 13}
for (const id of [27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58, 71, 72]) ALIASES[id] = 14
for (let id = 73; id <= 81; id++) ALIASES[id] = [15, 16, 17, 20, 21, 22, 45, 46, 47][id - 73]

export function builtinFormat(id: number): string | undefined {
	return BUILTIN_FORMATS.get(ALIASES[id] ?? id)
}

// Excel's General format, as TEXT(n, "General") gives it: at most 11 characters for the digits and decimal point,
// switching to 6 significant digits in scientific notation below 1E-5 and from 1E+11 up.
export function formatGeneral(n: number): string {
	if (!Number.isFinite(n)) return '#NUM!'
	if (n === 0) return '0'
	const sign = n < 0 ? '-' : ''
	let d = decimal(n)
	if (d.point > -4 && d.point < 12) {
		const decimals = d.point > 0 ? Math.max(0, 10 - d.point) : 9
		const rounded = round(d, d.point + decimals)
		// Rounding up to 12 integer digits pushes it into scientific notation after all
		if (rounded.point < 12) {
			const [int, frac] = split(rounded, decimals)
			const trimmed = frac.replace(TRAILING_ZEROS, '')
			return `${sign}${int || '0'}${trimmed && `.${trimmed}`}`
		}
		d = rounded
	}
	const {digits, point} = round(d, 6)
	const mantissa = digits.slice(1, 6).replace(TRAILING_ZEROS, '')
	const exponent = point - 1
	return `${sign}${digits[0]}${mantissa && `.${mantissa}`}E${exponent < 0 ? '-' : '+'}${pad(Math.abs(exponent), 2)}`
}

// Formats a number, or text (which only a format's text section changes), the way Excel would display it
export function formatNumber(value: number | string, code: string, options: {date1904?: boolean} = {}): FormattedValue {
	const format = compile(code)
	if (typeof value === 'string') {
		const section = format.text
		if (!section) return {text: value}
		return assemble(
			section,
			section.tokens.map((token) => (token.type === 'literal' ? token.text : token.type === 'text' ? value : '')),
			false,
		)
	}
	if (!Number.isFinite(value)) return {text: '#NUM!'}
	const choice = choose(format, value)
	if (!choice) return {text: formatGeneral(value)}
	const {section, minus} = choice
	const out = section.tokens.map((token) => (token.type === 'literal' ? token.text : ''))
	const magnitude = Math.abs(value)
	switch (section.kind) {
		case 'general':
			out[section.layout.general] = formatGeneral(magnitude)
			break
		case 'number':
			renderNumber(section, magnitude, out)
			break
		case 'scientific':
			renderScientific(section, magnitude, out)
			break
		case 'fraction':
			renderFraction(section, magnitude, out)
			break
		case 'date':
			// A negative date can't be shown, whatever its section
			if (!renderDate(section, minus ? value : magnitude, options.date1904 ?? false, out)) {
				return {text: '#', fill: {char: '#', index: 0}}
			}
			return assemble(section, out, false)
	}
	return assemble(section, out, minus)
}

// Whether a format shows numbers as dates or times, so a cell holding one is a date
export function isDateFormat(code: string): boolean {
	return compile(code).numeric[0]?.kind === 'date'
}

// ---------------------------------------------------------------------------
// Compiling format codes

type Condition = {operator: string; value: number}

type Token =
	| {type: 'literal'; text: string}
	| {type: 'fill'; char: string}
	| {type: 'digit'; char: string} // 0, # or ?
	| {type: 'point' | 'comma' | 'percent' | 'slash' | 'text' | 'general'}
	| {type: 'exponent'; text: string} // E+, E-, e+ or e-
	| {type: 'denominator'; value: number} // the 8 of ?/8
	| {type: 'date'; code: string; count: number} // y m d h s, or M for a minute once told apart from a month
	| {type: 'elapsed'; code: string; count: number} // [h] [mm] [ss]
	| {type: 'ampm'; text: string} // AM/PM or A/P, in the case written
	| {type: 'subsecond'; count: number} // the .00 after seconds

type Kind = 'general' | 'number' | 'scientific' | 'fraction' | 'date' | 'text' | 'literal'

// Token indexes of the placeholders each kind fills in
type Layout = {
	general: number
	int: number[]
	frac: number[]
	point: number
	grouping: boolean
	scale: number // powers of 1,000 to divide by, from trailing commas
	percent: number // powers of 100 to multiply by
	exponent: number
	exponentDigits: number[]
	numerator: number[]
	slash: number
	denominator: number[]
	fixedDenominator: number // 0 when the denominator is up to the placeholders
	subsecond: number // digits of seconds' fractions shown
	twelveHour: boolean
	date: boolean // shows a calendar date, not only a time
}

type Section = {tokens: Token[]; kind: Kind; color?: string; condition?: Condition; layout: Layout}
type Compiled = {numeric: Section[]; text?: Section; conditional: boolean}

const TRAILING_ZEROS = /0+$/
const COLORS = new Map([
	['black', '#000000'],
	['blue', '#0000FF'],
	['cyan', '#00FFFF'],
	['green', '#00FF00'],
	['magenta', '#FF00FF'],
	['red', '#FF0000'],
	['white', '#FFFFFF'],
	['yellow', '#FFFF00'],
])
const CONDITION = /^(<=|>=|<>|<|>|=)\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)$/
const ELAPSED = /^(?:h+|m+|s+)$/
const COLOR_N = /^color\s*(\d+)$/

const cache = new Map<string, Compiled>()

function compile(code: string): Compiled {
	let compiled = cache.get(code)
	if (compiled) return compiled
	const sections = splitSections(code || 'General').map(parseSection)
	let text: Section | undefined
	// A fourth section is for text; with fewer, a last section holding @ is
	if (sections.length >= 4) text = sections.splice(3)[0]
	else if (sections.at(-1)!.kind === 'text') text = sections.pop()
	compiled = {numeric: sections, text, conditional: sections.some((section) => section.condition)}
	// TEXT() can be fed any number of distinct codes; keep the cache bounded
	if (cache.size >= 1000) cache.clear()
	cache.set(code, compiled)
	return compiled
}

// Splits on the semicolons that aren't quoted, escaped or inside brackets
function splitSections(code: string): string[] {
	const sections: string[] = []
	let start = 0
	for (let i = 0; i < code.length; i++) {
		const c = code[i]
		if (c === '"') {
			const end = code.indexOf('"', i + 1)
			i = end < 0 ? code.length : end
		} else if (c === '\\' || c === '_' || c === '*') {
			i++
		} else if (c === '[') {
			const end = code.indexOf(']', i)
			if (end >= 0) i = end
		} else if (c === ';') {
			sections.push(code.slice(start, i))
			start = i + 1
		}
	}
	sections.push(code.slice(start))
	return sections
}

function parseSection(source: string): Section {
	const tokens: Token[] = []
	let color: string | undefined
	let condition: Condition | undefined
	const literal = (text: string) => {
		const last = tokens.at(-1)
		if (last?.type === 'literal') last.text += text
		else if (text) tokens.push({type: 'literal', text})
	}
	for (let i = 0; i < source.length; ) {
		const c = source[i]
		const lower = c.toLowerCase()
		if (c === '"') {
			const end = source.indexOf('"', i + 1)
			const stop = end < 0 ? source.length : end
			literal(source.slice(i + 1, stop))
			i = stop + 1
		} else if (c === '\\') {
			literal(source[i + 1] ?? '')
			i += 2
		} else if (c === '_') {
			// Space as wide as the next character; a plain space is close enough on screen
			literal(' ')
			i += 2
		} else if (c === '*') {
			tokens.push({type: 'fill', char: source[i + 1] ?? ' '})
			i += 2
		} else if (c === '[') {
			const end = source.indexOf(']', i)
			if (end < 0) {
				literal(source.slice(i))
				break
			}
			const content = source.slice(i + 1, end)
			const key = content.toLowerCase().trim()
			const conditionMatch = CONDITION.exec(key)
			const colorMatch = COLOR_N.exec(key)
			if (COLORS.has(key)) color = COLORS.get(key)
			else if (colorMatch) color = INDEXED_COLORS[Number(colorMatch[1]) + 7]
			else if (conditionMatch) condition = {operator: conditionMatch[1], value: Number(conditionMatch[2])}
			else if (ELAPSED.test(key)) tokens.push({type: 'elapsed', code: key[0], count: key.length})
			else if (content[0] === '$') {
				// [$€-2]: a currency symbol, then the locale it belongs to
				const dash = content.indexOf('-')
				literal(content.slice(1, dash < 0 ? undefined : dash))
			}
			// Anything else (locales, calendars, numeral systems) changes nothing in en-US
			i = end + 1
		} else if (c === '0' || c === '#' || c === '?') {
			tokens.push({type: 'digit', char: c})
			i++
		} else if (c === '.' || c === ',' || c === '%' || c === '@') {
			tokens.push({type: c === '.' ? 'point' : c === ',' ? 'comma' : c === '%' ? 'percent' : 'text'})
			i++
		} else if (c === '/') {
			tokens.push({type: 'slash'})
			i++
			let end = i
			if (source[end] >= '1' && source[end] <= '9') while (source[end] >= '0' && source[end] <= '9') end++
			if (end > i) {
				tokens.push({type: 'denominator', value: Number(source.slice(i, end))})
				i = end
			}
		} else if (lower === 'e' && (source[i + 1] === '+' || source[i + 1] === '-')) {
			tokens.push({type: 'exponent', text: source.slice(i, i + 2)})
			i += 2
		} else if (source.slice(i, i + 7).toLowerCase() === 'general') {
			tokens.push({type: 'general'})
			i += 7
		} else if (source.slice(i, i + 5).toUpperCase() === 'AM/PM' || source.slice(i, i + 3).toUpperCase() === 'A/P') {
			const length = source[i + 1] === '/' ? 3 : 5
			tokens.push({type: 'ampm', text: source.slice(i, i + length)})
			i += length
		} else if (lower === 'y' || lower === 'm' || lower === 'd' || lower === 'h' || lower === 's') {
			let end = i + 1
			while (source[end]?.toLowerCase() === lower) end++
			tokens.push({type: 'date', code: lower, count: end - i})
			i = end
		} else {
			literal(c)
			i++
		}
	}
	return classify(tokens, color, condition)
}

const has = (tokens: Token[], ...types: Token['type'][]) => tokens.some((token) => types.includes(token.type))

// The source text of a token that ends up as plain text in a section of another kind
function sourceOf(token: Token): string {
	switch (token.type) {
		case 'literal':
			return token.text
		case 'digit':
			return token.char
		case 'point':
			return '.'
		case 'comma':
			return ','
		case 'percent':
			return '%'
		case 'slash':
			return '/'
		case 'denominator':
			return String(token.value)
		case 'exponent':
		case 'ampm':
			return token.text
		case 'date':
			return token.code.repeat(token.count)
		default:
			return ''
	}
}

function classify(raw: Token[], color: string | undefined, condition: Condition | undefined): Section {
	// A slash with placeholders on both sides makes a fraction, even with literals between (# ?=/=?)
	const fractionSlash = raw.findIndex(
		(token, i) => token.type === 'slash' && placeholderBefore(raw, i) >= 0 && placeholderAfter(raw, i) >= 0,
	)
	const kind: Kind = has(raw, 'text')
		? 'text'
		: has(raw, 'general')
			? 'general'
			: has(raw, 'date', 'elapsed', 'ampm')
				? 'date'
				: has(raw, 'exponent')
					? 'scientific'
					: fractionSlash >= 0
						? 'fraction'
						: has(raw, 'digit')
							? 'number'
							: 'literal'
	const layout: Layout = {
		general: -1,
		int: [],
		frac: [],
		point: -1,
		grouping: false,
		scale: 0,
		percent: 0,
		exponent: -1,
		exponentDigits: [],
		numerator: [],
		slash: -1,
		denominator: [],
		fixedDenominator: 0,
		subsecond: 0,
		twelveHour: false,
		date: false,
	}
	// Every token a kind doesn't use is rebuilt as literal text, merging neighbours
	const tokens: Token[] = []
	const keep = (token: Token) => {
		tokens.push(token)
		return tokens.length - 1
	}
	const literal = (text: string) => {
		const last = tokens.at(-1)
		if (last?.type === 'literal') last.text += text
		else if (text) tokens.push({type: 'literal', text})
	}

	if (kind === 'date') {
		for (let i = 0; i < raw.length; i++) {
			const token = raw[i]
			if (token.type === 'point' && isSeconds(raw[i - 1]) && raw[i + 1]?.type === 'digit') {
				let end = i + 1
				while (raw[end]?.type === 'digit' && (raw[end] as {char: string}).char === '0') end++
				const count = Math.min(end - i - 1, 3)
				if (count > 0) {
					keep({type: 'subsecond', count})
					layout.subsecond = Math.max(layout.subsecond, count)
					i = end - 1
					continue
				}
			}
			if (token.type === 'date' && token.code === 'm' && token.count <= 2 && isMinute(raw, i)) {
				keep({type: 'date', code: 'M', count: token.count})
			} else if (token.type === 'date' || token.type === 'elapsed' || token.type === 'ampm' || token.type === 'fill') {
				keep({...token})
			} else literal(sourceOf(token))
		}
		layout.twelveHour = has(tokens, 'ampm')
		layout.date = tokens.some((token) => token.type === 'date' && 'ymd'.includes(token.code))
		return {tokens, kind, color, condition, layout}
	}

	if (kind === 'general' || kind === 'text' || kind === 'literal') {
		for (const token of raw) {
			if (token.type === 'general' && kind === 'general' && layout.general < 0) layout.general = keep(token)
			else if (token.type === 'text' && kind === 'text') keep(token)
			else if (token.type === 'fill') keep({...token})
			else literal(sourceOf(token))
		}
		return {tokens, kind, color, condition, layout}
	}

	// Numbers, fractions and scientific notation. A fraction's numerator is the run of placeholders before its slash,
	// its denominator the run (or number) after it, and any placeholders before the numerator are the integer part.
	const slash = kind === 'fraction' ? fractionSlash : -1
	const numeratorEnd = slash >= 0 ? placeholderBefore(raw, slash) : -1
	let numeratorStart = numeratorEnd
	while (raw[numeratorStart - 1]?.type === 'digit') numeratorStart--
	const denominatorStart = slash >= 0 ? placeholderAfter(raw, slash) : -1
	let denominatorEnd = denominatorStart
	if (raw[denominatorStart]?.type === 'digit') while (raw[denominatorEnd + 1]?.type === 'digit') denominatorEnd++
	const exponent = raw.findIndex((token) => token.type === 'exponent')
	const end = exponent >= 0 ? exponent : slash >= 0 ? numeratorStart : raw.length
	const point = raw.findIndex((token, i) => token.type === 'point' && i < end && kind !== 'fraction')
	const intEnd = point >= 0 ? point : end
	const isDigit = (i: number) => raw[i]?.type === 'digit'
	const firstDigit = raw.findIndex((token) => token.type === 'digit')
	let lastIntDigit = -1
	for (let i = 0; i < intEnd; i++) if (isDigit(i)) lastIntDigit = i

	for (let i = 0; i < raw.length; i++) {
		const token = raw[i]
		if (token.type === 'digit' && slash >= 0 && i > slash && i > denominatorEnd) {
			// Placeholders after a fraction's denominator are just characters
			literal(token.char)
		} else if (token.type === 'digit') {
			const index = keep({...token})
			if (exponent >= 0 && i > exponent) layout.exponentDigits.push(index)
			else if (slash >= 0 && i > slash) layout.denominator.push(index)
			else if (slash >= 0 && i >= numeratorStart) layout.numerator.push(index)
			else if (point >= 0 && i > point) layout.frac.push(index)
			else layout.int.push(index)
		} else if (token.type === 'comma') {
			// Between integer placeholders a comma groups thousands; after the last placeholder of its part it divides
			// by 1,000; anywhere else it's just a comma
			const before = firstDigit >= 0 && firstDigit < i
			let after = false
			for (let j = i + 1; j < (i < intEnd ? intEnd : end); j++) if (isDigit(j)) after = true
			if (before && after && i < lastIntDigit) layout.grouping = true
			else if (before && !after && i < end) layout.scale++
			else literal(',')
		} else if (token.type === 'percent') {
			layout.percent++
			literal('%')
		} else if (i === point) layout.point = keep(token)
		else if (i === slash) layout.slash = keep(token)
		else if (i === exponent) layout.exponent = keep({...token})
		else if (token.type === 'denominator' && i === denominatorStart) {
			layout.fixedDenominator = token.value
			layout.denominator.push(keep(token))
		} else if (token.type === 'fill') keep({...token})
		else literal(sourceOf(token))
	}
	// Grouping only applies to digits in one piece; with literals between the placeholders (a phone number) each
	// placeholder takes its own digit
	const {int} = layout
	if (int.length && tokens.slice(int[0], int.at(-1)! + 1).some((token) => token.type !== 'digit'))
		layout.grouping = false
	return {tokens, kind, color, condition, layout}
}

// The placeholders nearest a fraction's slash, looking past literals: the numerator's last, the denominator's first
function placeholderBefore(tokens: Token[], slash: number): number {
	let i = slash - 1
	while (tokens[i]?.type === 'literal') i--
	return tokens[i]?.type === 'digit' ? i : -1
}

function placeholderAfter(tokens: Token[], slash: number): number {
	let i = slash + 1
	while (tokens[i]?.type === 'literal') i++
	return tokens[i]?.type === 'digit' || tokens[i]?.type === 'denominator' ? i : -1
}

const isSeconds = (token: Token | undefined) =>
	(token?.type === 'date' || token?.type === 'elapsed') && token.code === 's'

// m is minutes right after hours or right before seconds (literals between don't count), else a month
function isMinute(tokens: Token[], at: number): boolean {
	const isTime = (token: Token) => token.type === 'date' || token.type === 'elapsed'
	for (let i = at - 1; i >= 0; i--) {
		const token = tokens[i]
		if (isTime(token)) {
			if ((token as {code: string}).code === 'h') return true
			break
		}
	}
	for (let i = at + 1; i < tokens.length; i++) {
		const token = tokens[i]
		if (isTime(token)) return (token as {code: string}).code === 's'
	}
	return false
}

// ---------------------------------------------------------------------------
// Rendering

function choose(format: Compiled, n: number): {section: Section; minus: boolean} | undefined {
	const sections = format.numeric
	if (!sections.length) return undefined
	if (format.conditional) {
		// The first section whose condition holds, or that has none
		const section = sections.find((s) => !s.condition || holds(s.condition, n))
		if (!section) return undefined
		const {condition} = section
		const negative = condition && (condition.operator === '<' || condition.operator === '<=') && condition.value === 0
		return {section, minus: n < 0 && !negative}
	}
	if (n > 0 || sections.length === 1 || (n === 0 && sections.length === 2)) return {section: sections[0], minus: n < 0}
	return {section: sections[n < 0 ? 1 : 2], minus: false}
}

function holds({operator, value}: Condition, n: number): boolean {
	switch (operator) {
		case '<':
			return n < value
		case '<=':
			return n <= value
		case '>':
			return n > value
		case '>=':
			return n >= value
		case '=':
			return n === value
		default:
			return n !== value
	}
}

function assemble(section: Section, out: string[], minus: boolean): FormattedValue {
	let text = minus ? '-' : ''
	let fill: FormattedValue['fill']
	section.tokens.forEach((token, i) => {
		if (token.type === 'fill') fill ??= {char: token.char, index: text.length}
		else text += out[i]
	})
	return {text, ...(section.color && {color: section.color}), ...(fill && {fill})}
}

const digitOf = (section: Section, index: number) => (section.tokens[index] as {char: string}).char
// What a placeholder shows when it has no digit: 0 a zero, ? a space, # nothing
const emptyDigit = (char: string) => (char === '0' ? '0' : char === '?' ? ' ' : '')

// Integer digits ('' for none) into their placeholders, right to left: each takes a digit and the leftmost takes all
// that are left. Grouped, they're joined with a comma every three places, padding included; a comma between padding
// spaces is a space too, so the digits stay aligned (Excel: ?,????????? shows 1234567 as "    1,234,567").
function fillInteger(section: Section, slots: number[], digits: string, grouping: boolean, out: string[]) {
	let rest = digits
	for (let k = slots.length - 1; k >= 0; k--) {
		const char = digitOf(section, slots[k])
		if (k === 0) out[slots[k]] = rest || emptyDigit(char)
		else if (rest) {
			out[slots[k]] = rest.slice(-1)
			rest = rest.slice(0, -1)
		} else out[slots[k]] = emptyDigit(char)
	}
	if (!grouping || !slots.length) return
	const all = slots.map((slot) => out[slot]).join('')
	let grouped = ''
	for (let i = all.length - 1, n = 0; i >= 0; i--, n++) {
		if (n && n % 3 === 0) grouped = (all[i] === ' ' ? ' ' : ',') + grouped
		grouped = all[i] + grouped
	}
	for (const slot of slots) out[slot] = ''
	out[slots[0]] = grouped
}

// Decimal digits into their placeholders, left to right; trailing zeros vanish under # and become spaces under ?
function fillDecimals(section: Section, slots: number[], digits: string, out: string[]) {
	let trailing = true
	for (let k = slots.length - 1; k >= 0; k--) {
		const char = digitOf(section, slots[k])
		if (trailing && digits[k] === '0' && char !== '0') {
			out[slots[k]] = emptyDigit(char)
			continue
		}
		trailing = false
		out[slots[k]] = digits[k]
	}
}

function renderNumber(section: Section, v: number, out: string[]) {
	const {int, frac, point, grouping, scale, percent} = section.layout
	const [intDigits, fracDigits] = fixed((v * 100 ** percent) / 1000 ** scale, frac.length)
	fillInteger(section, int, intDigits, grouping, out)
	fillDecimals(section, frac, fracDigits, out)
	// Without integer placeholders (.00) the integer digits still show, ahead of the point
	if (point >= 0) out[point] = (int.length ? '' : intDigits) + '.'
}

function renderScientific(section: Section, v: number, out: string[]) {
	const {int, frac, point, exponent, exponentDigits} = section.layout
	const places = Math.max(int.length, 1)
	// ##0.0E+0 is engineering notation: exponents in steps of the integer placeholders. 00.0E+0 fixes the integer
	// digits instead, and 0.0E+0 is plain scientific.
	const engineering = int.length > 1 && int.some((slot) => digitOf(section, slot) !== '0')
	let mantissa = ''
	let fraction = '0'.repeat(frac.length)
	let e = 0
	if (v !== 0) {
		let d = decimal(v)
		for (;;) {
			const top = d.point - 1
			e = engineering ? Math.floor(top / places) * places : top - places + 1
			const integerDigits = top - e + 1
			const rounded = round(d, integerDigits + frac.length)
			// A carry (9.99 → 10.0) moves the exponent; go again from the rounded value
			if (rounded.point !== d.point) {
				d = rounded
				continue
			}
			const all = rounded.digits.padEnd(integerDigits + frac.length, '0')
			mantissa = all.slice(0, integerDigits)
			fraction = all.slice(integerDigits)
			break
		}
	}
	fillInteger(section, int, mantissa.replace(/^0+/, ''), false, out)
	fillDecimals(section, frac, fraction, out)
	if (point >= 0) out[point] = (int.length ? '' : mantissa) + '.'
	const {text} = section.tokens[exponent] as {text: string}
	let zeros = 0
	for (const slot of exponentDigits) if (digitOf(section, slot) === '0') zeros++
	const sign = e < 0 ? '-' : text[1] === '+' ? '+' : ''
	out[exponent] = `${text[0]}${sign}${pad(Math.abs(e), zeros)}`
}

// Fractions follow Excel's rules (checked against Excel's own TEXT results): the literals between the integer part
// and the numerator go with the fraction, a whole number blanks the fraction (to spaces where a ? asks for
// alignment), a 0 in the numerator shows a zero fraction as 0/1 instead, and an integer part of zero shows only as
// its placeholders do.
function renderFraction(section: Section, v: number, out: string[]) {
	const {tokens, layout} = section
	const {int, numerator, slash, denominator, fixedDenominator} = layout
	const mixed = int.length > 0
	let whole = mixed ? Math.floor(v) : 0
	const part = v - whole
	const [approximated, den] = fixedDenominator
		? [Math.round(part * fixedDenominator), fixedDenominator]
		: approximate(part, 10 ** Math.min(denominator.length, 7) - 1)
	let num = approximated
	if (mixed && num === den) {
		whole++
		num = 0
	}
	const uses = (slots: number[], char: string) => slots.some((slot) => digitOf(section, slot) === char)
	const zeroShown = uses(numerator, '0')
	const shown = !mixed || num !== 0 || zeroShown
	let wholeDigits = whole ? fixed(whole, 0)[0] : ''
	// Something has to show for a whole number of zero
	if (!shown) wholeDigits ||= '0'
	else if (!whole && !num && (uses(int, '?') || uses(int, '0'))) wholeDigits = '0'
	fillInteger(section, int, wholeDigits, layout.grouping, out)
	// The fraction's own tokens: from just after the integer part to the denominator
	const first = mixed ? int.at(-1)! + 1 : numerator[0]
	const last = denominator.at(-1)!
	if (!shown) {
		let width = 0
		for (let i = first; i <= last; i++) {
			const token = tokens[i]
			width +=
				token.type === 'literal' ? token.text.length : token.type === 'denominator' ? String(token.value).length : 1
			out[i] = ''
		}
		if (uses(int, '?') || uses(numerator, '?') || uses(denominator, '?')) out[first] = ' '.repeat(width)
		return
	}
	if (mixed && !/\d/.test(int.map((slot) => out[slot]).join(''))) {
		// With no integer digits the separator after them goes too, or becomes spaces for ? alignment
		const spaces = uses(int, '?') || uses(numerator, '?')
		for (let i = first; i < numerator[0]; i++) out[i] = spaces ? ' '.repeat(out[i].length) : ''
	}
	fillInteger(section, numerator, num ? fixed(num, 0)[0] : '0', false, out)
	out[slash] = '/'
	// A denominator is left-aligned under ?, and 0 pads it with leading zeros
	const text = String(den)
	out[denominator[0]] = fixedDenominator
		? text
		: uses(denominator, '0')
			? text.padStart(denominator.length, '0')
			: uses(denominator, '?')
				? text.padEnd(denominator.length, ' ')
				: text
}

const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
]
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// False when Excel would show ####: a negative serial or one past 9999-12-31
function renderDate(section: Section, serial: number, date1904: boolean, out: string[]): boolean {
	const {subsecond, twelveHour} = section.layout
	if (!(serial >= 0 && serial < maxSerial(date1904) + 1)) return false
	// Time rounds to the finest unit shown (seconds unless fractions are), and the rounding can carry into the date
	const perSecond = 10 ** subsecond
	const ticks = Math.round(serial * 86400 * perSecond)
	const days = Math.floor(ticks / (86400 * perSecond))
	const inDay = ticks - days * 86400 * perSecond
	const second = Math.floor(inDay / perSecond)
	const fraction = inDay - second * perSecond
	const hour = Math.floor(second / 3600)
	const parts = section.layout.date ? partsFromSerial(days, date1904) : undefined
	if (section.layout.date && !parts) return false
	const [year, month, day] = parts ?? [0, 0, 0]
	section.tokens.forEach((token, i) => {
		if (token.type === 'date') {
			const {code, count} = token
			if (code === 'y') out[i] = count <= 2 ? pad(year % 100, 2) : String(year)
			else if (code === 'm') {
				const name = MONTHS[month - 1]
				out[i] = count <= 2 ? pad(month, count) : count === 3 ? name.slice(0, 3) : count === 5 ? name[0] : name
			} else if (code === 'd') {
				const name = DAYS[weekday(days, date1904)]
				out[i] = count <= 2 ? pad(day, count) : count === 3 ? name.slice(0, 3) : name
			} else if (code === 'h') out[i] = pad(twelveHour ? hour % 12 || 12 : hour, Math.min(count, 2))
			else if (code === 'M') out[i] = pad(Math.floor(second / 60) % 60, Math.min(count, 2))
			else out[i] = pad(second % 60, Math.min(count, 2))
		} else if (token.type === 'elapsed') {
			const unit = token.code === 'h' ? 3600 : token.code === 'm' ? 60 : 1
			out[i] = pad(Math.floor(ticks / (unit * perSecond)), token.count)
		} else if (token.type === 'ampm') {
			// AM/PM is always capitals, whatever its case in the format; A/P keeps the letters as written
			const pm = hour >= 12
			out[i] = token.text.length === 5 ? (pm ? 'PM' : 'AM') : token.text[pm ? 2 : 0]
		} else if (token.type === 'subsecond') {
			out[i] = `.${pad(fraction, subsecond).slice(0, token.count)}`
		}
	})
	return true
}

const pad = (n: number, width: number) => String(n).padStart(width, '0')

// The fraction closest to x with a denominator up to maxDenominator: the last continued-fraction convergent within
// reach, or the best semiconvergent past it
function approximate(x: number, maxDenominator: number): [number, number] {
	let [p0, q0, p1, q1] = [0, 1, 1, 0]
	let r = x
	for (;;) {
		const a = Math.floor(r)
		const p2 = a * p1 + p0
		const q2 = a * q1 + q0
		if (q2 > maxDenominator) {
			const t = Math.floor((maxDenominator - q0) / q1)
			const p = p0 + t * p1
			const q = q0 + t * q1
			return Math.abs(x - p / q) < Math.abs(x - p1 / q1) ? [p, q] : [p1, q1]
		}
		;[p0, q0, p1, q1] = [p1, q1, p2, q2]
		const rest = r - a
		if (rest < 1e-9) return [p1, q1]
		r = 1 / rest
	}
}

// ---------------------------------------------------------------------------
// Decimal digits, as Excel displays them

// |n| to 15 significant digits: the digits, and how many of them come before the decimal point (zero or negative
// below 1)
type Decimal = {digits: string; point: number}

function decimal(n: number): Decimal {
	const e = Math.abs(n).toExponential(14)
	return {digits: e[0] + e.slice(2, 16), point: Number(e.slice(17)) + 1}
}

// Keeps the first `keep` digits, rounding half away from zero; a carry past the first digit adds one in front
function round({digits, point}: Decimal, keep: number): Decimal {
	if (keep >= digits.length) return {digits, point}
	if (keep < 0) return {digits: '', point}
	let kept = digits.slice(0, keep)
	if (digits.charCodeAt(keep) >= 53) {
		let i = keep - 1
		while (i >= 0 && kept.charCodeAt(i) === 57) i--
		if (i < 0) return {digits: `1${'0'.repeat(keep)}`, point: point + 1}
		kept = kept.slice(0, i) + String.fromCharCode(kept.charCodeAt(i) + 1) + '0'.repeat(keep - 1 - i)
	}
	return {digits: kept, point}
}

// The integer digits ('' for zero) and exactly `decimals` decimal digits
function split({digits, point}: Decimal, decimals: number): [int: string, frac: string] {
	if (point <= 0) return ['', ('0'.repeat(-point) + digits).padEnd(decimals, '0').slice(0, decimals)]
	const all = digits.padEnd(point + decimals, '0')
	return [all.slice(0, point).replace(/^0+/, ''), all.slice(point, point + decimals)]
}

function fixed(v: number, decimals: number): [int: string, frac: string] {
	const d = decimal(v)
	return split(round(d, d.point + decimals), decimals)
}
