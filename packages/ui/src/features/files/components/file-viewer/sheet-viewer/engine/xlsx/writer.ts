// Saves cell edits by patching the original workbook in place: only the <c>
// elements an edit touches are rewritten (new ones go in at their place in
// row order), so everything we don't understand (charts, pivots, comments,
// validation, macros) survives byte for byte. Strings go in as inline strings
// so sharedStrings.xml is never touched, cell formats an edit adds go at the end
// of styles.xml's, and Excel is told to recalculate on open, with the stale
// calculation chain removed.

import {asUtf8} from '../../../shared/opc'
import {child, children, escapeXmlText, parseXml, tokenizeXml, type XmlElement} from '../../../shared/xml'
import {patchZip} from '../../../shared/zip'
import {shiftFormula} from '../formula/shift'
import {isError, type Value} from '../formula/values'
import {displayFormula, fileFormula} from './formula-text'
import {
	guard,
	MAX_COLS,
	MAX_ROWS,
	Package,
	parseRange,
	parseRef,
	rangeName,
	refName,
	XlsxError,
	type Range,
	type WorkbookPart,
} from './package'
import {index} from './styles'

// A cell's new content. formula is without the '=' and comes with the value it calculated, which is stored as
// the cell's cached value; a null value with no formula clears the cell (its style stays). A style replaces the
// cell's own.
export type CellEdit = {sheet: number; row: number; col: number; value: Value; formula?: string; style?: number}

// A cell format to add after the file's own: a copy of one of them (`base`, an index into cellXfs) with another
// number format
export type CellFormat = {base: number; numFmtId: number}

export function saveWorkbook(
	original: Uint8Array,
	edits: readonly CellEdit[],
	formats: readonly CellFormat[] = [],
): Promise<Uint8Array<ArrayBuffer>> {
	return guard(async () => {
		const pkg = Package.open(original)
		const book = await pkg.workbook()
		const bySheet = new Map<number, Map<number, CellEdit>>()
		for (const edit of edits) {
			const {sheet, row, col} = edit
			if (
				!Number.isInteger(row) ||
				row < 0 ||
				row >= MAX_ROWS ||
				!Number.isInteger(col) ||
				col < 0 ||
				col >= MAX_COLS
			) {
				throw new TypeError(`No cell at row ${row}, column ${col}`)
			}
			const info = book.sheets[sheet]
			if (!info) throw new TypeError(`The workbook has no sheet ${sheet}`)
			if (info.kind !== 'worksheet' || !info.part || !pkg.entry(info.part)) {
				throw new XlsxError('unsupported', `${info.name} isn't a worksheet`)
			}
			let cells = bySheet.get(sheet)
			if (!cells) bySheet.set(sheet, (cells = new Map()))
			// The last edit of a cell wins
			cells.set(row * MAX_COLS + col, edit)
		}
		const changes = new Map<string, string | null>()
		for (const [sheet, cells] of bySheet) {
			const entry = pkg.entry(book.sheets[sheet].part!)!
			changes.set(entry, patchSheet(await pkg.archive.text(entry), cells))
		}
		if (bySheet.size) await recalculateOnOpen(pkg, book, changes)
		if (formats.length) await addFormats(pkg, book, formats, changes)
		return patchZip(pkg.archive, changes)
	})
}

type Splice = {start: number; end: number; text: string}
type Formula = {type?: string; si?: string; ref?: string; text: string; start: number; end: number; name: string}
type CellSpan = {
	row: number
	col: number
	start: number
	end: number
	style?: string
	cm?: string // cell metadata: what makes an array formula a dynamic array in Excel 365
	formula?: Formula
	kept?: string // the <f> of an array formula an edit only recalculated, written back as it is
}
type RowSpan = {
	start: number
	openEnd: number
	contentEnd: number
	end: number
	name: string
	cells: CellSpan[]
	style?: number
}

// Scans the whole sheet even when the edits are near its top: rows out of order (which other readers, ours
// included, accept) could otherwise hide the row an edit belongs to
function patchSheet(xml: string, edits: Map<number, CellEdit>): string {
	const byRow = new Map<number, CellEdit[]>()
	for (const edit of edits.values()) {
		const list = byRow.get(edit.row)
		if (list) list.push(edit)
		else byRow.set(edit.row, [edit])
	}
	for (const list of byRow.values()) list.sort((a, b) => a.col - b.col)
	const editedRows = [...byRow.keys()].sort((a, b) => a - b)
	const rowSpans = new Map<number, RowSpan>()
	// Where each edited row that doesn't exist yet goes: before the first row after it
	const rowInserts = new Map<number, number>()
	const masters = new Map<number, {row: number; col: number; text: string}>()
	const members: CellSpan[] = []
	const affected = new Set<number>() // shared formula groups whose master is edited
	const arrays: Array<{range: Range; row: number; col: number}> = []
	const clearing: Range[] = [] // array formulas dissolved by an edit of their anchor's formula
	const cleared: CellSpan[] = []
	const columnStyles: Array<{from: number; to: number; style: number}> = []
	let sheetData: {start: number; end: number; selfClosing: boolean; name: string; close: number} | undefined
	let dimension: {start: number; end: number; ref: string; name: string} | undefined
	let next = 0 // the next edited row to place

	let inData = false
	let row = -1
	let col = -1
	let rowSpan: RowSpan | undefined
	let cell: CellSpan | undefined
	let depth = 0 // of elements open inside the cell
	let formula: Formula | undefined

	const finishCell = (end: number) => {
		const span = cell!
		cell = undefined
		span.end = end
		const position = span.row * MAX_COLS + span.col
		const f = span.formula
		const si = index(f?.si)
		if (f?.type === 'shared' && si !== undefined) {
			if (!f.text) members.push(span)
			else {
				masters.set(si, {row: span.row, col: span.col, text: f.text})
				// The group's other members lose their master and will need their own formulas
				if (edits.has(position)) affected.add(si)
			}
		} else if (f?.type === 'array' && f.text) {
			const range = parseRange(f.ref ?? '') ?? {top: span.row, left: span.col, bottom: span.row, right: span.col}
			arrays.push({range, row: span.row, col: span.col})
			// An anchor whose formula is the file's has only been recalculated: the array stays, with its new value
			const edit = edits.get(position)
			if (edit?.formula === displayFormula(f.text)) span.kept = xml.slice(f.start, f.end)
			else if (edit) clearing.push(range)
		}
		if (rowSpan && span.row === row) rowSpan.cells.push(span)
		if (clearing.some((range) => contains(range, span.row, span.col))) cleared.push(span)
	}

	tokenizeXml(xml, (event) => {
		if (event.type === 'text') {
			if (formula) formula.text += event.text
			return
		}
		const name = event.name
		const local = name.slice(name.indexOf(':') + 1)
		if (event.type === 'close') {
			if (cell) {
				if (depth === 0) finishCell(event.end)
				else if (--depth === 0 && formula) {
					formula.end = event.end
					formula = undefined
				}
			} else if (local === 'row' && rowSpan) {
				rowSpan.contentEnd = event.start
				rowSpan.end = event.end
				rowSpan = undefined
			} else if (local === 'sheetData' && sheetData) {
				sheetData.close = event.start
				inData = false
			} else if (local === 'dimension' && dimension) dimension.end = event.end
			return
		}
		const {attributes, selfClosing, start, end} = event
		if (cell) {
			if (depth === 0 && local === 'f') {
				const {t, si, ref} = attributes
				formula = {type: t, si, ref, text: '', start, end, name}
				cell.formula = formula
				if (selfClosing) formula = undefined
			}
			if (!selfClosing) depth++
			return
		}
		if (inData && local === 'c') {
			const ref = attributes.r
			const position = ref !== undefined ? parseRef(ref) : Math.max(row, 0) * MAX_COLS + col + 1
			if (position < 0 || (ref === undefined && (col + 1 >= MAX_COLS || row >= MAX_ROWS))) {
				throw new XlsxError('corrupt', `Invalid cell reference ${ref}`)
			}
			col = position % MAX_COLS
			cell = {row: (position - col) / MAX_COLS, col, start, end, style: attributes.s, cm: attributes.cm}
			depth = 0
			if (selfClosing) finishCell(end)
		} else if (inData && local === 'row') {
			const r = index(attributes.r)
			row = r !== undefined && r >= 1 ? r - 1 : row + 1
			col = -1
			for (; next < editedRows.length && editedRows[next] < row; next++) rowInserts.set(editedRows[next], start)
			rowSpan = undefined
			if (byRow.has(row)) {
				rowSpan = {start, openEnd: end, contentEnd: -1, end, name, cells: []}
				if (attributes.customFormat === '1' || attributes.customFormat === 'true') rowSpan.style = index(attributes.s)
				rowSpans.set(row, rowSpan)
				if (selfClosing) rowSpan = undefined
			}
		} else if (local === 'sheetData' && !sheetData) {
			sheetData = {start, end, selfClosing, name, close: end}
			inData = !selfClosing
		} else if (local === 'dimension' && !dimension) {
			dimension = {start, end, ref: attributes.ref ?? '', name}
		} else if (local === 'col') {
			const from = index(attributes.min)
			const to = index(attributes.max)
			const style = index(attributes.style)
			if (from && to && style !== undefined) columnStyles.push({from: from - 1, to: to - 1, style})
		}
	})
	if (!sheetData) throw new XlsxError('corrupt', 'The worksheet has no sheetData')

	const prefix = sheetData.name.slice(0, sheetData.name.indexOf(':') + 1)
	const splices: Splice[] = []
	const content = (edit: CellEdit) => edit.value !== null || edit.formula !== undefined

	// A cell inside an array formula's range belongs to the formula: it can only change with the formula itself
	for (const position of edits.keys()) {
		const [r, c] = [Math.floor(position / MAX_COLS), position % MAX_COLS]
		const array = arrays.find(({range, row, col}) => contains(range, r, c) && (row !== r || col !== c))
		if (array && !edits.has(array.row * MAX_COLS + array.col)) {
			throw new XlsxError('unsupported', `${refName(r, c)} is part of an array formula`)
		}
	}

	const newRows: Array<{at: number; xml: string}> = []
	for (const r of editedRows) {
		const rowEdits = byRow.get(r)!
		const span = rowSpans.get(r)
		// A new cell takes the style Excel would give it: its row's, else its column's
		const inherit = (c: number) =>
			String(span?.style ?? columnStyles.find(({from, to}) => from <= c && c <= to)?.style ?? '') || undefined
		if (!span) {
			const cells = rowEdits
				.filter(content)
				.map((edit) => cellXml(edit, prefix, edit.style?.toString() ?? inherit(edit.col)))
				.join('')
			if (cells) {
				newRows.push({
					at: rowInserts.get(r) ?? sheetData.close,
					xml: `<${prefix}row r="${r + 1}">${cells}</${prefix}row>`,
				})
			}
			continue
		}
		// Edits and the row's cells, both in column order, walked together
		const inserts: Array<{at: number; xml: string}> = []
		const cells = [...span.cells].sort((a, b) => a.col - b.col)
		let p = 0
		for (const edit of rowEdits) {
			while (p < cells.length && cells[p].col < edit.col) p++
			if (cells[p]?.col === edit.col) {
				// A cell the file repeats is written once, in place of its first copy
				for (const first = p; cells[p]?.col === edit.col; p++) {
					splices.push({
						start: cells[p].start,
						end: cells[p].end,
						text: p === first ? cellXml(edit, prefix, edit.style?.toString() ?? cells[p].style, cells[p]) : '',
					})
				}
			} else if (content(edit)) {
				inserts.push({
					at: cells[p]?.start ?? span.contentEnd,
					xml: cellXml(edit, prefix, edit.style?.toString() ?? inherit(edit.col)),
				})
			}
		}
		if (span.contentEnd < 0) {
			// <row r="5" ht="30"/> becomes a row with content
			if (inserts.length) {
				const open = `${xml.slice(span.start, span.openEnd - 2).trimEnd()}>`
				splices.push({
					start: span.start,
					end: span.end,
					text: `${open}${inserts.map((i) => i.xml).join('')}</${span.name}>`,
				})
			}
		} else for (const insert of inserts) splices.push({start: insert.at, end: insert.at, text: insert.xml})
	}

	for (const member of members) {
		const si = index(member.formula!.si)!
		const master = masters.get(si)
		if (!affected.has(si) || !master || edits.has(member.row * MAX_COLS + member.col)) continue
		let text: string
		try {
			text = shiftFormula(master.text, {rows: member.row - master.row, cols: member.col - master.col})
		} catch {
			throw new XlsxError('unsupported', `The shared formula in ${refName(member.row, member.col)} can't be rewritten`)
		}
		const {start, end, name} = member.formula!
		splices.push({start, end, text: `<${name}>${escapeXmlText(text)}</${name}>`})
	}
	for (const span of cleared) {
		if (edits.has(span.row * MAX_COLS + span.col)) continue
		splices.push({start: span.start, end: span.end, text: cellXml(null, prefix, span.style, span)})
	}

	if (newRows.length) {
		if (sheetData.selfClosing) {
			const open = `${xml.slice(sheetData.start, sheetData.end - 2).trimEnd()}>`
			const rows = newRows.map((row) => row.xml).join('')
			splices.push({start: sheetData.start, end: sheetData.end, text: `${open}${rows}</${sheetData.name}>`})
		} else for (const row of newRows) splices.push({start: row.at, end: row.at, text: row.xml})
	}

	// The used range grows to take in the new content (it's only ever a hint, so it never shrinks)
	const used = dimension && parseRange(dimension.ref)
	if (dimension && used) {
		const grown = {...used}
		for (const edit of edits.values()) {
			if (!content(edit)) continue
			grown.top = Math.min(grown.top, edit.row)
			grown.left = Math.min(grown.left, edit.col)
			grown.bottom = Math.max(grown.bottom, edit.row)
			grown.right = Math.max(grown.right, edit.col)
		}
		const ref = rangeName(grown)
		if (ref !== rangeName(used)) {
			splices.push({start: dimension.start, end: dimension.end, text: `<${dimension.name} ref="${ref}"/>`})
		}
	}
	return asUtf8(splice(xml, splices))
}

// The XML for a cell: its reference, the style it keeps, and the new content. In place of the file's cell
// `replaced`, it keeps that cell's array formula, and its metadata, if the edit kept the formula.
function cellXml(edit: CellEdit | null, prefix: string, style: string | undefined, replaced?: CellSpan): string {
	const {row, col} = edit ?? replaced!
	const ref = refName(row, col)
	const s = style !== undefined && /^\d+$/.test(style) ? ` s="${style}"` : ''
	const value = edit?.value ?? null
	const tag = (name: string, text: string) => `<${prefix}${name}>${text}</${prefix}${name}>`
	if (edit?.formula !== undefined) {
		const f = replaced?.kept ?? tag('f', escapeXmlText(fileFormula(edit.formula)))
		const cm = replaced?.kept && replaced.cm && /^\d+$/.test(replaced.cm) ? ` cm="${replaced.cm}"` : ''
		const [type, cached] = typedValue(value)
		return `<${prefix}c r="${ref}"${s}${cm}${type === 'inlineStr' ? ' t="str"' : type ? ` t="${type}"` : ''}>${f}${
			cached === undefined ? '' : tag('v', cached)
		}</${prefix}c>`
	}
	if (value === null) return `<${prefix}c r="${ref}"${s}/>`
	const [type, text] = typedValue(value)
	if (type === 'inlineStr') {
		return `<${prefix}c r="${ref}"${s} t="inlineStr"><${prefix}is><${prefix}t xml:space="preserve">${text}</${prefix}t></${prefix}is></${prefix}c>`
	}
	return `<${prefix}c r="${ref}"${s}${type ? ` t="${type}"` : ''}>${tag('v', text!)}</${prefix}c>`
}

// The cell type and escaped text for a value. A number that isn't finite can't be stored and is #NUM! in Excel.
function typedValue(value: Value): [type: string, text: string | undefined] {
	if (value === null) return ['', undefined]
	if (typeof value === 'number') return Number.isFinite(value) ? ['', String(value)] : ['e', '#NUM!']
	if (typeof value === 'boolean') return ['b', value ? '1' : '0']
	if (isError(value)) return ['e', escapeXmlText(value.error)]
	return ['inlineStr', escapeXmlText(xstring(value))]
}

// Text in OOXML's escaped string form: characters XML can't carry become _xHHHH_ (as Excel writes them), and a
// literal "_x0041_" gets its underscore escaped so it reads back as itself
const xstring = (text: string) =>
	text
		.replace(/_(?=x[0-9A-Fa-f]{4}_)/g, '_x005F_')
		.replace(
			/[^\t\n\r\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu,
			(c) => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`,
		)

const contains = (range: Range, row: number, col: number) =>
	row >= range.top && row <= range.bottom && col >= range.left && col <= range.right

function splice(text: string, splices: Splice[]): string {
	splices.sort((a, b) => a.start - b.start || a.end - b.end)
	let out = ''
	let at = 0
	for (const {start, end, text: replacement} of splices) {
		if (start < at) throw new Error('Overlapping edits')
		out += text.slice(at, start) + replacement
		at = end
	}
	return out + text.slice(at)
}

// Cached values stay as we computed them, but Excel recalculates on open (fullCalcOnLoad) to catch the formulas we
// can't, and the calculation chain (calcChain.xml, its relationship and its content type) goes: a stale one makes
// Excel report the file as damaged.
async function recalculateOnOpen(pkg: Package, book: WorkbookPart, changes: Map<string, string | null>) {
	const chains = [...book.rels.values()].filter((rel) => rel.type === 'calcChain' && !rel.external)
	for (const {target} of chains) {
		const entry = pkg.entry(target)
		if (entry) changes.set(entry, null)
	}
	if (chains.length) {
		const rels = await pkg.text(book.relsPart)
		if (rels !== undefined) {
			const doomed = children(parseXml(rels), 'Relationship').filter((rel) =>
				rel.attributes.Type?.endsWith('/calcChain'),
			)
			changes.set(pkg.entry(book.relsPart)!, asUtf8(remove(rels, doomed)))
		}
	}
	const types = await pkg.text('[Content_Types].xml')
	if (types !== undefined) {
		const parts = new Set(chains.map(({target}) => `/${target}`.toLowerCase()))
		const doomed = children(parseXml(types), 'Override').filter(
			({attributes}) =>
				parts.has(attributes.PartName?.toLowerCase() ?? '') ||
				attributes.ContentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml',
		)
		for (const override of doomed) {
			const entry = pkg.entry(override.attributes.PartName?.replace(/^\//, '') ?? '')
			if (entry) changes.set(entry, null)
		}
		if (doomed.length) changes.set(pkg.entry('[Content_Types].xml')!, asUtf8(remove(types, doomed)))
	}

	const {xml, root} = book
	const calcPr = root.children.find((node): node is XmlElement => 'local' in node && node.local === 'calcPr')
	let patched: string
	if (calcPr) {
		// Only the open tag changes (contentStart is where it ends, self-closing or not)
		const tag = xml.slice(calcPr.start, calcPr.contentStart)
		const value = calcPr.attributes.fullCalcOnLoad
		if (value === '1' || value === 'true') return
		const updated =
			value === undefined
				? tag.replace(/\s*(\/?>)$/, ' fullCalcOnLoad="1"$1')
				: tag.replace(/(\sfullCalcOnLoad\s*=\s*)(["'])[^"']*\2/, '$1"1"')
		patched = xml.slice(0, calcPr.start) + updated + xml.slice(calcPr.contentStart)
	} else {
		// calcPr's place in the schema's sequence is right after these
		const before = ['sheets', 'functionGroups', 'externalReferences', 'definedNames']
		const anchor = root.children.findLast((node): node is XmlElement => 'local' in node && before.includes(node.local))
		if (!anchor) throw new XlsxError('corrupt', 'The workbook has no sheets')
		const prefix = root.name.slice(0, root.name.indexOf(':') + 1)
		patched = `${xml.slice(0, anchor.end)}<${prefix}calcPr fullCalcOnLoad="1"/>${xml.slice(anchor.end)}`
	}
	changes.set(pkg.entry(book.part)!, asUtf8(patched))
}

// Appends cell formats to styles.xml's cellXfs, each a copy of its base with the new number format, and counts them
async function addFormats(
	pkg: Package,
	book: WorkbookPart,
	formats: readonly CellFormat[],
	changes: Map<string, string | null>,
) {
	const part = [...book.rels.values()].find((rel) => rel.type === 'styles' && !rel.external)?.target
	const entry = part && pkg.entry(part)
	const xml = entry && (await pkg.archive.text(entry))
	const cellXfs = xml ? child(parseXml(xml), 'cellXfs') : undefined
	const xfs = cellXfs ? children(cellXfs, 'xf') : []
	if (!entry || !xml || !cellXfs || formats.some(({base}) => !xfs[base])) {
		throw new TypeError('The workbook has no cell format to copy')
	}
	const added = formats.map(({base, numFmtId}) => {
		const xf = xfs[base]
		const open = xml
			.slice(xf.start, xf.contentStart)
			.replace(/\s(numFmtId|applyNumberFormat)\s*=\s*(["'])[^"']*\2/g, '')
			.replace(/\s*(\/?>)$/, ` numFmtId="${numFmtId}" applyNumberFormat="1"$1`)
		return open + xml.slice(xf.contentStart, xf.end)
	})
	const count = xfs.length + formats.length
	const tag = xml
		.slice(cellXfs.start, cellXfs.contentStart)
		.replace(/\scount\s*=\s*(["'])[^"']*\1/, '')
		.replace(/\s*(\/?>)$/, ` count="${count}">`)
	const close = cellXfs.contentEnd === cellXfs.end ? `</${cellXfs.name}>` : xml.slice(cellXfs.contentEnd, cellXfs.end)
	changes.set(
		entry,
		asUtf8(
			xml.slice(0, cellXfs.start) +
				tag +
				xml.slice(cellXfs.contentStart, cellXfs.contentEnd) +
				added.join('') +
				close +
				xml.slice(cellXfs.end),
		),
	)
}

function remove(xml: string, elements: XmlElement[]): string {
	return splice(
		xml,
		elements.map(({start, end}) => ({start, end, text: ''})),
	)
}
