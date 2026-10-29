import {expect, test, vi} from 'vitest'

import {createXlsxClient, createXlsxHandler, type XlsxCall} from './engine/xlsx/protocol'
import {relationships, styleSheet, workbook, worksheet} from './engine/xlsx/test-helpers'
import {XlsxDocument} from './xlsx-document'

// A document over the worker's handler, called in place of a worker
async function open(bytes: Uint8Array) {
	const handle = createXlsxHandler()
	const worker = Object.assign(new EventTarget(), {
		postMessage: async (call: XlsxCall) =>
			worker.dispatchEvent(new MessageEvent('message', {data: (await handle(call)).reply})),
		terminate: () => {},
	})
	return XlsxDocument.open(createXlsxClient(worker as unknown as Worker), bytes.slice().buffer, 1_000_000, 'xlsx')
}

test('says why a cell can’t be edited on its own', async () => {
	const doc = await open(
		await workbook({
			sheets: [
				{
					xml: worksheet(
						'<row r="1"><c r="A1"><f t="array" ref="A1:A2">B1:B2*2</f><v>2</v></c><c r="D1" t="inlineStr"><is><t>Name</t></is></c></row>' +
							'<row r="2"><c r="A2"><v>4</v></c><c r="D2" t="inlineStr"><is><t>Ann</t></is></c></row>',
					),
					rels: relationships(['rId1', 'table', '../tables/table1.xml']),
				},
			],
			extra: {
				'xl/tables/table1.xml':
					'<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="T" displayName="T" ref="D1:D2"/>',
			},
		}),
	)
	expect([doc.locked(0, 0), doc.locked(1, 0), doc.locked(0, 3), doc.locked(1, 3), doc.locked(9, 9)]).toEqual([
		undefined,
		'array',
		'table',
		undefined,
		undefined,
	])

	// On a protected sheet: A1's format and column C's style unlock them, and everything else is locked
	const locked = await open(
		await workbook({
			styles: styleSheet('<cellXfs count="2"><xf/><xf><protection locked="0"/></xf></cellXfs>'),
			sheets: [
				worksheet('<row r="1"><c r="A1" s="1"><v>1</v></c><c r="B1"><v>2</v></c></row>', {
					before: '<cols><col min="3" max="3" width="9" style="1"/></cols>',
					after: '<sheetProtection sheet="1"/>',
				}),
			],
		}),
	)
	expect([locked.locked(0, 0), locked.locked(0, 1), locked.locked(0, 2), locked.locked(5, 3)]).toEqual([
		undefined,
		'protected',
		undefined,
		'protected',
	])
})

test('an edit made after undoing past a save is unsaved, also while the save uploads', async () => {
	const doc = await open(await workbook({sheets: [worksheet('')]}))
	await doc.commit([{row: 0, col: 0, input: 'x'}], true)
	await doc.commit([{row: 1, col: 0, input: 'y'}], true)
	await doc.serialize()
	doc.saved()
	expect(doc.dirty).toBe(false)
	await doc.undo()
	await doc.commit([{row: 2, col: 0, input: 'z'}], true)
	expect(doc.dirty).toBe(true)
	await doc.serialize()
	await doc.undo()
	await doc.commit([{row: 3, col: 0, input: 'w'}], true)
	doc.saved()
	expect(doc.dirty).toBe(true)
})

test('clearing cells tells the viewer', async () => {
	const doc = await open(await workbook({sheets: [worksheet('<row r="1"><c r="A1"><v>1</v></c></row>')]}))
	const heard = vi.fn()
	doc.subscribe(heard)
	await doc.clear({top: 0, left: 0, bottom: 0, right: 0})
	expect(heard).toHaveBeenCalled()
	expect([doc.dirty, doc.canUndo]).toEqual([true, true])
})

test('an edit is unsaved from the moment it’s asked for, until the worker finds it changed nothing', async () => {
	const doc = await open(await workbook({sheets: [worksheet('<row r="1"><c r="A1"><v>1</v></c></row>')]}))
	const typing = doc.commit([{row: 1, col: 0, input: 'typed'}], true)
	expect(doc.dirty).toBe(true)
	await typing
	await doc.serialize()
	doc.saved()
	const clearing = doc.clear({top: 0, left: 0, bottom: 0, right: 0})
	expect(doc.dirty).toBe(true)
	await clearing
	await doc.serialize()
	doc.saved()
	const clearingNothing = doc.clear({top: 5, left: 5, bottom: 5, right: 5})
	expect(doc.dirty).toBe(true)
	await clearingNothing
	expect(doc.dirty).toBe(false)
})

test('a value typed over a locked cell isn’t shown there while the worker passes over it', async () => {
	const doc = await open(
		await workbook({
			sheets: [worksheet('<row r="1"><c r="A1"><v>1</v></c></row>', {after: '<sheetProtection sheet="1"/>'})],
		}),
	)
	const pasting = doc.commit([{row: 0, col: 0, input: 'x'}], false)
	expect(doc.source.cell(0, 0)?.text).toBe('1')
	await pasting
	expect(doc.source.cell(0, 0)?.text).toBe('1')
})

test('a date typed into a General cell shows as a date', async () => {
	const doc = await open(
		await workbook({styles: styleSheet('<cellXfs count="1"><xf/></cellXfs>'), sheets: [worksheet('')]}),
	)
	await doc.commit([{row: 0, col: 0, input: '2026-10-13'}], true)
	const cell = doc.source.cell(0, 0)!
	expect([cell.text, doc.opened.styles[cell.style!].format]).toEqual(['10/13/2026', 'm/d/yyyy'])
})

test('a copy past what’s loaded reads the range’s text from the worker in one go, after edits on their way', async () => {
	const handle = createXlsxHandler()
	const asked: string[] = []
	const worker = Object.assign(new EventTarget(), {
		postMessage: async (call: XlsxCall) => {
			asked.push(call.request.type)
			worker.dispatchEvent(new MessageEvent('message', {data: (await handle(call)).reply}))
		},
		terminate: () => {},
	})
	const rows = Array.from({length: 300}, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join('')
	const bytes = (await workbook({sheets: [worksheet(rows)]})).slice().buffer
	const doc = await XlsxDocument.open(createXlsxClient(worker as unknown as Worker), bytes, 1_000_000, 'xlsx')
	asked.length = 0
	void doc.commit([{row: 299, col: 0, input: 'last'}], true)
	const texts = await doc.fetchTexts({top: 0, left: 0, bottom: 299, right: 1})
	expect(asked).toEqual(['edit', 'texts'])
	expect([texts.length, texts[0], texts[299]]).toEqual([300, ['0', ''], ['last', '']])
})

test('the sheet left is let go in the worker too, before the next is read', async () => {
	const handle = createXlsxHandler()
	const asked: string[] = []
	const worker = Object.assign(new EventTarget(), {
		postMessage: async (call: XlsxCall) => {
			asked.push(call.request.type === 'release' ? `release ${call.request.sheet}` : call.request.type)
			worker.dispatchEvent(new MessageEvent('message', {data: (await handle(call)).reply}))
		},
		terminate: () => {},
	})
	const bytes = (await workbook({sheets: [worksheet(''), worksheet('')]})).slice().buffer
	const doc = await XlsxDocument.open(createXlsxClient(worker as unknown as Worker), bytes, 1_000_000, 'xlsx')
	await doc.select(1)
	expect(asked.slice(asked.indexOf('release 0'))).toEqual(['release 0', 'sheet'])
})
