import {Redo2, Search, Undo2} from 'lucide-react'
import {useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react'
import {useTranslation} from 'react-i18next'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {ContextMenuItem, ContextMenuSeparator} from '@/components/ui/context-menu'
import {toast} from '@/components/ui/toast'
import {CsvDocument} from '@/features/files/components/file-viewer/sheet-viewer/csv-document'
import {createCsvClient} from '@/features/files/components/file-viewer/sheet-viewer/engine/csv/protocol'
import {FormulaSyntaxError} from '@/features/files/components/file-viewer/sheet-viewer/engine/formula/parser'
import {
	MAX_COLS,
	MAX_ROWS,
	parseRange,
	rangeName,
	refName,
	XlsxError,
} from '@/features/files/components/file-viewer/sheet-viewer/engine/xlsx/package'
import {createXlsxClient} from '@/features/files/components/file-viewer/sheet-viewer/engine/xlsx/protocol'
import type {Hyperlink} from '@/features/files/components/file-viewer/sheet-viewer/engine/xlsx/sheet'
import {loadFonts} from '@/features/files/components/file-viewer/sheet-viewer/fonts'
import {FormulaBar} from '@/features/files/components/file-viewer/sheet-viewer/formula-bar'
import {Grid, type Editing, type MenuTarget} from '@/features/files/components/file-viewer/sheet-viewer/grid'
import {
	areaAt,
	bounds,
	inRange,
	mergeAt,
	placeOf,
	rangeOf,
	sameRange,
	selectionRange,
	step,
	visibleLine,
	wholeLines,
	type Cell,
	type GridSource,
	type Lock,
	type Range,
	type Selection,
} from '@/features/files/components/file-viewer/sheet-viewer/model'
import {SheetTabs} from '@/features/files/components/file-viewer/sheet-viewer/sheet-tabs'
import {useDocument} from '@/features/files/components/file-viewer/sheet-viewer/use-document'
import {XlsxDocument} from '@/features/files/components/file-viewer/sheet-viewer/xlsx-document'
import {
	useViewerDetail,
	useViewerEscape,
	useViewerSave,
	ViewerTools,
} from '@/features/files/components/file-viewer/shell/context'
import {FindPill} from '@/features/files/components/file-viewer/shell/find-pill'
import {
	stageButtonClass,
	StageDownload,
	StageLoading,
	StageMessage,
	StageNotice,
	useApproximationNotice,
	useShortScreen,
} from '@/features/files/components/file-viewer/shell/stage-states'
import {useFileBytes} from '@/features/files/components/file-viewer/shell/use-file-bytes'
import type {ViewerProps} from '@/features/files/components/file-viewer/viewers'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import type {FileSystemItem} from '@/features/files/types'
import {LightboxButton} from '@/features/photos/components/viewer/lightbox-button'
import {cn} from '@/lib/utils'
import {isBeneathModal} from '@/utils/is-beneath-modal'
import {tw} from '@/utils/tw'

// What a file may weigh before it's downloaded to be shown: the file is held
// whole while open, and a phone has far less room for it
const MAX_BYTES = {
	csv: {desktop: 512 * 2 ** 20, touch: 128 * 2 ** 20},
	xlsx: {desktop: 256 * 2 ** 20, touch: 64 * 2 ** 20},
}
// Cells a workbook may unpack to: about 13 bytes each, kept while it's open
const MAX_CELLS = {desktop: 10_000_000, touch: 2_500_000}
// The room the sheet tabs take over the grid's bottom
const TABS_INSET = 64
// Undo and redo arrive with the first edit, as the shell's Save does
const appear = tw`motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95`
// What the formula bar says about a cell that can't be typed into
const LOCKS = {
	array: 'files-sheet.locked-cell',
	table: 'files-sheet.table-cell',
	protected: 'files-sheet.protected-cell',
} satisfies Record<Lock, string>

type SheetFileDocument = CsvDocument | XlsxDocument

const isCsv = (item: FileSystemItem) => item.type === 'text/csv' || item.type === 'text/tab-separated-values'

// A cell as one number (no sheet here is 2^24 columns wide, as a CSV's columns aren't held to a workbook's)
const matchKey = (row: number, col: number) => row * 2 ** 24 + col

// Where a sheet opens: its first cell that isn't hidden
const firstCell = ({rows, cols}: GridSource): Selection => {
	const cell = {row: visibleLine(rows, 0, 1), col: visibleLine(cols, 0, 1)}
	return {anchor: cell, focus: cell}
}

export default function SheetViewer({item, mode}: ViewerProps) {
	const {t} = useTranslation()
	const isTouch = useIsTouchDevice()
	// Trying again starts over: the bytes went to the worker that failed
	const [attempt, setAttempt] = useState(0)
	if ((item.size ?? 0) > MAX_BYTES[isCsv(item) ? 'csv' : 'xlsx'][isTouch ? 'touch' : 'desktop']) {
		return (
			<StageMessage item={item} title={t('files-sheet.too-large-title')} detail={t('files-sheet.too-large-detail')}>
				<StageDownload item={item} />
			</StageMessage>
		)
	}
	return <SheetFile key={attempt} item={item} mode={mode} onRetry={() => setAttempt((count) => count + 1)} />
}

function SheetFile({item, mode, onRetry}: ViewerProps & {onRetry: () => void}) {
	const {t} = useTranslation()
	const file = useFileBytes(item)
	const isTouch = useIsTouchDevice()
	// Let go before it's open, an open stops: its worker goes, and its pending calls fail
	const opened = useDocument<SheetFileDocument>(
		file.status === 'ready' ? file.bytes : undefined,
		async (bytes, signal) => {
			if (isCsv(item)) {
				const client = createCsvClient(
					new Worker(new URL('./engine/csv/csv.worker.ts', import.meta.url), {type: 'module'}),
				)
				signal.addEventListener('abort', client.dispose, {once: true})
				return CsvDocument.open(client, bytes, item.name, item.type!).catch((error: unknown) => {
					client.dispose()
					throw error
				})
			}
			const client = createXlsxClient(
				new Worker(new URL('./engine/xlsx/xlsx.worker.ts', import.meta.url), {type: 'module'}),
			)
			signal.addEventListener('abort', client.dispose, {once: true})
			try {
				const document = await XlsxDocument.open(client, bytes, MAX_CELLS[isTouch ? 'touch' : 'desktop'], item.type!)
				// A canvas draws with whatever face is there, so the workbook's arrive first
				await loadFonts(document.opened.styles.map((style) => style.font))
				return document
			} catch (error) {
				client.dispose()
				throw error
			}
		},
	)

	if (file.status === 'error') {
		const missing = file.error === 'not-found'
		return (
			<StageMessage
				item={item}
				title={t(missing ? 'files-sheet.missing-title' : 'files-sheet.unreachable-title')}
				detail={t(missing ? 'files-viewer.missing-detail' : 'files-viewer.unreachable-detail')}
			>
				{!missing && (
					<button type='button' className={stageButtonClass} onClick={file.retry}>
						{t('try-again')}
					</button>
				)}
			</StageMessage>
		)
	}
	if (opened && 'error' in opened) {
		const {error} = opened
		// Only an XlsxError blames the file (a CSV opens whatever it holds): anything
		// else, like the worker failing to load, may well pass on a second try
		if (!(error instanceof XlsxError)) {
			return (
				<StageMessage
					item={item}
					title={t('files-sheet.unreachable-title')}
					detail={t('files-viewer.unreachable-detail')}
				>
					<button type='button' className={stageButtonClass} onClick={onRetry}>
						{t('try-again')}
					</button>
				</StageMessage>
			)
		}
		const [title, detail] = {
			corrupt: ['files-sheet.damaged-title', 'files-sheet.damaged-detail'],
			encrypted: ['files-sheet.encrypted-title', 'files-sheet.encrypted-detail'],
			unsupported: ['files-sheet.unsupported-title', 'files-sheet.unsupported-detail'],
			limits: ['files-sheet.too-large-title', 'files-sheet.too-large-detail'],
		}[error.code]
		return (
			<StageMessage item={item} title={t(title)} detail={t(detail)}>
				<StageDownload item={item} />
			</StageMessage>
		)
	}
	if (file.status !== 'ready' || !opened) return <StageLoading item={item} />
	return <SheetStage item={item} mode={mode} document={opened.document} revision={file.revision} />
}

type Find = {query: string; matches: Cell[]; current: number; searching: boolean}

function SheetStage({
	item,
	mode,
	document: doc,
	revision: openedRevision,
}: ViewerProps & {document: SheetFileDocument; revision: string | undefined}) {
	const {t} = useTranslation()
	useSyncExternalStore(doc.subscribe, () => doc.version)
	const readOnlyFiles = useIsFilesReadOnly()
	const writable = mode === 'open' && !readOnlyFiles && item.operations.includes('writable')
	useLayoutEffect(() => {
		doc.setEditable(writable)
	}, [doc, writable])
	const csv = doc instanceof CsvDocument ? doc : undefined
	const xlsx = doc instanceof XlsxDocument ? doc : undefined
	const editable = doc.editable
	const source = doc.source
	const sheetIndex = xlsx?.activeSheet ?? 0
	const chartSheet = xlsx?.opened.sheets[sheetIndex]?.kind === 'chartsheet'
	const short = useShortScreen()

	const [revision, setRevision] = useState(openedRevision)
	const [selections] = useState(() => new Map<number, Selection>())
	const [selection, setSelection] = useState(() => firstCell(source))
	const [editing, setEditing] = useState<Editing>()
	const [revealKey, setRevealKey] = useState(0)
	const [painted, setPainted] = useState(false)
	const [find, setFind] = useState<Find>()
	const [utf8, setUtf8] = useState<{char: string; answer: (convert: boolean) => void}>()
	const utf8From = useRef<Element | null>(null)
	const focusGrid = useRef<(() => void) | null>(null)
	const findInput = useRef<HTMLInputElement>(null)
	const barInput = useRef<HTMLTextAreaElement>(null)
	const stageRef = useRef<HTMLDivElement>(null)
	const findRun = useRef<AbortController>(undefined)
	// The sheet the last search ran on: another one is searched afresh
	const foundOn = useRef(sheetIndex)
	const committing = useRef<{typing: Editing; written: Promise<boolean>}>(undefined)

	// The selection stays on the sheet, whatever the edits took away
	const {rows, cols} = source
	const clampCell = (cell: Cell) => ({
		row: Math.min(cell.row, Math.max(0, rows.count - 1)),
		col: Math.min(cell.col, Math.max(0, cols.count - 1)),
	})
	const shown: Selection = {anchor: clampCell(selection.anchor), focus: clampCell(selection.focus)}
	const range = selectionRange(shown, source)
	const active = shown.anchor
	// A merge selected is one cell, named by its top-left
	const selectsOne = sameRange(range, areaAt(source.merges, active.row, active.col))
	// What the formula bar shows, kept as the active cell's block arrives
	const activeInput = useSyncExternalStore(source.subscribe, () => source.cell(active.row, active.col)?.input ?? '')
	const data = {rows: doc.rowCount, cols: doc.colCount}

	// A merge is selected from its top-left cell, which names it and takes what's typed; whole rows or columns, from
	// a header, keep their anchor, as they aren't grown into merges. The sheet is the document's own: this can run
	// after a switch to another one.
	const selectCells = ({anchor, focus}: Selection, reveal = false) => {
		const merge = wholeLines(rangeOf({anchor, focus}), doc.source)
			? undefined
			: mergeAt(doc.source.merges, anchor.row, anchor.col)
		setSelection({anchor: merge ? {row: merge.top, col: merge.left} : anchor, focus})
		if (reveal) setRevealKey((key) => key + 1)
	}
	const selectRange = ({top, left, bottom, right}: Range) =>
		selectCells({anchor: {row: top, col: left}, focus: {row: bottom, col: right}}, true)

	// Asked when a character typed into a Windows-1252 file has no place in it
	const confirmUtf8 = (char: string) => new Promise<boolean>((answer) => setUtf8({char, answer}))
	const answerUtf8 = (convert: boolean) => {
		utf8?.answer(convert)
		setUtf8(undefined)
	}

	// Why the worker turned an edit away: a workbook it can't read all of can't be calculated, which every edit needs
	const refusal = (error: unknown) =>
		t(
			!(error instanceof XlsxError)
				? 'files-sheet.edit-failed'
				: error.code === 'limits'
					? 'files-sheet.edit-too-large'
					: 'files-sheet.edit-damaged',
		)
	const refused = (error: unknown) => void toast.error(refusal(error), {area: 'files'})
	// Why a cell can't be changed, said where any screen shows it (a tooltip never opens on a touch one), and said
	// once however often it's asked
	const explain = (reason: string) => void toast.info(reason, {id: 'files-sheet-lock', area: 'files'})
	// A paste or clear passes over locked cells: said, so what changed isn't taken for all of it
	const passedOver = (skipped: number) => {
		if (skipped) explain(t('files-sheet.locked-skipped', {count: skipped}))
	}

	// Writes what's typed into the cell and moves on. Resolves to whether it
	// was written: a formula that doesn't parse, or isn't taken, stays open, saying so.
	const write = async (typing: Editing, move: {rows: number; cols: number}) => {
		const {cell, draft, original} = typing
		// Enter and Tab move on from the cell (in the sheet as the edit left it:
		// typing past the last row or column adds another); a click elsewhere has
		// already selected where it went
		const moveOn = () => {
			setEditing(undefined)
			if (!move.rows && !move.cols) return
			const to = step(doc.source, cell, move.rows, move.cols)
			selectCells({anchor: to, focus: to}, true)
			focusGrid.current?.()
		}
		if (draft === original) {
			moveOn()
			return true
		}
		const problem = csv?.problem([draft])
		if (problem?.kind === 'unquotable') {
			setEditing({...typing, error: t('files-sheet.unquotable')})
			return false
		}
		if (problem?.kind === 'encoding') {
			if (!(await confirmUtf8(problem.char))) {
				// Not answered for good: the next Enter or save asks again
				committing.current = undefined
				return false
			}
			csv!.convertToUtf8()
		}
		const writing = doc.commit([{...cell, input: draft}], true)
		// A value shows at once; a formula is checked first
		if (!xlsx || !draft.startsWith('=')) {
			moveOn()
			void writing.catch(refused)
			return true
		}
		try {
			await writing
			moveOn()
			return true
		} catch (error) {
			setEditing(
				error instanceof FormulaSyntaxError
					? {...typing, error: t('files-sheet.formula-error'), caret: Math.min(error.position, draft.length)}
					: {...typing, error: refusal(error)},
			)
			return false
		}
	}
	// A second Enter, or focus moving on, while a formula is checked waits for the same write
	const commit = (move = {rows: 0, cols: 0}) => {
		if (!editing) return Promise.resolve(true)
		if (committing.current?.typing !== editing) committing.current = {typing: editing, written: write(editing, move)}
		return committing.current.written
	}

	const paste = async (pasted: string[][]) => {
		const {anchor} = shown
		const single = pasted.length === 1 && pasted[0].length === 1
		const cells: Array<Cell & {input: string}> = []
		// One value pasted over a range fills it (a merge is one cell)
		if (single && !selectsOne) {
			// Over whole rows or columns, as far as the data goes
			const bottom = range.bottom >= rows.count - 1 ? Math.max(range.top, data.rows - 1) : range.bottom
			const right = range.right >= cols.count - 1 ? Math.max(range.left, data.cols - 1) : range.right
			for (let row = range.top; row <= bottom; row++) {
				for (let col = range.left; col <= right; col++) cells.push({row, col, input: pasted[0][0]})
			}
		} else {
			// Past the last row or column, the sheet grows (a workbook as far as Excel's own sheets go)
			pasted.forEach((values, r) =>
				values.forEach((input, c) => {
					const cell = {row: anchor.row + r, col: anchor.col + c}
					if (!xlsx || (cell.row < MAX_ROWS && cell.col < MAX_COLS)) cells.push({...cell, input})
				}),
			)
		}
		if (!cells.length) return
		const problem = csv?.problem(cells.map((cell) => cell.input))
		if (problem?.kind === 'unquotable') return void toast.error(t('files-sheet.unquotable'), {area: 'files'})
		if (problem?.kind === 'encoding') {
			if (!(await confirmUtf8(problem.char))) return
			csv!.convertToUtf8()
		}
		// Locked cells are the worker's to pass over: it knows every cell's style, and here only the blocks fetched
		// for drawing are known
		try {
			passedOver(await doc.commit(cells, false))
		} catch (error) {
			return refused(error)
		}
		selectRange(bounds(cells))
	}

	const undoOrRedo = async (redo: boolean) => {
		const changed = await (redo ? doc.redo() : doc.undo())
		if (changed) selectRange(changed)
	}

	// Find runs over the whole sheet in the worker, a slice at a time, and the
	// grid lights up every match found so far. A new search goes to its first
	// match; one run again after an edit swaps in its matches once it's done,
	// keeping the current one.
	const runFind = (query: string, fresh = true) => {
		findRun.current?.abort()
		const run = new AbortController()
		findRun.current = run
		if (fresh) setFind({query, matches: [], current: 0, searching: !!query})
		if (!query) return
		let first = fresh
		doc.find(query, run.signal, ({matches, done}) => {
			if (!fresh && !done) return
			setFind((now) => {
				if (now?.query !== query) return now
				const kept = now.matches[now.current - 1]
				const at = kept ? matches.findIndex((cell) => cell.row === kept.row && cell.col === kept.col) : -1
				const current = at >= 0 ? at + 1 : Math.min(now.current || 1, matches.length)
				return {...now, matches, current, searching: !done}
			})
			if (first && matches.length) {
				first = false
				selectCells({anchor: matches[0], focus: matches[0]}, true)
			}
		})
	}
	const goToMatch = (direction: 1 | -1) => {
		if (!find?.matches.length) return
		const current = ((find.current - 1 + direction + find.matches.length) % find.matches.length) + 1
		setFind({...find, current})
		const cell = find.matches[current - 1]
		selectCells({anchor: cell, focus: cell}, true)
	}
	const openFind = () => {
		setFind((now) => now ?? {query: '', matches: [], current: 0, searching: false})
		// Open already: back to its field, its text ready to type over
		findInput.current?.focus()
		findInput.current?.select()
	}
	const closeFind = () => {
		findRun.current?.abort()
		setFind(undefined)
		focusGrid.current?.()
	}
	// Edits change what's found, once they've landed (a value typed shows before it has): a burst of them searches
	// once, after the last. Another sheet is searched afresh.
	const findQuery = find?.query
	useEffect(() => {
		const fresh = foundOn.current !== sheetIndex
		foundOn.current = sheetIndex
		if (!findQuery) return
		if (fresh) return void runFind(findQuery, true)
		const timer = setTimeout(() => runFind(findQuery, false), 200)
		return () => clearTimeout(timer)
	}, [doc.changes, sheetIndex])
	useEffect(() => () => findRun.current?.abort(), [])
	// Made once per search's matches, as numbers: the grid asks about every cell it draws, on every frame
	const matchKeys = useMemo(() => new Set(find?.matches.map((cell) => matchKey(cell.row, cell.col))), [find?.matches])
	const currentMatch = find?.matches[find.current - 1]
	const match = (row: number, col: number) =>
		!matchKeys.size
			? 0
			: currentMatch?.row === row && currentMatch.col === col
				? 2
				: matchKeys.has(matchKey(row, col))
					? 1
					: 0

	// ⌘F finds, wherever the focus is in the viewer
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (isBeneathModal(stageRef.current, event)) return
			if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') {
				event.preventDefault()
				openFind()
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	})

	// Resolves to whether the sheet is shown: what's being typed may not be
	// written, and a sheet is read when first shown, which can fail on its own
	const selectSheet = async (index: number) => {
		if (!xlsx || !(await commit())) return false
		if (index === xlsx.activeSheet) return true
		selections.set(xlsx.activeSheet, selection)
		try {
			await xlsx.select(index)
		} catch (error) {
			const tooLarge = error instanceof XlsxError && error.code === 'limits'
			const sheet = xlsx.opened.sheets[index].name
			toast.error(t(tooLarge ? 'files-sheet.sheet-too-large' : 'files-sheet.sheet-unreadable', {sheet}), {
				area: 'files',
			})
			return false
		}
		// The sheet gets a grid of its own, which shows this selection once it has a size
		setSelection(selections.get(index) ?? firstCell(xlsx.source))
		return true
	}

	useViewerEscape(() => {
		if (editing) {
			setEditing(undefined)
			focusGrid.current?.()
			return true
		}
		if (find) {
			closeFind()
			return true
		}
		// Out of the formula bar or the name box, back to the grid
		const focused = document.activeElement
		if (focused?.closest('[data-formula-bar]')) {
			focusGrid.current?.()
			return true
		}
		// The editor waiting over the active cell holds the keyboard, but
		// nothing is being typed into it: it lets go, and the viewer closes
		if (focused instanceof HTMLElement && focused.dataset.cellEditor !== undefined) focused.blur()
		return false
	})

	const visibleSheets =
		xlsx?.opened.sheets.flatMap((sheet, index) => (sheet.state === 'visible' ? [{index, name: sheet.name}] : [])) ?? []
	useViewerDetail(
		visibleSheets.length > 1
			? t('files-sheet.sheets', {count: visibleSheets.length})
			: t('files-sheet.rows', {count: doc.rowCount}),
	)

	const draftChanged = !!editing && editing.draft !== editing.original
	// Saving is the file's, whichever sheet is shown: a chart sheet takes no edits, but the worksheets' still wait
	// to be saved (a CSV cut short isn't editable, since it can't be saved whole)
	useViewerSave(
		(xlsx ? writable : editable)
			? {
					revision,
					// What's being typed is part of what's saved
					serialize: async () => {
						if (!(await commit())) throw new Error('The cell being edited can’t be written')
						return doc.serialize()
					},
					onSaved: (saved) => {
						setRevision(saved)
						doc.saved()
					},
				}
			: null,
		doc.dirty || draftChanged,
	)

	// What the sheet doesn't show, named as the other viewers name it, and said without a save where there's none
	const sheet = xlsx && !chartSheet ? xlsx.sheet : undefined
	const approximated = useApproximationNotice(
		new Set(
			[
				sheet?.hasCharts && ('charts' as const),
				// Charts sit in drawings too: a drawing is only known to hold more when there are none
				sheet?.hasDrawings && !sheet.hasCharts && ('drawings' as const),
				sheet?.hasConditionalFormats && ('formatting' as const),
				sheet?.hasComments && ('comments' as const),
			].filter((kind) => !!kind),
		),
		editable,
	)
	const notice = (() => {
		if (csv?.opened.truncated) return t('files-sheet.notice-truncated')
		if (!xlsx || chartSheet) return undefined
		const said = [
			// A protected sheet says so first, as only some of its cells take what's typed
			editable && xlsx.sheet.protected && t('files-sheet.notice-protected'),
			// Macros, on their own, with what a save does to them; before what isn't shown, whose sentence says it
			xlsx.opened.hasMacros &&
				t(editable && !approximated ? 'files-sheet.notice-macros' : 'files-sheet.notice-macros-read-only'),
			approximated,
		].filter(Boolean)
		return said.length ? said.join(' ') : undefined
	})()

	const hyperlinkAt = (row: number, col: number) => doc.hyperlinks.find((link) => inRange(link.range, row, col))
	// A web address opens in a new tab; a place in the workbook is selected
	const follow = (hyperlink: Hyperlink) => {
		if (hyperlink.url) return void window.open(hyperlink.url, '_blank', 'noopener,noreferrer')
		const place = placeOf(hyperlink.location!)
		// As in Excel, a link finds its sheet whatever the case of its name, and never opens a hidden one
		const name = place?.sheet?.toUpperCase()
		const index =
			name === undefined
				? sheetIndex
				: xlsx?.opened.sheets.findIndex((sheet) => sheet.state === 'visible' && sheet.name.toUpperCase() === name)
		if (!place || index === undefined || index < 0) return
		void selectSheet(index).then((shown) => shown && selectRange(place.range))
	}
	const hyperlink = hyperlinkAt(active.row, active.col)
	const locked = editable ? doc.locked(active.row, active.col) : undefined
	// The formula bar's link and the chip on the cell
	const link = hyperlink && {label: hyperlink.url ?? hyperlink.location ?? '', open: () => follow(hyperlink)}

	const menu = (target: MenuTarget) => {
		const {selection: picked} = target
		const rowsPicked = picked.bottom - picked.top + 1
		const colsPicked = picked.right - picked.left + 1
		const structure = csv && editable
		// A cell's link, followed from its menu as in Excel, quick look too, where there's no formula bar
		const linked = target.zone === 'cell' ? hyperlinkAt(picked.top, picked.left) : undefined
		return (
			<>
				{linked && (
					<>
						<ContextMenuItem onSelect={() => follow(linked)}>{t('files-sheet.open-link')}</ContextMenuItem>
						<ContextMenuSeparator />
					</>
				)}
				<ContextMenuItem onSelect={() => document.execCommand('copy')}>{t('files-sheet.copy')}</ContextMenuItem>
				{editable && (
					<>
						<ContextMenuItem onSelect={() => document.execCommand('cut')}>{t('files-sheet.cut')}</ContextMenuItem>
						<ContextMenuItem onSelect={() => void doc.clear(picked).then(passedOver, refused)}>
							{t('files-sheet.clear')}
						</ContextMenuItem>
					</>
				)}
				{structure && target.zone !== 'col' && (
					<>
						<ContextMenuSeparator />
						<ContextMenuItem onSelect={() => csv.insertRows(picked.top, rowsPicked)}>
							{t('files-sheet.insert-rows-above', {count: rowsPicked})}
						</ContextMenuItem>
						<ContextMenuItem onSelect={() => csv.insertRows(picked.bottom + 1, rowsPicked)}>
							{t('files-sheet.insert-rows-below', {count: rowsPicked})}
						</ContextMenuItem>
						<ContextMenuItem onSelect={() => csv.deleteRows(picked.top, rowsPicked)}>
							{t('files-sheet.delete-rows', {count: rowsPicked})}
						</ContextMenuItem>
					</>
				)}
				{structure && target.zone !== 'row' && (
					<>
						<ContextMenuSeparator />
						<ContextMenuItem onSelect={() => csv.insertColumns(picked.left, colsPicked)}>
							{t('files-sheet.insert-columns-left', {count: colsPicked})}
						</ContextMenuItem>
						<ContextMenuItem onSelect={() => csv.insertColumns(picked.right + 1, colsPicked)}>
							{t('files-sheet.insert-columns-right', {count: colsPicked})}
						</ContextMenuItem>
						<ContextMenuItem onSelect={() => csv.deleteColumns(picked.left, colsPicked)}>
							{t('files-sheet.delete-columns', {count: colsPicked})}
						</ContextMenuItem>
					</>
				)}
			</>
		)
	}

	const empty = !editable && csv && csv.rowCount === 0
	const tabs = visibleSheets.length > 1

	return (
		<>
			<ViewerTools>
				{editable && (doc.canUndo || doc.canRedo) && (
					<>
						{/* As in Excel, a cell being typed into is finished first */}
						<LightboxButton
							icon={Undo2}
							label={t('files-viewer.undo')}
							disabled={!doc.canUndo || !!editing}
							onClick={() => void undoOrRedo(false)}
							className={appear}
						/>
						<LightboxButton
							icon={Redo2}
							label={t('files-viewer.redo')}
							disabled={!doc.canRedo || !!editing}
							onClick={() => void undoOrRedo(true)}
							className={appear}
						/>
					</>
				)}
				{!empty && !chartSheet && (
					<LightboxButton
						icon={Search}
						label={t('files-viewer.find')}
						active={!!find}
						onClick={() => (find ? closeFind() : openFind())}
					/>
				)}
			</ViewerTools>

			<div
				ref={stageRef}
				// Moving on to anything else here (find, the name box, a tab, the menu) finishes the cell being typed
				// into, as a click on another cell does; the grid and the formula bar carry on with it
				onFocus={(event) => {
					const target = event.target as Element
					if (target !== barInput.current && !target.closest('[role="grid"], [data-cell-editor]')) void commit()
				}}
				className='flex min-h-0 flex-1 flex-col gap-2 px-4 md:px-6'
			>
				{mode === 'open' && !empty && !chartSheet && (
					<div
						data-formula-bar
						className={cn(
							'transition-opacity duration-300 motion-reduce:transition-none',
							painted ? 'opacity-100' : 'opacity-0',
						)}
					>
						<FormulaBar
							reference={selectsOne ? refName(active.row, active.col) : rangeName(range)}
							value={editing ? editing.draft : activeInput}
							editable={editable && !locked}
							lockedReason={
								!writable
									? t('files-sheet.read-only')
									: locked
										? t(LOCKS[locked])
										: csv?.opened.truncated
											? t('files-sheet.notice-truncated')
											: undefined
							}
							onExplain={explain}
							error={editing?.error}
							link={link}
							inputRef={barInput}
							onType={(draft) =>
								setEditing((now) =>
									now
										? {...now, draft, error: undefined, caret: undefined}
										: {cell: active, draft, original: activeInput, replace: false},
								)
							}
							onCommit={(move) => void commit(move)}
							onGo={(reference) => {
								const target = parseRange(reference)
								if (!target) return false
								// What's being typed is written first: a formula that doesn't parse keeps its cell, saying why
								void commit().then((written) => {
									if (!written) return
									selectRange(target)
									focusGrid.current?.()
								})
								return true
							}}
						/>
					</div>
				)}
				<div className='group/area relative min-h-0 flex-1'>
					{empty ? (
						<StageMessage
							item={item}
							title={t('files-sheet.empty-title')}
							detail={t('files-sheet.empty-detail')}
							className='h-full'
						/>
					) : chartSheet ? (
						<StageMessage
							item={item}
							title={t('files-sheet.chart-sheet-title')}
							detail={t('files-sheet.chart-sheet-detail')}
							className='h-full'
						/>
					) : (
						<div
							className={cn(
								'size-full transition-opacity duration-300 motion-reduce:transition-none',
								painted ? 'opacity-100' : 'opacity-0',
								// While find or the notice is up the grid starts below it, rather than hide its first rows
								// (and find's match) under it; on a phone the notice takes three lines
								find ? 'pt-20' : !short && 'group-has-[[role=status]]/area:pt-24',
							)}
						>
							<Grid
								key={sheetIndex}
								source={source}
								label={xlsx ? (xlsx.opened.sheets[sheetIndex]?.name ?? item.name) : item.name}
								selection={shown}
								onSelect={selectCells}
								interactive={mode === 'open'}
								editable={editable}
								locked={(row, col) => !!doc.locked(row, col)}
								onRefused={(cell) => {
									const lock = doc.locked(cell.row, cell.col)
									if (lock) explain(t(LOCKS[lock]))
								}}
								data={data}
								editing={editing}
								onEdit={setEditing}
								onCommit={commit}
								match={match}
								onClear={(cleared) => void doc.clear(cleared).then(passedOver, refused)}
								onUndo={() => void undoOrRedo(false)}
								onRedo={() => void undoOrRedo(true)}
								onEdge={(from, direction) => doc.edge(from, direction)}
								texts={(picked) => doc.texts(picked)}
								fetchTexts={(picked) => doc.fetchTexts(picked)}
								onPaste={(pasted) => void paste(pasted)}
								menu={menu}
								bottomInset={tabs ? TABS_INSET : 0}
								revealKey={revealKey}
								onPainted={() => setPainted(true)}
								focusRef={focusGrid}
								link={link}
								onSheetStep={
									tabs
										? (by) => {
												const at = visibleSheets.findIndex((sheet) => sheet.index === sheetIndex)
												const next = visibleSheets[at + by]
												if (next) void selectSheet(next.index)
											}
										: undefined
								}
							/>
						</div>
					)}
					{!painted && !empty && !chartSheet && (
						<div className='absolute inset-0 flex'>
							<StageLoading item={item} />
						</div>
					)}
					{/* Find takes the top while it's open. A phone on its side leaves the notice out: with no height
					    to spare, it would sit on the rows. */}
					{notice && painted && (
						<div className={cn((find || short) && 'hidden')}>
							<StageNotice key={notice}>{notice}</StageNotice>
						</div>
					)}
					{find && (
						<FindPill
							inputRef={findInput}
							query={find.query}
							onQuery={(query) => runFind(query)}
							current={find.current}
							total={find.matches.length}
							searching={find.searching}
							onNext={() => goToMatch(1)}
							onPrevious={() => goToMatch(-1)}
							onClose={closeFind}
						/>
					)}
					{tabs && (
						<SheetTabs sheets={visibleSheets} active={sheetIndex} onSelect={(index) => void selectSheet(index)} />
					)}
				</div>
			</div>

			<AlertDialog open={!!utf8} onOpenChange={(open) => !open && answerUtf8(false)}>
				<AlertDialogContent
					// The keyboard goes back to where it was asked from: the cell, or where the edit was left for
					onOpenAutoFocus={() => void (utf8From.current = document.activeElement)}
					onCloseAutoFocus={(event) => {
						event.preventDefault()
						if (utf8From.current instanceof HTMLElement) utf8From.current.focus({preventScroll: true})
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('files-sheet.utf8-title')}</AlertDialogTitle>
						<AlertDialogDescription>{t('files-sheet.utf8-description', {char: utf8?.char})}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction onClick={() => answerUtf8(true)}>{t('files-sheet.utf8-confirm')}</AlertDialogAction>
						<AlertDialogAction variant='default' onClick={() => answerUtf8(false)}>
							{t('cancel')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
