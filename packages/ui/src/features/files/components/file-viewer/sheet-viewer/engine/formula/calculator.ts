// The workbook as the calculator holds it: values and formulas per cell, an
// index from every cell to the formulas that read it, and recalculation of
// exactly the formulas downstream of an edit, in dependency order. Over a base
// (the file's sheets) it needs to be given only the formula cells: it reads
// every other value through the base, and holds what edits change.

import {bind, evaluateFormula, type NameTarget, type Node} from './evaluate'
import {MAX_COLS, MAX_ROWS, parseFormula, tokenize} from './parser'
import {Areas, CalcLimitError, isMatrix, Ref, type Context, type Result} from './runtime'
import {
	errorFromCode,
	Errors,
	isError,
	MAX_TEXT,
	parseNumber,
	type FormulaError,
	type InputKind,
	type Value,
} from './values'

export type CellAddress = {sheet: number; row: number; col: number} // 0-based
export type CellChange = {address: CellAddress; value: Value}
export type CalculatorOptions = {
	date1904?: boolean
	now?: () => Date
	// Workbook-scoped defined names: name → definition without '=' ("Lookup!$A$2:$C$9", "0.2").
	// Constants and absolute references are supported; formulas using any other name are stale.
	names?: ReadonlyMap<string, string>
	// Sheet-scoped defined names by sheet index, in the same form: on their sheet they win over the
	// workbook's of the same name
	localNames?: ReadonlyMap<number, ReadonlyMap<string, string>>
	// How long one recalculation may run, in ms, before the formulas it hasn't reached are left
	// stale with their cached values: a workbook built to be slow can't hold the thread
	timeLimit?: number
	// Where the values of cells it doesn't hold are read
	base?: CellBase
}

// The values a calculator reads but doesn't hold: a workbook's, as its sheets hold them
export type CellBase = {
	// One past the last row and column holding a value, on any sheet
	readonly rows: number
	readonly cols: number
	value(sheet: number, row: number, col: number): Value
	// A sheet's cells in order: a row's are those from rowStart(row) to rowStart(row + 1), each with its column and
	// value at that place
	rowStart(sheet: number, row: number): number
	columnAt(sheet: number, place: number): number
	valueAt(sheet: number, place: number): Value
	// The rows holding cells, ascending
	populated(sheet: number): ArrayLike<number>
}

class FormulaCell {
	readonly sheet: number
	readonly row: number
	readonly col: number
	readonly formula: string
	value: Value
	node: Node | undefined
	precedents: readonly Ref[] = []
	// Uses something we can't calculate, so the cached value stands
	unsupported = true
	volatile = false
	// Calculated from a value we couldn't bring up to date
	stale = false
	// Recalculation bookkeeping
	epoch = 0
	seen = 0
	index = -1
	low = 0
	next = 0
	onStack = false
	dependents: FormulaCell[] = NONE

	constructor(sheet: number, row: number, col: number, formula: string, value: Value) {
		this.sheet = sheet
		this.row = row
		this.col = col
		this.formula = formula
		this.value = value
	}
}

// null, over a base, is a cell emptied: the base's value isn't read through it
type Cell = Value | FormulaCell
const NONE: FormulaCell[] = []
const NO_ROWS: ArrayLike<number> = []

// Rows are sparse arrays of cells; `populated` lists the rows that exist, in
// order, so scanning A:A on a sheet with one stray cell at row 1,000,000 visits
// the rows with data instead of a million empty slots
type Sheet = {rows: Cell[][]; populated: number[]}

class Cells implements Context {
	sheet = 0
	row = 0
	col = 0
	usedRows = 0
	usedCols = 0
	// Set when an evaluation reads a stale formula cell
	tainted = false
	readonly date1904: boolean
	readonly sheets: Sheet[]
	readonly #now: () => Date
	readonly #base: CellBase | undefined

	constructor(sheetCount: number, date1904: boolean, now: () => Date, base?: CellBase) {
		this.sheets = Array.from({length: sheetCount}, () => ({rows: [], populated: []}))
		this.date1904 = date1904
		this.#now = now
		this.#base = base
		this.usedRows = base?.rows ?? 0
		this.usedCols = base?.cols ?? 0
	}

	now() {
		return this.#now()
	}

	get(sheet: number, row: number, col: number): Cell | undefined {
		return this.sheets[sheet]?.rows[row]?.[col]
	}

	value(sheet: number, row: number, col: number): Value {
		const cell = this.sheets[sheet]?.rows[row]?.[col]
		if (cell === undefined) return this.#base && this.sheets[sheet] ? this.#base.value(sheet, row, col) : null
		if (cell instanceof FormulaCell) {
			if (cell.stale) this.tainted = true
			return cell.value
		}
		return cell
	}

	set(sheet: number, row: number, col: number, cell: Cell | undefined) {
		const {rows, populated} = this.sheets[sheet]
		const empty = cell === undefined || cell === null
		// Emptied, a cell the base has a value for is held as empty, so that value isn't read through
		const hides = empty && this.#base !== undefined && this.#base.value(sheet, row, col) !== null
		let cells = rows[row]
		if (cells === undefined) {
			if (empty && !hides) return
			cells = rows[row] = []
			if (populated.length === 0 || row > populated[populated.length - 1]) populated.push(row)
			else populated.splice(lowerBound(populated, row), 0, row)
		}
		if (empty) {
			if (hides) cells[col] = null
			else delete cells[col]
			return
		}
		cells[col] = cell
		this.usedRows = Math.max(this.usedRows, row + 1)
		this.usedCols = Math.max(this.usedCols, col + 1)
	}

	scan(ref: Ref, visit: (value: Value) => FormulaError | void): FormulaError | undefined {
		const sheet = this.sheets[ref.sheet]
		if (!sheet) return undefined
		const {rows, populated} = sheet
		const theirs = this.#base ? this.#base.populated(ref.sheet) : NO_ROWS
		const bottom = Math.min(ref.bottom, this.usedRows - 1)
		if (bottom - ref.top <= 2 * (populated.length + theirs.length)) {
			for (let r = ref.top; r <= bottom; r++) {
				const failed = this.#scanRow(ref.sheet, r, rows[r], ref, visit)
				if (failed) return failed
			}
			return undefined
		}
		// Far more rows than data: walk only the rows that exist, the calculator's own and the base's, in order
		let k = lowerBound(populated, ref.top)
		let j = lowerBound(theirs, ref.top)
		for (;;) {
			const own = k < populated.length ? populated[k] : MAX_ROWS
			const base = j < theirs.length ? theirs[j] : MAX_ROWS
			const r = Math.min(own, base)
			if (r > bottom) return undefined
			if (own === r) k++
			if (base === r) j++
			const failed = this.#scanRow(ref.sheet, r, rows[r], ref, visit)
			if (failed) return failed
		}
	}

	// A row's values in the reference's columns, left to right: the calculator's own cells, and the base's where it
	// holds none
	#scanRow(
		sheet: number,
		r: number,
		cells: Cell[] | undefined,
		ref: Ref,
		visit: (value: Value) => FormulaError | void,
	) {
		const base = this.#base
		// The base's cells from the reference's left edge: places from `place` up to `end`
		let place = 0
		let end = 0
		if (base) {
			place = base.rowStart(sheet, r)
			end = base.rowStart(sheet, r + 1)
			for (let high = end; place < high; ) {
				const middle = (place + high) >> 1
				if (base.columnAt(sheet, middle) < ref.left) place = middle + 1
				else high = middle
			}
		}
		const last = cells === undefined ? -1 : Math.min(ref.right, cells.length - 1)
		for (let c = ref.left; ; place++) {
			const next = place < end ? base!.columnAt(sheet, place) : MAX_COLS
			// The calculator's own, left of the base's next
			for (const until = Math.min(next, ref.right + 1); c <= last && c < until; c++) {
				const failed = this.#visit(cells![c], visit)
				if (failed) return failed
			}
			if (next > ref.right) return undefined
			const own = cells?.[next]
			const failed = this.#visit(own !== undefined ? own : base!.valueAt(sheet, place), visit)
			if (failed) return failed
			c = next + 1
		}
	}

	// What a scan sees of a cell: nothing when it's empty, and a formula's value, which taints what reads it while
	// it's out of date
	#visit(cell: Cell | undefined, visit: (value: Value) => FormulaError | void) {
		if (cell === undefined || cell === null) return undefined
		if (cell instanceof FormulaCell && cell.stale) this.tainted = true
		const value = cell instanceof FormulaCell ? cell.value : cell
		return value === null ? undefined : visit(value) || undefined
	}
}

// The first index in a sorted list holding `target` or more
export function lowerBound(sorted: ArrayLike<number>, target: number) {
	let low = 0
	let high = sorted.length
	while (low < high) {
		const middle = (low + high) >> 1
		if (sorted[middle] < target) low = middle + 1
		else high = middle
	}
	return low
}

type RangeDependency = {ref: Ref; cell: FormulaCell}
type Entry = FormulaCell | RangeDependency

// Which formulas read a cell. Single cells are looked up directly. Ranges
// small enough register in the 64x16 blocks they cover; tall ones (A:A) per
// column, wide ones (1:1) per row, and the rare huge ones are scanned.
class Dependencies {
	readonly #cells = new Map<number, Entry[]>()
	readonly #blocks = new Map<number, Entry[]>()
	readonly #columns = new Map<number, Entry[]>()
	readonly #rows = new Map<number, Entry[]>()
	readonly #huge: Entry[] = []
	#lookup = 0

	add(cell: FormulaCell) {
		this.#each(cell, (list, entry) => list.push(entry))
	}

	remove(cell: FormulaCell) {
		this.#each(cell, (list) => {
			const at = list.findIndex((entry) => (entry instanceof FormulaCell ? entry : entry.cell) === cell)
			if (at < 0) return
			list[at] = list[list.length - 1]
			list.pop()
		})
	}

	// The formulas that read (sheet, row, col), each once
	of(sheet: number, row: number, col: number): FormulaCell[] {
		const stamp = ++this.#lookup
		const found: FormulaCell[] = []
		this.#collect(this.#cells.get(cellKey(sheet, row, col)), sheet, row, col, stamp, found)
		this.#collect(this.#blocks.get(blockKey(sheet, row >> 6, col >> 4)), sheet, row, col, stamp, found)
		this.#collect(this.#columns.get(sheet * MAX_COLS + col), sheet, row, col, stamp, found)
		this.#collect(this.#rows.get(sheet * MAX_ROWS + row), sheet, row, col, stamp, found)
		this.#collect(this.#huge, sheet, row, col, stamp, found)
		return found.length > 0 ? found : NONE
	}

	#collect(list: Entry[] | undefined, sheet: number, row: number, col: number, stamp: number, found: FormulaCell[]) {
		if (!list) return
		for (const entry of list) {
			const cell = entry instanceof FormulaCell ? entry : contains(entry.ref, sheet, row, col) ? entry.cell : undefined
			if (!cell || cell.seen === stamp) continue
			cell.seen = stamp
			found.push(cell)
		}
	}

	#each(cell: FormulaCell, apply: (list: Entry[], entry: Entry) => void) {
		const into = (map: Map<number, Entry[]>, key: number, entry: Entry) => {
			let list = map.get(key)
			if (!list) map.set(key, (list = []))
			apply(list, entry)
		}
		for (const ref of cell.precedents) {
			const {sheet, top, left, bottom, right} = ref
			if (top === bottom && left === right) {
				into(this.#cells, cellKey(sheet, top, left), cell)
				continue
			}
			const entry: RangeDependency = {ref, cell}
			const rowBlocks = (bottom >> 6) - (top >> 6) + 1
			const colBlocks = (right >> 4) - (left >> 4) + 1
			if (rowBlocks * colBlocks <= 16) {
				for (let r = top >> 6; r <= bottom >> 6; r++) {
					for (let c = left >> 4; c <= right >> 4; c++) into(this.#blocks, blockKey(sheet, r, c), entry)
				}
			} else if (right - left < 64) {
				for (let c = left; c <= right; c++) into(this.#columns, sheet * MAX_COLS + c, entry)
			} else if (bottom - top < 64) {
				for (let r = top; r <= bottom; r++) into(this.#rows, sheet * MAX_ROWS + r, entry)
			} else apply(this.#huge, entry)
		}
	}
}

const contains = (ref: Ref, sheet: number, row: number, col: number) =>
	ref.sheet === sheet && row >= ref.top && row <= ref.bottom && col >= ref.left && col <= ref.right

const cellKey = (sheet: number, row: number, col: number) => (sheet * MAX_ROWS + row) * MAX_COLS + col
const blockKey = (sheet: number, rowBlock: number, colBlock: number) =>
	(sheet * (MAX_ROWS >> 6) + rowBlock) * (MAX_COLS >> 4) + colBlock

const sameValue = (a: Value, b: Value) => a === b || (isError(a) && isError(b) && a.error === b.error)

// How Excel reads typed input that isn't a formula: numbers (also 1,234.5,
// 50%, $5, ISO dates and times), TRUE/FALSE and error values; a leading
// apostrophe keeps the rest as text. `kind` hints the number format to apply.
// Text stops where a cell's text does, as reading the file back would cut it.
export function parseInput(input: string, date1904 = false): {value: Value; kind?: InputKind} {
	if (input === '') return {value: null}
	if (input.startsWith("'")) return {value: input.slice(1, MAX_TEXT + 1)}
	const upper = input.toUpperCase()
	if (upper === 'TRUE' || upper === 'FALSE') return {value: upper === 'TRUE'}
	const error = errorFromCode(input)
	if (error) return {value: error}
	const number = parseNumber(input, date1904)
	return number ? {value: number.value, kind: number.kind} : {value: input.slice(0, MAX_TEXT)}
}

export class Calculator {
	readonly #cells: Cells
	readonly #dependencies = new Dependencies()
	readonly #sheetIndex = new Map<string, number>()
	readonly #names = new Map<string, NameTarget | {sheetless: Ref}>()
	readonly #localNames = new Map<number, Map<string, NameTarget | {sheetless: Ref}>>()
	readonly #volatile = new Set<FormulaCell>()
	readonly #timeLimit: number
	#epoch = 0

	constructor(
		sheetNames: string[],
		cells: Iterable<{address: CellAddress; value: Value; formula?: string}>,
		options: CalculatorOptions = {},
	) {
		this.#cells = new Cells(
			sheetNames.length,
			options.date1904 ?? false,
			options.now ?? (() => new Date()),
			options.base,
		)
		this.#timeLimit = options.timeLimit ?? 3000
		sheetNames.forEach((name, index) => {
			const key = name.toUpperCase()
			if (!this.#sheetIndex.has(key)) this.#sheetIndex.set(key, index)
		})
		for (const [name, definition] of options.names ?? []) this.#names.set(name.toUpperCase(), this.#define(definition))
		for (const [sheet, names] of options.localNames ?? []) {
			const local = [...names].map(([name, definition]) => [name.toUpperCase(), this.#define(definition)] as const)
			this.#localNames.set(sheet, new Map(local))
		}

		const formulas: FormulaCell[] = []
		for (const {address, value, formula} of cells) {
			if (!this.#valid(address)) continue
			const {sheet, row, col} = address
			if (formula === undefined) {
				this.#cells.set(sheet, row, col, value ?? undefined)
				continue
			}
			const cell = new FormulaCell(sheet, row, col, formula, value ?? null)
			this.#cells.set(sheet, row, col, cell)
			formulas.push(cell)
		}
		for (const cell of formulas) {
			// A later duplicate of the same address replaced it
			if (this.#cells.get(cell.sheet, cell.row, cell.col) !== cell) continue
			try {
				this.#compile(cell)
			} catch {
				// Formulas we can't parse keep their cached value
			}
			this.#attach(cell)
		}
	}

	// Sets a cell from typed input: '=...' is a formula (FormulaSyntaxError when
	// it doesn't parse), anything else is read like Excel reads a typed value.
	// Returns every cell whose value changed, the edited one first.
	set(address: CellAddress, input: string): CellChange[] {
		if (!this.#valid(address)) throw new RangeError('The cell is outside the workbook')
		const {sheet, row, col} = address
		const before = this.#cells.get(sheet, row, col)
		const previous = this.#cells.value(sheet, row, col)
		let next: Cell
		if (input.startsWith('=')) {
			next = new FormulaCell(sheet, row, col, input.slice(1), previous)
			this.#compile(next)
			// A formula we can't calculate has no value of ours to show
			if (next.unsupported) next.value = null
		} else next = parseInput(input, this.#cells.date1904).value

		if (before instanceof FormulaCell) this.#detach(before)
		this.#cells.set(sheet, row, col, next)
		const changes: CellChange[] = []
		const seeds = [...this.#volatile]
		if (next instanceof FormulaCell) {
			this.#attach(next)
			seeds.push(next)
			if (next.unsupported && !sameValue(previous, next.value))
				changes.push({address: {sheet, row, col}, value: next.value})
		} else if (!sameValue(previous, next)) changes.push({address: {sheet, row, col}, value: next})
		const roots = next instanceof FormulaCell ? [] : this.#dependencies.of(sheet, row, col)
		this.#recalculate([...seeds, ...roots], changes)
		// A volatile cell may have been recalculated before the edited one
		const edited = changes.findIndex(
			(change) => change.address.sheet === sheet && change.address.row === row && change.address.col === col,
		)
		if (edited > 0) changes.unshift(...changes.splice(edited, 1))
		return changes
	}

	// Puts cells back exactly as they were, cached values included, and
	// recalculates what reads them: undo and redo. A formula's cached value is
	// what Excel last calculated, which set() would replace with ours (or with
	// nothing, for a formula we can't calculate). Returns every cell whose value
	// changed, the restored ones first.
	restore(cells: Iterable<{address: CellAddress; value: Value; formula?: string}>): CellChange[] {
		const changes: CellChange[] = []
		const restored: CellAddress[] = []
		for (const {address, value, formula} of cells) {
			if (!this.#valid(address)) throw new RangeError('The cell is outside the workbook')
			const {sheet, row, col} = address
			const before = this.#cells.get(sheet, row, col)
			const previous = this.#cells.value(sheet, row, col)
			if (before instanceof FormulaCell) this.#detach(before)
			let next: Cell = value
			if (formula !== undefined) {
				const cell = new FormulaCell(sheet, row, col, formula, value)
				try {
					this.#compile(cell)
				} catch {
					// Kept with its cached value, as when the workbook was loaded
				}
				this.#attach(cell)
				next = cell
			}
			this.#cells.set(sheet, row, col, next)
			if (!sameValue(previous, value)) changes.push({address: {sheet, row, col}, value})
			restored.push(address)
		}
		const seeds = [...this.#volatile]
		for (const {sheet, row, col} of restored) seeds.push(...this.#dependencies.of(sheet, row, col))
		this.#recalculate(seeds, changes)
		return changes
	}

	value({sheet, row, col}: CellAddress): Value {
		return this.#cells.value(sheet, row, col)
	}

	formula({sheet, row, col}: CellAddress): string | undefined {
		const cell = this.#cells.get(sheet, row, col)
		return cell instanceof FormulaCell ? cell.formula : undefined
	}

	isStale({sheet, row, col}: CellAddress): boolean {
		const cell = this.#cells.get(sheet, row, col)
		return cell instanceof FormulaCell && (cell.unsupported || cell.stale)
	}

	// Calculates every formula, for workbooks saved without cached values.
	// Formulas reading one we can't calculate are reported stale.
	recalculate(): CellChange[] {
		const formulas: FormulaCell[] = []
		for (const {rows, populated} of this.#cells.sheets) {
			for (const r of populated) for (const cell of rows[r]) if (cell instanceof FormulaCell) formulas.push(cell)
		}
		const changes: CellChange[] = []
		this.#recalculate(formulas, changes)
		return changes
	}

	#valid({sheet, row, col}: CellAddress) {
		return (
			Number.isInteger(sheet) &&
			Number.isInteger(row) &&
			Number.isInteger(col) &&
			sheet >= 0 &&
			sheet < this.#cells.sheets.length &&
			row >= 0 &&
			row < MAX_ROWS &&
			col >= 0 &&
			col < MAX_COLS
		)
	}

	// Parses and binds; throws FormulaSyntaxError, leaving the cell unsupported
	#compile(cell: FormulaCell) {
		const bound = bind(parseFormula(cell.formula), {
			sheet: cell.sheet,
			sheetIndex: (name) => this.#sheetIndex.get(name.toUpperCase()),
			name: (name) => {
				const upper = name.toUpperCase()
				const target = this.#localNames.get(cell.sheet)?.get(upper) ?? this.#names.get(upper)
				if (target === undefined || typeof target === 'string' || !('sheetless' in target)) return target
				const {top, left, bottom, right} = target.sheetless
				return {ref: new Ref(cell.sheet, top, left, bottom, right)}
			},
		})
		cell.node = bound.node
		cell.precedents = bound.precedents
		cell.unsupported = bound.unsupported
		cell.volatile = bound.volatile
	}

	#attach(cell: FormulaCell) {
		this.#dependencies.add(cell)
		if (cell.volatile) this.#volatile.add(cell)
	}

	#detach(cell: FormulaCell) {
		this.#dependencies.remove(cell)
		this.#volatile.delete(cell)
	}

	// A defined name we can use: a constant or a fully absolute reference
	#define(definition: string): NameTarget | {sheetless: Ref} {
		const text = definition.startsWith('=') ? definition.slice(1) : definition
		try {
			const tokens = tokenize(text)
			const [token] = tokens
			if (tokens.length === 1 && token.kind === 'ref') {
				const {top, left, bottom, right} = token.area
				const {fixed} = token
				const absolute =
					(token.form === 'rows' || (fixed.left && fixed.right)) &&
					(token.form === 'columns' || (fixed.top && fixed.bottom))
				if (token.unsupported || !absolute) return 'unsupported'
				const area = new Ref(
					0,
					Math.min(top, bottom),
					Math.min(left, right),
					Math.max(top, bottom),
					Math.max(left, right),
				)
				if (token.sheet === undefined) return {sheetless: area}
				const sheet = this.#sheetIndex.get(token.sheet.toUpperCase())
				if (sheet === undefined) return {value: Errors.ref}
				return {ref: new Ref(sheet, area.top, area.left, area.bottom, area.right)}
			}
			const ast = parseFormula(text)
			if (ast.type === 'number' || ast.type === 'string' || ast.type === 'boolean') return {value: ast.value}
			if (ast.type === 'error') return {value: errorFromCode(ast.value)!}
			if (ast.type === 'unary' && ast.operator === '-' && ast.operand.type === 'number') {
				return {value: 0 - ast.operand.value}
			}
		} catch {
			// An unparseable definition is as unusable as a complex one
		}
		return 'unsupported'
	}

	// Recalculates `seeds` and everything downstream of them, in dependency
	// order (Tarjan's strongly connected components, iteratively, so long
	// chains can't overflow the stack); members of a cycle become #CALC!
	#recalculate(seeds: FormulaCell[], changes: CellChange[]) {
		const epoch = ++this.#epoch
		const affected: FormulaCell[] = []
		const enqueue = (cell: FormulaCell) => {
			if (cell.epoch === epoch) return
			cell.epoch = epoch
			cell.index = -1
			affected.push(cell)
		}
		seeds.forEach(enqueue)
		for (let i = 0; i < affected.length; i++) {
			const cell = affected[i]
			cell.dependents = this.#dependencies.of(cell.sheet, cell.row, cell.col)
			cell.dependents.forEach(enqueue)
		}

		// Components complete dependents-first, so they're evaluated in reverse
		const components: FormulaCell[][] = []
		const stack: FormulaCell[] = []
		let counter = 0
		const path: FormulaCell[] = []
		const open = (cell: FormulaCell) => {
			cell.index = cell.low = counter++
			cell.next = 0
			cell.onStack = true
			stack.push(cell)
			path.push(cell)
		}
		for (const root of affected) {
			if (root.index >= 0) continue
			open(root)
			while (path.length > 0) {
				const cell = path[path.length - 1]
				if (cell.next < cell.dependents.length) {
					const dependent = cell.dependents[cell.next++]
					if (dependent.index < 0) open(dependent)
					else if (dependent.onStack) cell.low = Math.min(cell.low, dependent.index)
					continue
				}
				path.pop()
				if (path.length > 0) {
					const parent = path[path.length - 1]
					parent.low = Math.min(parent.low, cell.low)
				}
				if (cell.low !== cell.index) continue
				const component: FormulaCell[] = []
				let member: FormulaCell
				do {
					member = stack.pop()!
					member.onStack = false
					component.push(member)
				} while (member !== cell)
				components.push(component)
			}
		}

		const deadline = performance.now() + this.#timeLimit
		let evaluated = 0
		let expired = false
		for (let i = components.length - 1; i >= 0; i--) {
			const component = components[i]
			const cyclic = component.length > 1 || component[0].dependents.includes(component[0])
			for (const cell of component) {
				if (!expired && ++evaluated % 64 === 0) expired = performance.now() > deadline
				if (expired) {
					cell.stale = true
					continue
				}
				if (cyclic) cell.stale = false
				const value = cyclic ? Errors.calc : this.#evaluate(cell)
				if (value === undefined || sameValue(value, cell.value)) continue
				cell.value = value
				changes.push({address: {sheet: cell.sheet, row: cell.row, col: cell.col}, value})
			}
		}
		// The graph is rebuilt on every recalculation; holding it would keep replaced formulas alive
		for (const cell of affected) cell.dependents = NONE
	}

	// The new value, or undefined to keep the cached one (marked stale)
	#evaluate(cell: FormulaCell): Value | undefined {
		if (cell.unsupported || !cell.node) {
			cell.stale = true
			return undefined
		}
		const cx = this.#cells
		cx.sheet = cell.sheet
		cx.row = cell.row
		cx.col = cell.col
		cx.tainted = false
		let value: Value | undefined
		try {
			value = settle(evaluateFormula(cell.node, cx), cx)
		} catch (error) {
			// A formula built to exhaust memory or the stack gives up instead of the tab
			if (!(error instanceof CalcLimitError || error instanceof RangeError)) throw error
		}
		cell.stale = value === undefined || cx.tainted
		return value
	}
}

// The value a formula leaves in its cell. An empty result shows 0. A result of
// several cells would spill in Excel 365, which we don't do: undefined keeps
// the cached value, reported stale.
function settle(result: Result, cx: Cells): Value | undefined {
	if (result instanceof Areas) {
		if (result.refs.length !== 1) return Errors.value
		result = result.refs[0]
	}
	if (result instanceof Ref) {
		if (result.top !== result.bottom || result.left !== result.right) return undefined
		return cx.value(result.sheet, result.top, result.left) ?? 0
	}
	if (isMatrix(result)) return result.length === 1 && result[0].length === 1 ? (result[0][0] ?? 0) : undefined
	if (typeof result === 'number') return Number.isFinite(result) ? result + 0 : Errors.num
	return result ?? 0
}
