// The CSV worker's message protocol, imported by both sides. The UI opens a
// file by transferring its bytes, reads rows by their index in the file
// (laying its own CsvEdits over them), finds text the same way, and saves by
// sending the edits; the worker transfers the new bytes back. Only requested
// rows cross the boundary.

import {createWorkerClient} from '../worker-client'
import {indexCsv, readRows, sniffCsv, type CsvDialect, type CsvIndex} from './csv'
import type {CsvEdits} from './edits'
import {CsvEncodeError, serializeCsv, type CsvEncodeErrorCode} from './serialize'

export type CsvTarget = Pick<CsvDialect, 'encoding' | 'bom'>

export type CsvRequest =
	| {type: 'open'; bytes: ArrayBuffer; name?: string}
	| {type: 'rows'; start: number; end: number; columns?: {start: number; end: number}}
	// The cells of rows [start, end) whose text contains `query`, ignoring case
	| {type: 'find'; query: string; start: number; end: number}
	| {type: 'save'; edits: CsvEdits; target?: CsvTarget}

export type CsvOpened = {dialect: CsvDialect; rowCount: number; columnCount: number; truncated: boolean}

export type CsvCall = {id: number; request: CsvRequest}
export type CsvErrorData = {
	name: string
	message: string
	code?: CsvEncodeErrorCode
	char?: string
	row?: number
	column?: number
}
// A find's matches as [row, column] pairs, in file order
export type CsvMatches = number[]
export type CsvReply =
	| {id: number; result: CsvOpened | string[][] | CsvMatches | ArrayBuffer}
	| {id: number; error: CsvErrorData}

// The worker side: one open file, replaced by each 'open'
export function createCsvHandler(): (call: CsvCall) => {reply: CsvReply; transfer: Transferable[]} {
	let file: {bytes: Uint8Array; dialect: CsvDialect; index: CsvIndex} | undefined
	const opened = () => {
		if (!file) throw new Error('No CSV is open')
		return file
	}
	return ({id, request}) => {
		try {
			if (request.type === 'open') {
				const bytes = new Uint8Array(request.bytes)
				const dialect = sniffCsv(bytes, request.name)
				const index = indexCsv(bytes, dialect)
				file = {bytes, dialect, index}
				const {rowCount, columnCount, truncated} = index
				return {reply: {id, result: {dialect, rowCount, columnCount, truncated}}, transfer: []}
			}
			const {bytes, dialect, index} = opened()
			if (request.type === 'rows') {
				return {
					reply: {id, result: readRows(bytes, dialect, index, request.start, request.end, request.columns)},
					transfer: [],
				}
			}
			if (request.type === 'find') {
				const query = request.query.toLowerCase()
				const start = Math.max(0, request.start)
				const matches: CsvMatches = []
				readRows(bytes, dialect, index, start, request.end).forEach((cells, i) =>
					cells.forEach((text, column) => {
						if (text.toLowerCase().includes(query)) matches.push(start + i, column)
					}),
				)
				return {reply: {id, result: matches}, transfer: []}
			}
			const saved = serializeCsv(bytes, dialect, index, request.edits, request.target).buffer
			return {reply: {id, result: saved}, transfer: [saved]}
		} catch (error) {
			const failure: Error & Partial<CsvEncodeError> = error instanceof Error ? error : new Error(String(error))
			const {name, message, code, char, row, column} = failure
			return {reply: {id, error: {name, message, code, char, row, column}}, transfer: []}
		}
	}
}

export type CsvClient = {
	// Transfers `bytes`: the caller's buffer is detached afterwards
	open(bytes: ArrayBuffer, name?: string): Promise<CsvOpened>
	rows(start: number, end: number, columns?: {start: number; end: number}): Promise<string[][]>
	find(query: string, start: number, end: number): Promise<CsvMatches>
	// Rejects with CsvEncodeError when the target encoding can't hold an edit
	save(edits: CsvEdits, target?: CsvTarget): Promise<ArrayBuffer>
	// Terminates the worker; calls still waiting reject
	dispose(): void
}

// The UI side, over a worker running csv.worker.ts
export function createCsvClient(worker: Worker): CsvClient {
	const {call, dispose} = createWorkerClient<CsvRequest, CsvErrorData>(worker, toError)
	return {
		open: (bytes, name) => call({type: 'open', bytes, name}, [bytes]),
		rows: (start, end, columns) => call({type: 'rows', start, end, columns}),
		find: (query, start, end) => call({type: 'find', query, start, end}),
		save: (edits, target) => call({type: 'save', edits, target}),
		dispose,
	}
}

function toError({name, message, code, char, row, column}: CsvErrorData): Error {
	if (name === 'CsvEncodeError' && code) return new CsvEncodeError(code, message, {char, row, column})
	const error = new Error(message)
	error.name = name
	return error
}
