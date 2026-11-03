// Edits to a CSV as a sparse overlay on the original file. The edited grid's
// rows and columns are ordered runs of keys: an original row or column's index
// in the file, or a negative key for one inserted since. Cells are keyed by
// those stable keys, so inserting or deleting never renumbers them, and a
// structural edit costs O(runs), not O(rows). Every operation returns a new
// object sharing what it didn't change, so undo is keeping the old one. All
// positions are in the edited grid.

import type {CsvIndex} from './csv'

export type CsvRun = {key: number; count: number}

export type CsvEdits = {
	rows: readonly CsvRun[]
	columns: readonly CsvRun[] // ends with an open run (count Infinity) covering every column after it
	cells: ReadonlyMap<number, ReadonlyMap<number, string>> // row key → column key → text
	nextKey: number // the next unused key for an inserted row or column
}

export function createEdits(index: Pick<CsvIndex, 'rowCount'>): CsvEdits {
	return {
		rows: index.rowCount > 0 ? [{key: 0, count: index.rowCount}] : [],
		columns: [{key: 0, count: Infinity}],
		cells: new Map(),
		nextKey: -1,
	}
}

const inserted = (key: number) => key < 0

// Keys inside a run count up from an original key and down from an inserted one
const keyAt = (run: CsvRun, offset: number) => (inserted(run.key) ? run.key - offset : run.key + offset)

const lengthOf = (runs: readonly CsvRun[]) => runs.reduce((length, run) => length + run.count, 0)

// The runs covering positions [from, to)
function cut(runs: readonly CsvRun[], from: number, to: number): CsvRun[] {
	const out: CsvRun[] = []
	let position = 0
	for (const run of runs) {
		const start = Math.max(from, position)
		const end = Math.min(to, position + run.count)
		if (start < end) out.push({key: keyAt(run, start - position), count: end - start})
		position += run.count
		if (position >= to) break
	}
	return out
}

// Joins runs whose keys continue each other, so undoing a split by hand leaves no trace
function merge(runs: CsvRun[]): CsvRun[] {
	const out: CsvRun[] = []
	for (const run of runs) {
		const last = out.at(-1)
		if (last && inserted(last.key) === inserted(run.key) && keyAt(last, last.count) === run.key) {
			out[out.length - 1] = {key: last.key, count: last.count + run.count}
		} else {
			out.push(run)
		}
	}
	return out
}

function checkPosition(name: string, value: number, limit: number) {
	if (!Number.isInteger(value) || value < 0 || value > limit) {
		throw new RangeError(`${name} ${value} is outside 0…${limit}`)
	}
}

// Keys at positions [start, end): an original row or column's index, or a
// negative key for an inserted one (whose cells are all in `cells`)
export function keysOf(runs: readonly CsvRun[], start: number, end: number): number[] {
	const keys: number[] = []
	for (const run of cut(runs, start, end)) for (let i = 0; i < run.count; i++) keys.push(keyAt(run, i))
	return keys
}

// The position of a key, or -1 once it's deleted
export function positionOf(runs: readonly CsvRun[], key: number): number {
	let position = 0
	for (const run of runs) {
		const offset = inserted(key) ? run.key - key : key - run.key
		if (inserted(run.key) === inserted(key) && offset >= 0 && offset < run.count) return position + offset
		position += run.count
	}
	return -1
}

// Columns the file's rows span, after inserts and deletes: up to the last
// inserted column or the last original one within the file's width
export function structuralWidth(columns: readonly CsvRun[], columnCount: number): number {
	let position = 0
	let width = 0
	for (const run of columns) {
		const span = inserted(run.key) ? run.count : Math.max(0, Math.min(run.count, columnCount - run.key))
		if (span > 0) width = position + span
		position += run.count
	}
	return width
}

// The edited grid's size; cells typed past the last column widen it
export function editedSize(
	edits: CsvEdits,
	index: Pick<CsvIndex, 'columnCount'>,
): {rowCount: number; columnCount: number} {
	let columnCount = structuralWidth(edits.columns, index.columnCount)
	for (const cells of edits.cells.values()) {
		for (const key of cells.keys()) columnCount = Math.max(columnCount, positionOf(edits.columns, key) + 1)
	}
	return {rowCount: lengthOf(edits.rows), columnCount}
}

export function setCells(edits: CsvEdits, changes: Iterable<{row: number; column: number; value: string}>): CsvEdits {
	const rowCount = lengthOf(edits.rows)
	let cells: Map<number, Map<number, string>> | undefined
	const copied = new Set<number>()
	for (const {row, column, value} of changes) {
		checkPosition('Row', row, rowCount - 1)
		checkPosition('Column', column, Number.MAX_SAFE_INTEGER)
		const rowKey = keysOf(edits.rows, row, row + 1)[0]
		const columnKey = keysOf(edits.columns, column, column + 1)[0]
		cells ??= new Map(edits.cells as Map<number, Map<number, string>>)
		if (!copied.has(rowKey)) {
			cells.set(rowKey, new Map(cells.get(rowKey)))
			copied.add(rowKey)
		}
		cells.get(rowKey)!.set(columnKey, value)
	}
	return cells ? {...edits, cells} : edits
}

export function insertRows(edits: CsvEdits, at: number, count = 1): CsvEdits {
	checkPosition('Row', at, lengthOf(edits.rows))
	if (count < 1) return edits
	const rows = merge([...cut(edits.rows, 0, at), {key: edits.nextKey, count}, ...cut(edits.rows, at, Infinity)])
	return {...edits, rows, nextKey: edits.nextKey - count}
}

export function deleteRows(edits: CsvEdits, at: number, count = 1): CsvEdits {
	const rowCount = lengthOf(edits.rows)
	checkPosition('Row', at, rowCount - 1)
	if (count < 1) return edits
	const removed = cut(edits.rows, at, at + count)
	const rows = merge([...cut(edits.rows, 0, at), ...cut(edits.rows, at + count, Infinity)])
	const cells = new Map([...edits.cells].filter(([key]) => positionOf(removed, key) < 0))
	return {...edits, rows, cells}
}

export function insertColumns(edits: CsvEdits, at: number, count = 1): CsvEdits {
	checkPosition('Column', at, Number.MAX_SAFE_INTEGER)
	if (count < 1) return edits
	const columns = merge([
		...cut(edits.columns, 0, at),
		{key: edits.nextKey, count},
		...cut(edits.columns, at, Infinity),
	])
	return {...edits, columns, nextKey: edits.nextKey - count}
}

export function deleteColumns(edits: CsvEdits, at: number, count = 1): CsvEdits {
	checkPosition('Column', at, Number.MAX_SAFE_INTEGER)
	if (count < 1) return edits
	const removed = cut(edits.columns, at, at + count)
	const columns = merge([...cut(edits.columns, 0, at), ...cut(edits.columns, at + count, Infinity)])
	const cells = new Map<number, ReadonlyMap<number, string>>()
	for (const [rowKey, rowCells] of edits.cells) {
		const kept = new Map([...rowCells].filter(([key]) => positionOf(removed, key) < 0))
		if (kept.size) cells.set(rowKey, kept)
	}
	return {...edits, columns, cells}
}
