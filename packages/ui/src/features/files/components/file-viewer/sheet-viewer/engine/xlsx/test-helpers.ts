// Shared by the XLSX engine's tests: workbooks built in code, so each test
// controls exactly the structure it exercises and none needs the corpus

import {patchZip, ZipArchive} from '../../../shared/zip'

// A corpus of real-world documents (FILES_FIXTURES=<dir>) adds them to the suite; without one, those tests skip
export const FIXTURES = process.env.FILES_FIXTURES ?? ''

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_R = 'http://schemas.openxmlformats.org/package/2006/relationships'
const TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types'
const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

// An archive holding just an end-of-central-directory record, to append entries to
const EMPTY_ZIP = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array<number>(18).fill(0)])

export function zip(entries: Record<string, string | Uint8Array>): Promise<Uint8Array> {
	return patchZip(ZipArchive.open(EMPTY_ZIP), new Map(Object.entries(entries)))
}

export const worksheet = (sheetData: string, {before = '', after = ''} = {}) =>
	`${DECLARATION}<worksheet xmlns="${MAIN}" xmlns:r="${R}">${before}<sheetData>${sheetData}</sheetData>${after}</worksheet>`

export const sharedStrings = (...items: string[]) =>
	`${DECLARATION}<sst xmlns="${MAIN}" count="${items.length}" uniqueCount="${items.length}">${items
		.map((item) => (item.startsWith('<') ? `<si>${item}</si>` : `<si><t>${item}</t></si>`))
		.join('')}</sst>`

export const styleSheet = (inner: string) => `${DECLARATION}<styleSheet xmlns="${MAIN}">${inner}</styleSheet>`

const relationship = (id: string, type: string, target: string, external = false) =>
	`<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`

export const relationships = (...rels: Array<[id: string, type: string, target: string, external?: boolean]>) =>
	`${DECLARATION}<Relationships xmlns="${PACKAGE_R}">${rels.map((rel) => relationship(...rel)).join('')}</Relationships>`

export type SheetSpec = {
	xml: string
	name?: string
	state?: string
	rels?: string // the sheet's own relationships part
	chartsheet?: boolean
}

export type WorkbookSpec = {
	sheets: Array<string | SheetSpec>
	sharedStrings?: string
	styles?: string
	theme?: string
	// Inside <workbook>, around <sheets>
	before?: string
	after?: string
	calcChain?: string
	// More of the workbook's relationships, as [type, target]
	rels?: Array<[type: string, target: string]>
	extra?: Record<string, string | Uint8Array>
}

export function workbook(spec: WorkbookSpec): Promise<Uint8Array> {
	const sheets = spec.sheets.map((sheet) => (typeof sheet === 'string' ? {xml: sheet} : sheet))
	const entries: Record<string, string | Uint8Array> = {}
	const overrides: string[] = []
	const rels: Array<[string, string, string]> = []
	const override = (part: string, type: string) =>
		overrides.push(
			`<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.${type}"/>`,
		)

	sheets.forEach((sheet, i) => {
		const folder = sheet.chartsheet ? 'chartsheets' : 'worksheets'
		const part = `xl/${folder}/sheet${i + 1}.xml`
		entries[part] = sheet.xml
		if (sheet.rels) entries[`xl/${folder}/_rels/sheet${i + 1}.xml.rels`] = sheet.rels
		rels.push([`rId${i + 1}`, sheet.chartsheet ? 'chartsheet' : 'worksheet', `${folder}/sheet${i + 1}.xml`])
		override(part, `spreadsheetml.${sheet.chartsheet ? 'chartsheet' : 'worksheet'}+xml`)
	})
	const parts: Array<[keyof WorkbookSpec, string, string, string]> = [
		['styles', 'styles', 'styles.xml', 'spreadsheetml.styles+xml'],
		['sharedStrings', 'sharedStrings', 'sharedStrings.xml', 'spreadsheetml.sharedStrings+xml'],
		['theme', 'theme', 'theme/theme1.xml', 'theme+xml'],
		['calcChain', 'calcChain', 'calcChain.xml', 'spreadsheetml.calcChain+xml'],
	]
	for (const [key, type, target, contentType] of parts) {
		const xml = spec[key]
		if (typeof xml !== 'string') continue
		entries[`xl/${target}`] = xml
		rels.push([`rId${rels.length + 1}`, type, target])
		override(`xl/${target}`, contentType)
	}
	for (const [type, target] of spec.rels ?? []) rels.push([`rId${rels.length + 1}`, type, target])
	const sheetList = sheets
		.map(
			(sheet, i) =>
				`<sheet name="${sheet.name ?? `Sheet${i + 1}`}" sheetId="${i + 1}"${sheet.state ? ` state="${sheet.state}"` : ''} r:id="rId${i + 1}"/>`,
		)
		.join('')
	entries['xl/workbook.xml'] =
		`${DECLARATION}<workbook xmlns="${MAIN}" xmlns:r="${R}">${spec.before ?? '<workbookPr/>'}<sheets>${sheetList}</sheets>${spec.after ?? ''}</workbook>`
	entries['xl/_rels/workbook.xml.rels'] = relationships(...rels)
	entries['_rels/.rels'] = relationships(['rId1', 'officeDocument', 'xl/workbook.xml'])
	entries['[Content_Types].xml'] =
		`${DECLARATION}<Types xmlns="${TYPES}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides.join('')}</Types>`
	return zip({...entries, ...spec.extra})
}
