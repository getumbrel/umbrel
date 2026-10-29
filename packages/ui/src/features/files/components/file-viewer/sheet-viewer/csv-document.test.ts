import {expect, test, vi} from 'vitest'

import {CsvDocument} from './csv-document'
import {createCsvClient, createCsvHandler, type CsvCall} from './engine/csv/protocol'

// Counted: the size of the edited grid walks every edited cell
const sized = vi.hoisted(() => ({count: 0}))
vi.mock('./engine/csv/edits', async (importOriginal) => {
	const edits = await importOriginal<typeof import('./engine/csv/edits')>()
	return {
		...edits,
		editedSize: (...args: Parameters<typeof edits.editedSize>) => {
			sized.count++
			return edits.editedSize(...args)
		},
	}
})
vi.mock('./fonts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	measure: (_font: string, text: string) => text.length * 7,
}))

// An editable document over the worker's handler, called in place of a worker
async function open(text: string) {
	const handle = createCsvHandler()
	const worker = Object.assign(new EventTarget(), {
		postMessage: async (call: CsvCall) => {
			await null
			worker.dispatchEvent(new MessageEvent('message', {data: handle(call).reply}))
		},
		terminate: () => {},
	})
	const bytes = new TextEncoder().encode(text).buffer
	const doc = await CsvDocument.open(createCsvClient(worker as unknown as Worker), bytes, 'x.csv', 'text/csv')
	doc.setEditable(true)
	return doc
}

test('rows inserted below the empty row under the table go at its end', async () => {
	const doc = await open('a,b\n1,2\n')
	doc.insertRows(doc.rowCount + 1, 2)
	expect([doc.rowCount, doc.dirty]).toEqual([4, true])
})

test('the edited grid’s size is worked out once per edit, however often it’s read', async () => {
	const doc = await open('a,b\n1,2\n')
	await doc.commit([{row: 2, col: 0, input: 'x'}])
	const once = sized.count
	for (let i = 0; i < 10; i++) void [doc.rowCount, doc.colCount]
	expect([sized.count - once, doc.rowCount, doc.colCount]).toEqual([0, 3, 2])
})
