import {afterEach, describe, expect, it} from 'vitest'

import {createEdits, insertRows} from './edits'
import {createCsvClient, createCsvHandler, type CsvCall, type CsvReply} from './protocol'
import {CsvEncodeError} from './serialize'
import {encode, setCell} from './test-helpers'

const bytesOf = (text: string) => new TextEncoder().encode(text).buffer

describe('createCsvHandler', () => {
	it('opens a file, reads its rows and saves edits', () => {
		const handle = createCsvHandler()
		expect(handle({id: 1, request: {type: 'open', bytes: bytesOf('a;b\n1;2\n'), name: 'x.csv'}})).toEqual({
			reply: {
				id: 1,
				result: {
					dialect: {encoding: 'utf-8', bom: false, delimiter: ';', quote: '"', lineEnding: '\n', sepLine: false},
					rowCount: 2,
					columnCount: 2,
					truncated: false,
				},
			},
			transfer: [],
		})
		expect(handle({id: 2, request: {type: 'rows', start: 1, end: 2}}).reply).toEqual({id: 2, result: [['1', '2']]})
		expect(handle({id: 3, request: {type: 'rows', start: 0, end: 2, columns: {start: 1, end: 2}}}).reply).toEqual({
			id: 3,
			result: [['b'], ['2']],
		})
		const {reply, transfer} = handle({
			id: 4,
			request: {type: 'save', edits: setCell(createEdits({rowCount: 2}), 1, 1, 'x')},
		})
		const saved = (reply as {result: ArrayBuffer}).result
		expect(new TextDecoder().decode(saved)).toBe('a;b\n1;x\n')
		expect(transfer).toEqual([saved])
	})

	it('finds text in a range of rows, ignoring case, as [row, column] pairs', () => {
		const handle = createCsvHandler()
		handle({id: 1, request: {type: 'open', bytes: bytesOf('Name,Note\nann,"Plan, then ANN"\nbo,\nAnna,x\n')}})
		const find = (query: string, start: number, end: number) =>
			handle({id: 2, request: {type: 'find', query, start, end}}).reply
		expect(find('ann', 0, 4)).toEqual({id: 2, result: [1, 0, 1, 1, 3, 0]})
		expect(find('ann', 2, 9)).toEqual({id: 2, result: [3, 0]})
		expect(find('ANN', -5, 2)).toEqual({id: 2, result: [1, 0, 1, 1]})
		expect(find('zzz', 0, 4)).toEqual({id: 2, result: []})
	})

	it('answers with an error before a file is open, or when an edit can’t be saved', () => {
		const handle = createCsvHandler()
		expect(handle({id: 1, request: {type: 'rows', start: 0, end: 1}}).reply).toMatchObject({
			id: 1,
			error: {name: 'Error', message: 'No CSV is open'},
		})
		handle({id: 2, request: {type: 'open', bytes: encode('Crème,brûlée\r\n', 'windows-1252').slice().buffer}})
		expect(
			handle({id: 3, request: {type: 'save', edits: setCell(createEdits({rowCount: 1}), 0, 1, '日本')}}).reply,
		).toEqual({
			id: 3,
			error: {
				name: 'CsvEncodeError',
				message: 'windows-1252 has no byte for "日"',
				code: 'unrepresentable',
				char: '日',
				row: 0,
				column: 1,
			},
		})
		// The file stays open after a failed save, and saving as UTF-8 works
		const {reply} = handle({
			id: 4,
			request: {
				type: 'save',
				edits: setCell(createEdits({rowCount: 1}), 0, 1, '日本'),
				target: {encoding: 'utf-8', bom: true},
			},
		})
		const saved = (reply as {result: ArrayBuffer}).result
		expect(new TextDecoder('utf-8', {ignoreBOM: true}).decode(saved)).toBe('\ufeffCrème,日本\r\n')
	})
})

// A worker stand-in: the handler at the far end of a real MessageChannel, so
// messages are structured-cloned and transferred buffers detach
function connect() {
	const {port1, port2} = new MessageChannel()
	const handle = createCsvHandler()
	port2.onmessage = ({data}: MessageEvent<CsvCall>) => {
		const {reply, transfer} = handle(data)
		port2.postMessage(reply, transfer)
	}
	const worker = new EventTarget() as unknown as Worker
	port1.onmessage = ({data}: MessageEvent<CsvReply>) => worker.dispatchEvent(new MessageEvent('message', {data}))
	let terminated = false
	Object.assign(worker, {
		postMessage: (message: CsvCall, transfer: Transferable[]) => port1.postMessage(message, transfer),
		terminate: () => (terminated = true),
	})
	const close = () => {
		port1.close()
		port2.close()
	}
	return {worker, close, terminated: () => terminated}
}

describe('createCsvClient', () => {
	const open: Array<() => void> = []
	afterEach(() => open.splice(0).forEach((close) => close()))
	const client = () => {
		const connection = connect()
		open.push(connection.close)
		return {...connection, csv: createCsvClient(connection.worker)}
	}

	it('opens, reads and saves through the worker, transferring bytes both ways', async () => {
		const {csv} = client()
		const bytes = bytesOf('name,city\nAnn,Oslo\n')
		const opened = await csv.open(bytes, 'people.csv')
		expect(bytes.byteLength).toBe(0)
		expect(opened).toMatchObject({rowCount: 2, columnCount: 2, truncated: false})
		const [first, second] = await Promise.all([csv.rows(0, 1), csv.rows(1, 2)])
		expect([first, second]).toEqual([[['name', 'city']], [['Ann', 'Oslo']]])
		const saved = await csv.save(setCell(insertRows(createEdits(opened), 2), 2, 0, 'Bo'))
		expect(new TextDecoder().decode(saved)).toBe('name,city\nAnn,Oslo\nBo,\n')
		// The saved bytes are the caller's to keep, and open again
		expect(await csv.open(saved)).toMatchObject({rowCount: 3})
		expect(await csv.rows(2, 3)).toEqual([['Bo', '']])
	})

	it('rejects with a CsvEncodeError the UI can act on', async () => {
		const {csv} = client()
		await csv.open(encode('Name\r\nCrème\r\n', 'windows-1252').slice().buffer)
		const error = await csv.save(setCell(createEdits({rowCount: 2}), 1, 0, '👋')).catch((error: unknown) => error)
		expect(error).toBeInstanceOf(CsvEncodeError)
		expect(error).toMatchObject({code: 'unrepresentable', char: '👋', row: 1, column: 0})
		await expect(csv.rows(0, 1)).resolves.toEqual([['Name']])
	})

	it('rejects waiting calls when disposed, or when the worker fails', async () => {
		const {csv, terminated} = client()
		const waiting = csv.rows(0, 1)
		csv.dispose()
		await expect(waiting).rejects.toMatchObject({name: 'AbortError'})
		expect(terminated()).toBe(true)
		await expect(csv.rows(0, 1)).rejects.toMatchObject({name: 'AbortError'})

		const other = client()
		const failing = other.csv.open(bytesOf('a'))
		other.worker.dispatchEvent(Object.assign(new Event('error'), {message: 'Failed to load the worker'}))
		await expect(failing).rejects.toThrow('Failed to load the worker')
	})
})
