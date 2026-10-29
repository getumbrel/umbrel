// Excel formula syntax as stored in .xlsx files: A1 references, en-US function
// names, comma separators and no leading '='. The tokenizer keeps source
// offsets so shiftFormula can rewrite references in place, and the parser is a
// Pratt parser with Excel's precedence, where negation binds tighter than ^.

import {decimalToNumber, errorFromCode, type ErrorCode, type Value} from './values'

export const MAX_ROWS = 1048576
export const MAX_COLS = 16384
// Excel's own limit on formula length; it also bounds the work a hostile file can ask for
export const MAX_FORMULA_LENGTH = 8192
// Nesting of parentheses, calls and prefix operators. Excel allows 64 levels
// of calls; this keeps recursion far from the stack limit.
const MAX_DEPTH = 256
const MAX_ARGUMENTS = 255

export class FormulaSyntaxError extends Error {
	readonly position: number

	constructor(message: string, position: number) {
		super(message)
		this.name = 'FormulaSyntaxError'
		this.position = position
	}
}

// 0-based and inclusive; a whole column spans every row and a whole row every column
export type Area = {top: number; left: number; bottom: number; right: number}

export type BinaryOperator = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '<=' | '>' | '>=' | ':' | ' '

// What we can parse but not calculate: external workbooks, 3D references,
// tables, spill references, the @ operator, sheet-scoped names and the newer
// error values. Formulas containing them are reported stale.
export type UnsupportedReason = 'external' | '3d' | 'structured' | 'spill' | 'implicit' | 'scoped-name' | 'error'

export type Ast =
	| {type: 'number'; value: number}
	| {type: 'string'; value: string}
	| {type: 'boolean'; value: boolean}
	| {type: 'error'; value: ErrorCode}
	| {type: 'ref'; sheet?: string; area: Area}
	| {type: 'name'; name: string}
	// name is upper-cased, without the _xlfn./_xlws. prefixes files use for newer functions
	| {type: 'call'; name: string; args: Ast[]}
	| {type: 'unary'; operator: '+' | '-' | '%'; operand: Ast}
	// Chains of one operator are left-deep: 1+2+3 is (1+2)+3
	| {type: 'binary'; operator: BinaryOperator; left: Ast; right: Ast}
	| {type: 'union'; areas: Ast[]}
	| {type: 'array'; rows: Value[][]}
	| {type: 'missing'}
	| {type: 'unsupported'; reason: UnsupportedReason}

type Fixed = {top: boolean; left: boolean; bottom: boolean; right: boolean}

export type RefToken = {
	kind: 'ref'
	sheet?: string
	unsupported?: 'external' | '3d'
	form: 'cell' | 'range' | 'columns' | 'rows'
	// As written, so top/left belong to the first corner and pair with `fixed`
	// even when the range is reversed (A10:A$5)
	area: Area
	fixed: Fixed
	// Where the reference proper starts, after any sheet prefix
	refStart: number
	start: number
	end: number
}

export type Token =
	| RefToken
	| {kind: 'number'; value: number; start: number; end: number}
	| {kind: 'string'; value: string; start: number; end: number}
	| {kind: 'boolean'; value: boolean; start: number; end: number}
	// value is undefined for error literals we don't model (#GETTING_DATA, #FIELD!...)
	| {kind: 'error'; value: ErrorCode | undefined; start: number; end: number}
	| {kind: 'name'; name: string; start: number; end: number}
	| {kind: 'function'; name: string; start: number; end: number}
	| {kind: 'operator'; value: string; start: number; end: number}
	| {kind: 'unsupported'; reason: UnsupportedReason; start: number; end: number}

const ERROR_LITERALS = [
	'#NULL!',
	'#DIV/0!',
	'#VALUE!',
	'#REF!',
	'#NAME?',
	'#NUM!',
	'#N/A',
	'#SPILL!',
	'#CALC!',
	'#GETTING_DATA',
	'#FIELD!',
	'#BLOCKED!',
	'#CONNECT!',
	'#BUSY!',
	'#UNKNOWN!',
	'#PYTHON!',
	'#EXTERNAL!',
]

const NON_ASCII_WORD = /[\p{L}\p{N}\p{M}]/u
// Characters of names, function names and unquoted sheet names
function isWordChar(c: number) {
	if (c < 128) {
		return (
			(c >= 97 && c <= 122) ||
			(c >= 65 && c <= 90) ||
			(c >= 48 && c <= 57) ||
			c === 95 ||
			c === 46 ||
			c === 92 ||
			c === 63
		)
	}
	return NON_ASCII_WORD.test(String.fromCharCode(c))
}
const isDigit = (c: number) => c >= 48 && c <= 57
const isLetter = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90)
const isSpace = (c: number) => c === 32 || c === 10 || c === 13 || c === 9

const OPERATORS = new Set([
	'+',
	'-',
	'*',
	'/',
	'^',
	'&',
	'%',
	'=',
	'<>',
	'<=',
	'>=',
	'<',
	'>',
	'(',
	')',
	',',
	';',
	'{',
	'}',
	'@',
	':',
])

export function tokenize(text: string): Token[] {
	if (text.length > MAX_FORMULA_LENGTH) throw new FormulaSyntaxError('The formula is too long', MAX_FORMULA_LENGTH)
	return new Lexer(text).tokens
}

// A class rather than closures: formulas are tokenized by the hundred thousand when a workbook loads
class Lexer {
	readonly text: string
	readonly tokens: Token[] = []
	#spaceStart = -1
	// What readColumn/readRow found, kept here so the hot path allocates nothing
	#value = 0
	#fixed = false

	constructor(text: string) {
		this.text = text
		let i = 0
		while (i < text.length) {
			const c = text.charCodeAt(i)
			if (isSpace(c)) {
				if (this.#spaceStart < 0) this.#spaceStart = i
				i++
			} else if (c === 34) i = this.#string(i)
			else if (c === 35) i = this.#hash(i)
			else if (c === 39 || c === 91 || c === 36 || isWordChar(c)) i = this.#operand(i)
			else {
				const two = text.slice(i, i + 2)
				const value = two === '<>' || two === '<=' || two === '>=' ? two : text[i]
				if (!OPERATORS.has(value)) this.#fail(`Unexpected character "${value}"`, i)
				this.#push({kind: 'operator', value, start: i, end: i + value.length})
				i += value.length
			}
		}
	}

	#fail(message: string, at: number): never {
		throw new FormulaSyntaxError(message, at)
	}

	// A space between two references is Excel's intersection operator
	#push(token: Token) {
		const {tokens} = this
		if (this.#spaceStart >= 0 && endsOperand(tokens[tokens.length - 1]) && startsOperand(token)) {
			tokens.push({kind: 'operator', value: ' ', start: this.#spaceStart, end: token.start})
		}
		tokens.push(token)
		this.#spaceStart = -1
	}

	#string(start: number): number {
		const {text} = this
		let value = ''
		let i = start + 1
		for (;;) {
			const close = text.indexOf('"', i)
			if (close < 0) this.#fail('A text value is missing its closing quote', start)
			value += text.slice(i, close)
			i = close + 1
			if (text.charCodeAt(i) !== 34) break
			value += '"'
			i++
		}
		this.#push({kind: 'string', value, start, end: i})
		return i
	}

	// An error value, or the spill operator right after a reference (A1#)
	#hash(start: number): number {
		const {text, tokens} = this
		const previous = tokens[tokens.length - 1]
		if (this.#spaceStart < 0 && previous?.end === start && (previous.kind === 'ref' || previous.kind === 'name')) {
			this.#push({kind: 'operator', value: '#', start, end: start + 1})
			return start + 1
		}
		const literal = ERROR_LITERALS.find((code) => text.slice(start, start + code.length).toUpperCase() === code)
		if (!literal) this.#fail('Unknown error value', start)
		this.#push({kind: 'error', value: errorFromCode(literal)?.error, start, end: start + literal.length})
		return start + literal.length
	}

	// Everything that starts with a quote, bracket, $, letter or digit: references
	// (with an optional sheet prefix), numbers, booleans, names and function calls
	#operand(start: number): number {
		const {text} = this
		let p = start
		let sheet: string | undefined
		let unsupported: RefToken['unsupported']
		const c = text.charCodeAt(p)
		if (c === 39) {
			let name = ''
			p++
			for (;;) {
				const close = text.indexOf("'", p)
				if (close < 0) this.#fail('A sheet name is missing its closing quote', start)
				name += text.slice(p, close)
				p = close + 1
				if (text.charCodeAt(p) !== 39) break
				name += "'"
				p++
			}
			if (text.charCodeAt(p) !== 33) this.#fail('Expected "!" after the sheet name', p)
			p++
			sheet = name
			// Sheet names can't contain these, so they mark another workbook or a span of sheets
			if (name.includes('[')) unsupported = 'external'
			else if (name.includes(':')) unsupported = '3d'
		} else if (c === 91) {
			const close = this.#closingBracket(p)
			if (text.charCodeAt(close) !== 33 && !isWordChar(text.charCodeAt(close))) {
				// [@Column] inside a table
				this.#push({kind: 'unsupported', reason: 'structured', start, end: close})
				return close
			}
			// [1]Sheet1!A1 or [1]!Name: a reference into another workbook
			p = close
			while (isWordChar(text.charCodeAt(p))) p++
			if (text.charCodeAt(p) !== 33) this.#fail('Expected "!" after the workbook reference', p)
			sheet = text.slice(start, p++)
			unsupported = 'external'
		} else if (c !== 36) {
			let q = p
			while (isWordChar(text.charCodeAt(q))) q++
			if (text.charCodeAt(q) === 33) {
				sheet = text.slice(p, q)
				p = q + 1
			} else if (text.charCodeAt(q) === 58) {
				// Sheet1:Sheet3!A1
				let r = q + 1
				while (isWordChar(text.charCodeAt(r))) r++
				if (r > q + 1 && text.charCodeAt(r) === 33) {
					sheet = text.slice(p, r)
					unsupported = '3d'
					p = r + 1
				}
			}
		}

		const end = this.#reference(p, start, sheet, unsupported)
		if (end >= 0) return end
		if (sheet !== undefined) {
			if (text.slice(p, p + 5).toUpperCase() === '#REF!') {
				this.#push({kind: 'error', value: '#REF!', start, end: p + 5})
				return p + 5
			}
			let q = p
			while (isWordChar(text.charCodeAt(q))) q++
			if (q === p) this.#fail('Expected a reference after the sheet name', p)
			this.#push({kind: 'unsupported', reason: unsupported ?? 'scoped-name', start, end: q})
			return q
		}
		if (isDigit(c) || c === 46) return this.#number(start)
		if (c === 36) this.#fail('Invalid reference', start)

		let q = start
		while (isWordChar(text.charCodeAt(q))) q++
		const word = text.slice(start, q)
		const next = text.charCodeAt(q)
		if (next === 40) {
			this.#push({kind: 'function', name: functionName(word), start, end: q + 1})
			return q + 1
		}
		if (next === 91) {
			// Table1[Column]
			const close = this.#closingBracket(q)
			this.#push({kind: 'unsupported', reason: 'structured', start, end: close})
			return close
		}
		const upper = word.toUpperCase()
		if (upper === 'TRUE' || upper === 'FALSE') this.#push({kind: 'boolean', value: upper === 'TRUE', start, end: q})
		else this.#push({kind: 'name', name: word, start, end: q})
		return q
	}

	#number(start: number): number {
		const {text} = this
		let p = start
		let digits = 0
		while (isDigit(text.charCodeAt(p))) p++
		const point = p
		digits += p - start
		if (text.charCodeAt(p) === 46) {
			p++
			while (isDigit(text.charCodeAt(p))) p++
			digits += p - point - 1
		}
		if (digits === 0) this.#fail('Invalid number', start)
		const mantissaEnd = p
		const e = text.charCodeAt(p)
		if (e === 69 || e === 101) {
			let q = p + 1
			if (text[q] === '-' || text[q] === '+') q++
			const from = q
			while (isDigit(text.charCodeAt(q))) q++
			if (q > from) p = q
		}
		// Up to 15 digits parse as written; past that Excel keeps only the first 15
		const value =
			digits <= 15
				? Number(text.slice(start, p))
				: decimalToNumber(
						text.slice(start, point),
						text.slice(point + 1, mantissaEnd),
						p > mantissaEnd ? Number(text.slice(mantissaEnd + 1, p)) : 0,
					)
		if (!Number.isFinite(value)) this.#fail('The number is too large', start)
		this.#push({kind: 'number', value, start, end: p})
		return p
	}

	#closingBracket(open: number): number {
		const {text} = this
		let depth = 0
		for (let p = open; p < text.length; p++) {
			const c = text.charCodeAt(p)
			if (c === 91) depth++
			else if (c === 93 && --depth === 0) return p + 1
			// Inside table references an apostrophe escapes the next character
			else if (c === 39) p++
		}
		return this.#fail('A bracket is missing its closing "]"', open)
	}

	// Pushes A1, $A$1, A1:B2, A:C or 1:3 at p, unless it's the start of a longer
	// word; returns where it ends, or -1
	#reference(p: number, start: number, sheet: string | undefined, unsupported: RefToken['unsupported']): number {
		const push = (form: RefToken['form'], area: Area, fixed: Fixed, end: number) => {
			if (this.#continuesWord(end)) return -1
			this.#push({kind: 'ref', sheet, unsupported, form, area, fixed, refStart: p, start, end})
			return end
		}
		let end = this.#column(p)
		if (end >= 0) {
			const col = this.#value
			const colFixed = this.#fixed
			const afterColumn = end
			end = this.#row(end)
			if (end >= 0) {
				const row = this.#value
				const rowFixed = this.#fixed
				if (this.text.charCodeAt(end) === 58) {
					let end2 = this.#column(end + 1)
					const col2 = this.#value
					const col2Fixed = this.#fixed
					if (end2 >= 0) end2 = this.#row(end2)
					if (end2 >= 0 && !this.#continuesWord(end2)) {
						return push(
							'range',
							{top: row, left: col, bottom: this.#value, right: col2},
							{top: rowFixed, left: colFixed, bottom: this.#fixed, right: col2Fixed},
							end2,
						)
					}
				}
				return push(
					'cell',
					{top: row, left: col, bottom: row, right: col},
					{top: rowFixed, left: colFixed, bottom: rowFixed, right: colFixed},
					end,
				)
			}
			if (this.text.charCodeAt(afterColumn) !== 58) return -1
			const end2 = this.#column(afterColumn + 1)
			if (end2 < 0) return -1
			return push(
				'columns',
				{top: 0, left: col, bottom: MAX_ROWS - 1, right: this.#value},
				{top: false, left: colFixed, bottom: false, right: this.#fixed},
				end2,
			)
		}
		end = this.#row(p)
		if (end < 0 || this.text.charCodeAt(end) !== 58) return -1
		const row = this.#value
		const rowFixed = this.#fixed
		const end2 = this.#row(end + 1)
		if (end2 < 0) return -1
		return push(
			'rows',
			{top: row, left: 0, bottom: this.#value, right: MAX_COLS - 1},
			{top: rowFixed, left: false, bottom: this.#fixed, right: false},
			end2,
		)
	}

	#continuesWord(p: number) {
		const c = this.text.charCodeAt(p)
		return isWordChar(c) || c === 40 || c === 36
	}

	// $?letters, A to XFD; sets #value and #fixed and returns the end, or -1
	#column(p: number): number {
		const {text} = this
		this.#fixed = text.charCodeAt(p) === 36
		if (this.#fixed) p++
		let value = 0
		let q = p
		while (isLetter(text.charCodeAt(q)) && q - p < 4) value = value * 26 + ((text.charCodeAt(q++) | 32) - 96)
		if (q === p || q - p > 3 || isLetter(text.charCodeAt(q)) || value > MAX_COLS) return -1
		this.#value = value - 1
		return q
	}

	// $?digits, 1 to 1048576
	#row(p: number): number {
		const {text} = this
		this.#fixed = text.charCodeAt(p) === 36
		if (this.#fixed) p++
		let value = 0
		let q = p
		while (isDigit(text.charCodeAt(q)) && q - p < 8) value = value * 10 + text.charCodeAt(q++) - 48
		if (q === p || isDigit(text.charCodeAt(q)) || value < 1 || value > MAX_ROWS) return -1
		this.#value = value - 1
		return q
	}
}

const normalize = ({top, left, bottom, right}: Area): Area => ({
	top: Math.min(top, bottom),
	left: Math.min(left, right),
	bottom: Math.max(top, bottom),
	right: Math.max(left, right),
})

function functionName(word: string) {
	let name = word.toUpperCase()
	while (name.startsWith('_XLFN.') || name.startsWith('_XLWS.')) name = name.slice(6)
	return name
}

const endsOperand = (token: Token | undefined) =>
	token !== undefined &&
	(token.kind === 'ref' || token.kind === 'name' || (token.kind === 'operator' && token.value === ')'))
const startsOperand = (token: Token) =>
	token.kind === 'ref' ||
	token.kind === 'name' ||
	token.kind === 'function' ||
	(token.kind === 'operator' && token.value === '(')

// Binding powers; prefix -/+ sit between ^ and %, so -2^2 is (-2)^2 = 4
const BINARY_POWER: Record<string, number> = {
	'=': 1,
	'<>': 1,
	'<': 1,
	'<=': 1,
	'>': 1,
	'>=': 1,
	'&': 2,
	'+': 3,
	'-': 3,
	'*': 4,
	'/': 4,
	'^': 5,
	' ': 8,
	':': 9,
}
const PREFIX_POWER = 6
const POSTFIX_POWER = 7

// Parses a formula (without its leading '=') into an AST, or throws FormulaSyntaxError
export function parseFormula(text: string): Ast {
	return new Parser(text).parse()
}

class Parser {
	readonly #text: string
	readonly #tokens: Token[]
	#position = 0
	#depth = 0

	constructor(text: string) {
		this.#text = text
		this.#tokens = tokenize(text)
	}

	parse(): Ast {
		if (this.#tokens.length === 0) this.#fail('The formula is empty')
		const ast = this.#expression(0)
		if (this.#position < this.#tokens.length) this.#fail('Unexpected input')
		return ast
	}

	#peek(): Token | undefined {
		return this.#tokens[this.#position]
	}

	#at(value: string, token = this.#peek()) {
		return token?.kind === 'operator' && token.value === value
	}

	#fail(message: string, token = this.#peek()): never {
		throw new FormulaSyntaxError(message, token ? token.start : this.#text.length)
	}

	#expect(value: string) {
		if (!this.#at(value)) this.#fail(`Expected "${value}"`)
		this.#position++
	}

	#expression(minPower: number): Ast {
		if (++this.#depth > MAX_DEPTH) this.#fail('The formula is nested too deeply')
		let left = this.#prefix()
		for (;;) {
			const token = this.#peek()
			if (token?.kind !== 'operator') break
			if (token.value === '%' || token.value === '#') {
				if (POSTFIX_POWER <= minPower) break
				this.#position++
				left =
					token.value === '%' ? {type: 'unary', operator: '%', operand: left} : {type: 'unsupported', reason: 'spill'}
				continue
			}
			const power = BINARY_POWER[token.value]
			if (power === undefined || power <= minPower) break
			this.#position++
			const right = this.#expression(power)
			left = {type: 'binary', operator: token.value as BinaryOperator, left, right}
		}
		this.#depth--
		return left
	}

	#prefix(): Ast {
		const token = this.#peek() ?? this.#fail('The formula ends unexpectedly')
		this.#position++
		switch (token.kind) {
			case 'number':
			case 'string':
			case 'boolean':
				return {type: token.kind, value: token.value} as Ast
			case 'error':
				return token.value ? {type: 'error', value: token.value} : {type: 'unsupported', reason: 'error'}
			case 'ref': {
				if (token.unsupported) return {type: 'unsupported', reason: token.unsupported}
				const area = normalize(token.area)
				return token.sheet === undefined ? {type: 'ref', area} : {type: 'ref', sheet: token.sheet, area}
			}
			case 'name':
				return {type: 'name', name: token.name}
			case 'unsupported':
				return {type: 'unsupported', reason: token.reason}
			case 'function':
				return this.#call(token.name)
		}
		switch (token.value) {
			case '(': {
				const first = this.#expression(0)
				if (!this.#at(',')) {
					this.#expect(')')
					return first
				}
				const areas = [first]
				while (this.#at(',')) {
					this.#position++
					areas.push(this.#expression(0))
				}
				this.#expect(')')
				return {type: 'union', areas}
			}
			case '-':
			case '+':
				return {type: 'unary', operator: token.value, operand: this.#expression(PREFIX_POWER)}
			case '@':
				this.#expression(PREFIX_POWER)
				return {type: 'unsupported', reason: 'implicit'}
			case '{':
				return this.#array()
		}
		this.#position--
		return this.#fail(`Unexpected "${token.value}"`)
	}

	#call(name: string): Ast {
		const args: Ast[] = []
		if (this.#at(')')) {
			this.#position++
			return {type: 'call', name, args}
		}
		for (;;) {
			args.push(this.#at(',') || this.#at(')') ? {type: 'missing'} : this.#expression(0))
			if (args.length > MAX_ARGUMENTS) this.#fail('Too many arguments')
			if (!this.#at(',')) break
			this.#position++
		}
		this.#expect(')')
		return {type: 'call', name, args}
	}

	// {1,2;3,4}: constants only, rows separated by semicolons
	#array(): Ast {
		const rows: Value[][] = [[]]
		for (;;) {
			let sign = 1
			if (this.#at('-') || this.#at('+')) sign = this.#at('-', this.#tokens[this.#position++]) ? -1 : 1
			const token = this.#peek() ?? this.#fail('The array is missing its closing "}"')
			this.#position++
			const row = rows[rows.length - 1]
			if (token.kind === 'number') row.push(sign * token.value + 0)
			else if (sign === 1 && (token.kind === 'string' || token.kind === 'boolean')) row.push(token.value)
			else if (sign === 1 && token.kind === 'error' && token.value) row.push(errorFromCode(token.value)!)
			else this.#fail('Arrays can only contain numbers, text, logical values and errors', token)
			if (this.#at(',')) this.#position++
			else if (this.#at(';')) {
				this.#position++
				rows.push([])
			} else {
				this.#expect('}')
				break
			}
		}
		if (rows.some((row) => row.length !== rows[0].length))
			this.#fail('Every row of an array needs the same number of values')
		return {type: 'array', rows}
	}
}

export function columnName(col: number): string {
	let name = ''
	for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name
	return name
}
