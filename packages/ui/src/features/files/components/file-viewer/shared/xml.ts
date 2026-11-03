// A small XML tokenizer and tree builder for OOXML parts. There's no DOM in a
// worker, and DOMParser would lose the source offsets we need to splice edits
// back into the original text. Untrusted input is safe by construction:
// DOCTYPE (and with it every entity expansion) is rejected, scanning is a
// single linear pass, and the tree builder caps depth and node count.

export type XmlErrorCode = 'malformed' | 'doctype' | 'limits'

export class XmlError extends Error {
	readonly code: XmlErrorCode
	readonly offset: number

	constructor(code: XmlErrorCode, message: string, offset: number) {
		super(`${message} (at ${offset})`)
		this.name = 'XmlError'
		this.code = code
		this.offset = offset
	}
}

// [start, end) is the token's span in the source: the whole tag, or the raw text (entities still encoded)
export type XmlEvent =
	| {type: 'open'; name: string; attributes: Record<string, string>; selfClosing: boolean; start: number; end: number}
	| {type: 'close'; name: string; start: number; end: number}
	| {type: 'text'; text: string; start: number; end: number}

// [start, end) spans the element from its open tag through its close tag, [contentStart, contentEnd) what's between
// them; a self-closing element's content is empty at its end
export type XmlElement = {
	name: string
	local: string
	attributes: Record<string, string>
	children: XmlNode[]
	start: number
	end: number
	contentStart: number
	contentEnd: number
}
export type XmlText = {text: string; start: number; end: number}
export type XmlNode = XmlElement | XmlText

const TAB = 9
const LF = 10
const CR = 13
const SPACE = 32
const DOUBLE_QUOTE = 34
const HASH = 35
const AMPERSAND = 38
const SINGLE_QUOTE = 39
const SLASH = 47
const LESS = 60
const EQUALS = 61
const GREATER = 62
const QUESTION = 63
const BANG = 33
const LOWER_X = 120
const BOM = 0xfeff

const isSpace = (c: number) => c === SPACE || c === LF || c === TAB || c === CR
// Names run until whitespace or the punctuation that can follow them
const NAME_END = new Uint8Array(128)
for (const c of [SPACE, LF, TAB, CR, SLASH, GREATER, EQUALS, DOUBLE_QUOTE, SINGLE_QUOTE, LESS]) NAME_END[c] = 1
const isNameEnd = (c: number) => c < 128 && NAME_END[c] === 1

// Streams the document's tokens to `onEvent` (return false to stop). Comments, processing instructions and the
// prolog's whitespace produce no events. Throws XmlError on anything that isn't well-formed: unbalanced tags, a
// second root, stray text, bad references, duplicate attributes.
export function tokenizeXml(text: string, onEvent: (event: XmlEvent) => void | false): void {
	const length = text.length
	const open: string[] = []
	let rooted = false
	let pos = text.charCodeAt(0) === BOM ? 1 : 0
	while (pos < length) {
		// Tags usually follow each other directly, which saves the search
		const lt = text.charCodeAt(pos) === LESS ? pos : text.indexOf('<', pos)
		const textEnd = lt < 0 ? length : lt
		if (textEnd > pos) {
			if (open.length) {
				if (onEvent({type: 'text', text: decodeText(text, pos, textEnd), start: pos, end: textEnd}) === false) return
			} else {
				for (let i = pos; i < textEnd; i++) {
					if (!isSpace(text.charCodeAt(i))) throw new XmlError('malformed', 'Text outside the root element', i)
				}
			}
		}
		if (lt < 0) break
		const next = text.charCodeAt(lt + 1)

		if (next === SLASH) {
			// The name must repeat the open tag's exactly, so compare in place instead of slicing it out
			const name = open.pop()
			const nameEnd = lt + 2 + (name?.length ?? 0)
			if (name === undefined || !text.startsWith(name, lt + 2) || !isNameEnd(text.charCodeAt(nameEnd))) {
				throw new XmlError('malformed', name ? `Expected </${name}>` : 'Unexpected close tag', lt)
			}
			let p = nameEnd
			while (isSpace(text.charCodeAt(p))) p++
			if (text.charCodeAt(p) !== GREATER) throw new XmlError('malformed', `Malformed </${name}>`, p)
			if (onEvent({type: 'close', name, start: lt, end: p + 1}) === false) return
			pos = p + 1
		} else if (next === BANG) {
			if (text.startsWith('!--', lt + 1)) {
				const end = text.indexOf('-->', lt + 4)
				if (end < 0) throw new XmlError('malformed', 'Unterminated comment', lt)
				pos = end + 3
			} else if (text.startsWith('![CDATA[', lt + 1)) {
				const end = text.indexOf(']]>', lt + 9)
				if (end < 0) throw new XmlError('malformed', 'Unterminated CDATA section', lt)
				if (!open.length) throw new XmlError('malformed', 'CDATA outside the root element', lt)
				const data = text.slice(lt + 9, end).replace(NEWLINES, '\n')
				if (onEvent({type: 'text', text: data, start: lt, end: end + 3}) === false) return
				pos = end + 3
			} else if (text.startsWith('!DOCTYPE', lt + 1)) {
				throw new XmlError('doctype', 'DOCTYPE is not allowed', lt)
			} else {
				throw new XmlError('malformed', 'Unexpected markup declaration', lt)
			}
		} else if (next === QUESTION) {
			const end = text.indexOf('?>', lt + 2)
			if (end < 0) throw new XmlError('malformed', 'Unterminated processing instruction', lt)
			pos = end + 2
		} else {
			let p = lt + 1
			while (p < length && !isNameEnd(text.charCodeAt(p))) p++
			if (p === lt + 1) throw new XmlError('malformed', 'Expected a tag name', lt)
			const name = text.slice(lt + 1, p)
			const attributes: Record<string, string> = {}
			let selfClosing = false
			for (;;) {
				const spaceStart = p
				while (isSpace(text.charCodeAt(p))) p++
				const c = text.charCodeAt(p)
				if (c === GREATER) {
					p++
					break
				}
				if (c === SLASH && text.charCodeAt(p + 1) === GREATER) {
					selfClosing = true
					p += 2
					break
				}
				// Attributes need whitespace before them; running off the end means the tag never closed
				if (p === spaceStart || p >= length) throw new XmlError('malformed', `Malformed <${name}>`, p)
				const keyStart = p
				while (p < length && !isNameEnd(text.charCodeAt(p))) p++
				const key = text.slice(keyStart, p)
				while (isSpace(text.charCodeAt(p))) p++
				if (!key || text.charCodeAt(p) !== EQUALS) {
					throw new XmlError('malformed', `Malformed attribute in <${name}>`, p)
				}
				p++
				while (isSpace(text.charCodeAt(p))) p++
				const quote = text.charCodeAt(p)
				if (quote !== DOUBLE_QUOTE && quote !== SINGLE_QUOTE) {
					throw new XmlError('malformed', `Unquoted attribute ${key} in <${name}>`, p)
				}
				// One scan finds the closing quote and whether the value needs decoding at all
				const valueStart = p + 1
				let plain = true
				for (p = valueStart; ; p++) {
					const v = text.charCodeAt(p)
					if (v === quote) break
					if (p >= length) throw new XmlError('malformed', `Unterminated attribute ${key} in <${name}>`, valueStart)
					if (v === AMPERSAND || v <= CR) plain = false
				}
				if (Object.hasOwn(attributes, key)) throw new XmlError('malformed', `Duplicate attribute ${key}`, keyStart)
				const raw = text.slice(valueStart, p)
				const value = plain ? raw : decode(raw, valueStart, true)
				// Assigning __proto__ would hit the prototype setter and vanish; define it as the plain attribute it is
				if (key === '__proto__') {
					Object.defineProperty(attributes, key, {value, enumerable: true, writable: true, configurable: true})
				} else {
					attributes[key] = value
				}
				p++
			}
			if (!open.length) {
				if (rooted) throw new XmlError('malformed', 'More than one root element', lt)
				rooted = true
			}
			if (!selfClosing) open.push(name)
			if (onEvent({type: 'open', name, attributes, selfClosing, start: lt, end: p}) === false) return
			pos = p
		}
	}
	if (open.length) throw new XmlError('malformed', `Unclosed <${open[open.length - 1]}>`, length)
	if (!rooted) throw new XmlError('malformed', 'No root element', length)
}

const MAX_DEPTH = 256
const MAX_NODES = 5_000_000

// Builds the element tree, keeping every text node verbatim: whitespace can matter (an <a:t> holding one space, an
// xml:space="preserve" run), so what to ignore is left to the caller.
export function parseXml(text: string): XmlElement {
	const stack: XmlElement[] = []
	let root: XmlElement | undefined
	let nodes = 0
	tokenizeXml(text, (event) => {
		if (event.type === 'close') {
			const element = stack.pop()!
			element.contentEnd = event.start
			element.end = event.end
			return
		}
		if (++nodes > MAX_NODES) throw new XmlError('limits', `More than ${MAX_NODES} nodes`, event.start)
		const parent = stack[stack.length - 1]
		if (event.type === 'text') {
			parent.children.push({text: event.text, start: event.start, end: event.end})
			return
		}
		if (stack.length >= MAX_DEPTH) throw new XmlError('limits', `Nested deeper than ${MAX_DEPTH}`, event.start)
		const {name, attributes, start, end} = event
		const colon = name.indexOf(':')
		const local = colon < 0 ? name : name.slice(colon + 1)
		const element: XmlElement = {name, local, attributes, children: [], start, end, contentStart: end, contentEnd: end}
		if (parent) parent.children.push(element)
		else root = element
		if (!event.selfClosing) stack.push(element)
	})
	return root!
}

export function child(element: XmlElement, local: string): XmlElement | undefined {
	for (const node of element.children) if ('local' in node && node.local === local) return node
	return undefined
}

// Child elements, all of them or those with this local name
export function children(element: XmlElement, local?: string): XmlElement[] {
	return element.children.filter(
		(node): node is XmlElement => 'local' in node && (local === undefined || node.local === local),
	)
}

// The attribute named exactly `name`, else one whose local part is `name` whatever its prefix (`attr(el, 'val')`
// finds w:val). Exact wins, so `id` and `r:id` on one element stay distinct; namespace declarations never match.
export function attr(element: XmlElement, name: string): string | undefined {
	const {attributes} = element
	if (Object.hasOwn(attributes, name)) return attributes[name]
	for (const key in attributes) {
		const colon = key.indexOf(':')
		if (colon >= 0 && key.length - colon - 1 === name.length && key.endsWith(name) && !key.startsWith('xmlns:')) {
			return attributes[key]
		}
	}
	return undefined
}

export function textContent(node: XmlNode): string {
	if ('text' in node) return node.text
	let text = ''
	for (const child of node.children) text += textContent(child)
	return text
}

// Text ready to splice between tags: markup escaped, CR kept as a reference (a literal one would be normalised to
// LF on the next read), and the characters XML 1.0 can't carry at all (most C0 controls, lone surrogates, U+FFFE/F)
// dropped rather than writing a part Office refuses to open.
export function escapeXmlText(text: string): string {
	return text.replace(UNSAFE_TEXT, (c) => ESCAPES.get(c) ?? '')
}

const UNSAFE_TEXT = /[&<>\r]|[^\t\n\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu
const ESCAPES = new Map([
	['&', '&amp;'],
	['<', '&lt;'],
	['>', '&gt;'],
	['\r', '&#13;'],
])

const NEWLINES = /\r\n?/g
const ENTITIES = new Map([
	['lt', '<'],
	['gt', '>'],
	['amp', '&'],
	['quot', '"'],
	['apos', "'"],
])
const DECIMAL = /^[0-9]+$/
const HEXADECIMAL = /^[0-9a-fA-F]+$/

function decodeText(text: string, start: number, end: number): string {
	for (let i = start; i < end; i++) {
		const c = text.charCodeAt(i)
		if (c === AMPERSAND || c === CR) return decode(text.slice(start, end), start, false)
	}
	return text.slice(start, end)
}

// One pass that applies XML's end-of-line handling (CRLF and CR read as LF), attribute-value normalisation (literal
// whitespace reads as a space) and the five predefined entities plus character references — in that order, so a
// referenced CR or tab survives as itself. Anything else after `&` is an error: there's no DTD to define it.
function decode(raw: string, offset: number, attribute: boolean): string {
	let out = ''
	let last = 0
	for (let i = 0; i < raw.length; i++) {
		const c = raw.charCodeAt(i)
		if (c === AMPERSAND) {
			const semicolon = raw.indexOf(';', i + 1)
			const reference = semicolon < 0 ? '' : raw.slice(i + 1, semicolon)
			const value = resolveReference(reference)
			if (value === undefined) throw new XmlError('malformed', 'Invalid entity or character reference', offset + i)
			out += raw.slice(last, i) + value
			i = semicolon
			last = i + 1
		} else if (c === CR || (attribute && (c === LF || c === TAB))) {
			out += raw.slice(last, i) + (attribute ? ' ' : '\n')
			if (c === CR && raw.charCodeAt(i + 1) === LF) i++
			last = i + 1
		}
	}
	return out + raw.slice(last)
}

function resolveReference(reference: string): string | undefined {
	if (reference.charCodeAt(0) !== HASH) return ENTITIES.get(reference)
	const hex = reference.charCodeAt(1) === LOWER_X
	const digits = reference.slice(hex ? 2 : 1)
	if (!(hex ? HEXADECIMAL : DECIMAL).test(digits)) return undefined
	const code = parseInt(digits, hex ? 16 : 10)
	// NUL, surrogates and anything past Unicode can't be a character
	if (code === 0 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) return undefined
	return String.fromCodePoint(code)
}
