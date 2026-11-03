import {Calculator, type CalculatorOptions, type CellAddress, type CellBase} from './calculator'
import type {Value} from './values'

// "B3" or "Sheet2!B3" (sheets by index in `sheets`) → a 0-based address
export function at(ref: string, sheets: string[] = ['Sheet1']): CellAddress {
	const bang = ref.lastIndexOf('!')
	const sheet = bang < 0 ? 0 : sheets.indexOf(ref.slice(0, bang).replace(/^'|'$/g, ''))
	const match = /^([A-Z]+)(\d+)$/.exec(ref.slice(bang + 1))
	if (!match || sheet < 0) throw new Error(`Bad address ${ref}`)
	let col = 0
	for (const letter of match[1]) col = col * 26 + letter.charCodeAt(0) - 64
	return {sheet, row: Number(match[2]) - 1, col: col - 1}
}

// Cells as {A1: 5, B2: '=A1*2'}: strings starting with '=' are formulas without a cached value
export type CellMap = Record<string, Value>

// Values as a workbook's sheets hold them, for a calculator to read through: in order, row by row
export function baseOf(sheetCount: number, cells: Iterable<{address: CellAddress; value: Value}>): CellBase {
	const sheets = Array.from({length: sheetCount}, () => new Map<number, Map<number, Value>>())
	let rows = 0
	let cols = 0
	for (const {address, value} of cells) {
		if (value === null) continue
		const sheet = sheets[address.sheet]
		if (!sheet.has(address.row)) sheet.set(address.row, new Map())
		sheet.get(address.row)!.set(address.col, value)
		rows = Math.max(rows, address.row + 1)
		cols = Math.max(cols, address.col + 1)
	}
	// Each sheet's cells in order, rowStarts[r] the place of row r's first
	const laid = sheets.map((sheet) => {
		const populated = [...sheet.keys()].sort((a, b) => a - b)
		const height = populated.length ? populated[populated.length - 1] + 1 : 0
		const rowStarts = new Uint32Array(height + 1)
		const columns: number[] = []
		const values: Value[] = []
		let row = 0
		for (const r of populated) {
			for (; row <= r; row++) rowStarts[row] = columns.length
			for (const [col, value] of [...sheet.get(r)!].sort(([a], [b]) => a - b)) {
				columns.push(col)
				values.push(value)
			}
		}
		rowStarts[height] = columns.length
		return {sheet, populated, rowStarts, columns, values}
	})
	return {
		rows,
		cols,
		value: (sheet, row, col) => laid[sheet].sheet.get(row)?.get(col) ?? null,
		rowStart: (sheet, row) => laid[sheet].rowStarts[Math.min(row, laid[sheet].rowStarts.length - 1)],
		columnAt: (sheet, place) => laid[sheet].columns[place],
		valueAt: (sheet, place) => laid[sheet].values[place],
		populated: (sheet) => laid[sheet].populated,
	}
}

// As the worker builds it: the formulas held, and every other value read through the sheets
export function workbook(cells: CellMap = {}, options: CalculatorOptions & {sheets?: string[]} = {}) {
	const sheets = options.sheets ?? ['Sheet1', 'Sheet2']
	const entries = Object.entries(cells).map(([ref, value]) =>
		typeof value === 'string' && value.startsWith('=')
			? {address: at(ref, sheets), value: null, formula: value.slice(1)}
			: {address: at(ref, sheets), value},
	)
	const formulas = entries.filter((entry) => 'formula' in entry)
	const base = baseOf(
		sheets.length,
		entries.filter((entry) => !('formula' in entry)),
	)
	const calculator = new Calculator(sheets, formulas, {...options, base})
	if (formulas.length) calculator.recalculate()
	return {calculator, sheets, value: (ref: string) => calculator.value(at(ref, sheets))}
}

// The value of a formula (without '=') calculated over `cells`, in a cell far from them
export function calc(
	formula: string,
	cells: CellMap = {},
	options: CalculatorOptions & {sheets?: string[]} = {},
): Value {
	const {calculator, sheets} = workbook(cells, options)
	const address = at('Z999', sheets)
	calculator.set(address, `=${formula}`)
	if (calculator.isStale(address)) return {stale: true} as never
	return calculator.value(address)
}
