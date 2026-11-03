// Reads .xlsx workbooks for the sheet viewer, in a module worker or anywhere
// else without a DOM. Opening parses the small parts (workbook, styles,
// theme) and lists the sheets; shared strings are read with the first sheet,
// and each sheet only when it's asked for.

import {attr, child, children, parseXml, textContent} from '../../../shared/xml'
import {displayFormula} from './formula-text'
import {guard, Package, parseRange, type Range, type SheetKind, type SheetState} from './package'
import {emptySheet, parseSheet, type Sheet, type SheetContext, type SheetFeatures} from './sheet'
import {parseSharedStrings, type SharedStrings} from './strings'
import {flag, index, parseStyles, parseTheme, type ResolvedStyles} from './styles'

export type SheetInfo = {name: string; state: SheetState; kind: SheetKind}

// `sheet` is set for a name scoped to one sheet
export type DefinedName = {name: string; formula: string; sheet?: number}

export type Workbook = {
	sheets: readonly SheetInfo[]
	activeSheet: number // the tab Excel opens on
	date1904: boolean
	definedNames: readonly DefinedName[]
	styles: ResolvedStyles
	// A format can be added after the file's own: they're there, and styles holds every one of them
	canAddFormats: boolean
	hasMacros: boolean // kept on save, never run
	// Each call reads the sheet afresh, holding it to maxCells (the workbook's, unless given less)
	loadSheet(index: number, maxCells?: number): Promise<Sheet>
}

// What a hostile or just enormous file may make us hold in memory. Each cell costs about 17 bytes while loading
// and 13 after; merged ranges, hyperlinks, shared strings and rich text runs count as cells too. A phone wants less
// than the default.
export type WorkbookLimits = {maxCells: number}

const DEFAULT_LIMITS: WorkbookLimits = {maxCells: 10_000_000}

export function openWorkbook(bytes: Uint8Array, limits?: Partial<WorkbookLimits>): Promise<Workbook> {
	const maxCells = limits?.maxCells ?? DEFAULT_LIMITS.maxCells
	return guard(async () => {
		const pkg = Package.open(bytes)
		const book = await pkg.workbook()
		const rels = [...book.rels.values()]
		const part = (type: string) => rels.find((rel) => rel.type === type && !rel.external)?.target
		const theme = parseTheme(await pkg.text(part('theme')))
		const {styles, palette, cellFormats} = parseStyles(await pkg.text(part('styles')), theme)
		const properties = child(book.root, 'workbookPr')
		const date1904 = properties ? flag(attr(properties, 'date1904')) : false
		const names = child(book.root, 'definedNames')
		const definedNames = (names ? children(names, 'definedName') : []).map((name): DefinedName => {
			const sheet = index(attr(name, 'localSheetId'))
			return {
				name: attr(name, 'name') ?? '',
				formula: displayFormula(textContent(name)),
				...(sheet !== undefined && {sheet}),
			}
		})
		const sheets = book.sheets.map(({name, state, kind}): SheetInfo => ({name, state, kind}))
		const views = child(book.root, 'bookViews')
		const view = views && child(views, 'workbookView')
		const active = index(view && attr(view, 'activeTab')) ?? 0
		// Excel never opens on a hidden sheet, whatever the file says
		const visible = sheets.findIndex((sheet) => sheet.state === 'visible')
		const activeSheet = sheets[active]?.state === 'visible' ? active : Math.max(visible, 0)

		let sharedStrings: Promise<SharedStrings | undefined> | undefined
		const loadSharedStrings = () =>
			(sharedStrings ??= pkg
				.text(part('sharedStrings'))
				.then((xml) => (xml === undefined ? undefined : parseSharedStrings(xml, theme, palette, maxCells))))

		const loadSheet = (i: number, sheetCells = maxCells) =>
			guard(async () => {
				const info = book.sheets[i]
				if (!info) throw new Error(`The workbook has no sheet ${i}`)
				const sheetRels = info.part ? await pkg.rels(info.part) : new Map()
				const types = new Set([...sheetRels.values()].map((rel) => rel.type))
				let hasCharts = false
				for (const rel of sheetRels.values()) {
					if (rel.type !== 'drawing' || rel.external || hasCharts) continue
					const drawing = await pkg.rels(rel.target)
					hasCharts = [...drawing.values()].some((target) => target.type === 'chart' || target.type === 'chartEx')
				}
				const headerAndTotalRows: Range[] = []
				for (const rel of sheetRels.values()) {
					const xml = rel.type === 'table' && !rel.external ? await pkg.text(rel.target) : undefined
					if (xml === undefined) continue
					const table = parseXml(xml)
					const range = parseRange(attr(table, 'ref') ?? '')
					if (!range) continue
					const headers = index(attr(table, 'headerRowCount')) ?? 1
					const totals = index(attr(table, 'totalsRowCount')) ?? 0
					if (headers) headerAndTotalRows.push({...range, bottom: Math.min(range.bottom, range.top + headers - 1)})
					if (totals) headerAndTotalRows.push({...range, top: Math.max(range.top, range.bottom - totals + 1)})
				}
				const features: SheetFeatures = {
					hasDrawings: types.has('drawing'),
					hasCharts,
					hasPivots: types.has('pivotTable'),
					hasComments: types.has('comments') || types.has('threadedComment'),
					headerAndTotalRows,
				}
				const xml = info.kind === 'worksheet' ? await pkg.text(info.part) : undefined
				const context: SheetContext = {
					name: info.name,
					sharedStrings: xml === undefined ? undefined : await loadSharedStrings(),
					styles,
					theme,
					palette,
					date1904,
					rels: sheetRels,
					maxCells: Math.min(maxCells, sheetCells),
				}
				return xml === undefined ? emptySheet(context, features) : parseSheet(xml, context, features)
			})

		return {
			sheets,
			activeSheet,
			date1904,
			definedNames,
			styles,
			canAddFormats: cellFormats > 0 && cellFormats === styles.length,
			hasMacros: rels.some((rel) => rel.type === 'vbaProject'),
			loadSheet,
		}
	})
}
