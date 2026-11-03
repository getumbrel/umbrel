// Shared by the CSV engine's tests

import type {CsvDialect, CsvEncoding} from './csv'
import {setCells, type CsvEdits} from './edits'
import {WINDOWS_1252_HIGH} from './scan'

// A corpus of real-world documents (FILES_FIXTURES=<dir>) adds them to the suite; without one, those tests skip
export const FIXTURES = process.env.FILES_FIXTURES ?? ''

export const ENCODINGS: CsvEncoding[] = ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252']

export const dialectOf = (overrides: Partial<CsvDialect> = {}): CsvDialect => ({
	encoding: 'utf-8',
	bom: false,
	delimiter: ',',
	quote: '"',
	lineEnding: '\n',
	sepLine: false,
	...overrides,
})

const WINDOWS_1252 = new Map(Array.from(WINDOWS_1252_HIGH, (char, i) => [char, 0x80 + i]))

export function encode(text: string, encoding: CsvEncoding): Uint8Array {
	if (encoding === 'utf-8') return new TextEncoder().encode(text)
	if (encoding === 'windows-1252') {
		return Uint8Array.from(text, (char) => {
			const code = char.charCodeAt(0)
			const byte = code < 0x80 || (code >= 0xa0 && code <= 0xff) ? code : WINDOWS_1252.get(char)
			if (byte === undefined) throw new Error(`windows-1252 has no ${char}`)
			return byte
		})
	}
	const bytes = new Uint8Array(text.length * 2)
	for (let i = 0; i < text.length; i++) {
		const unit = text.charCodeAt(i)
		bytes[i * 2 + (encoding === 'utf-16le' ? 0 : 1)] = unit & 0xff
		bytes[i * 2 + (encoding === 'utf-16le' ? 1 : 0)] = unit >> 8
	}
	return bytes
}

export const decodeUtf8 = (bytes: Uint8Array) => new TextDecoder('utf-8', {ignoreBOM: true}).decode(bytes)

export const setCell = (edits: CsvEdits, row: number, column: number, value: string) =>
	setCells(edits, [{row, column, value}])

// The engine's reading rules, written again independently a character at a
// time: a quote opens a field only as its first character, doubled quotes
// inside are one quote, text after the closing quote is literal, and CR, LF or
// CRLF end a row (with no row after a final line break)
export function referenceRows(text: string, delimiter: string, quote: string | null): string[][] {
	const rows: string[][] = []
	let row: string[] = []
	let cell = ''
	let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start'
	for (let i = 0; i < text.length; i++) {
		const char = text[i]
		if (state === 'quoted') {
			if (char !== quote) cell += char
			else if (text[i + 1] === quote) cell += text[i++]
			else state = 'closed'
		} else if (char === quote && state === 'start') {
			state = 'quoted'
		} else if (char === delimiter) {
			row.push(cell)
			cell = ''
			state = 'start'
		} else if (char === '\r' || char === '\n') {
			if (char === '\r' && text[i + 1] === '\n') i++
			row.push(cell)
			rows.push(row)
			row = []
			cell = ''
			state = 'start'
		} else {
			cell += char
			if (state === 'start') state = 'plain'
		}
	}
	if (state !== 'start' || row.length > 0) rows.push([...row, cell])
	return rows
}

// mulberry32: small, fast and the same everywhere
export function random(seed: number): () => number {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

export const pick = <T>(next: () => number, items: readonly T[]): T => items[Math.floor(next() * items.length)]
export const int = (next: () => number, below: number) => Math.floor(next() * below)
