// Builds small .pptx packages in tests, so hostile and edge cases don't depend on the fixture corpus, and reads
// text back out of slide models

import {patchZip, ZipArchive} from '@/features/files/components/file-viewer/shared/zip'
import type {
	Paragraph,
	SlideElement,
	TextBody,
} from '@/features/files/components/file-viewer/slides-viewer/engine/model'

const NS =
	'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
	'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
	'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'

export const rels = (items: Array<[id: string, type: string, target: string, external?: boolean]>) =>
	'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
	'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
	items
		.map(
			([id, type, target, external]) =>
				`<Relationship Id="${id}" Type="${type.includes('/') ? type : REL + type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`,
		)
		.join('') +
	'</Relationships>'

const THEME =
	`<a:theme ${NS} name="Test"><a:themeElements><a:clrScheme name="Test">` +
	'<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
	'<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
	'<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' +
	'<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
	'<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
	'<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>' +
	'<a:fontScheme name="Test"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
	'<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
	'<a:fmtScheme name="Test"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
	'<a:solidFill><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:solidFill>' +
	'<a:solidFill><a:schemeClr val="phClr"><a:shade val="50000"/></a:schemeClr></a:solidFill></a:fillStyleLst>' +
	'<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
	'<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
	'<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
	'<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>' +
	'<a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000" rotWithShape="0">' +
	'<a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst>' +
	'<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
	'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>'

// The master's text styles: 44 pt centred titles in the major font, bulleted body text in the minor font
const TEXT_STYLES =
	'<p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>' +
	'<a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>' +
	'<p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600"><a:buFont typeface="Arial"/><a:buChar char="•"/>' +
	'<a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>' +
	'<a:lvl2pPr marL="685800" indent="-228600"><a:buFont typeface="Arial"/><a:buChar char="–"/><a:defRPr sz="2400"/></a:lvl2pPr></p:bodyStyle>' +
	'<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles>'

export const xfrm = (x: number, y: number, w: number, h: number, extra = '') =>
	`<a:xfrm${extra}><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`

export const placeholder = (
	type: string | undefined,
	idx: string | undefined,
	spPr: string,
	body = '',
	name = 'Placeholder',
) =>
	`<p:sp><p:nvSpPr><p:cNvPr id="2" name="${name}"/><p:cNvSpPr/><p:nvPr><p:ph${type ? ` type="${type}"` : ''}${idx ? ` idx="${idx}"` : ''}/></p:nvPr></p:nvSpPr>` +
	`<p:spPr>${spPr}</p:spPr>${body ? `<p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody>` : ''}</p:sp>`

export const shape = (spPr: string, body = '', style = '') =>
	`<p:sp><p:nvSpPr><p:cNvPr id="3" name="Shape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${spPr}</p:spPr>${style}` +
	`${body ? `<p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody>` : ''}</p:sp>`

export const slide = (tree: string, attributes = '') =>
	`<p:sld ${NS}${attributes}><p:cSld><p:spTree>${tree}</p:spTree></p:cSld></p:sld>`

export type DeckOptions = {
	slides: string[]
	layout?: string
	master?: string
	theme?: string
	slideRels?: Array<Array<[string, string, string, boolean?]>>
	parts?: Record<string, string | Uint8Array>
	presentation?: string
}

function deckParts({
	slides,
	layout = '',
	master = '',
	theme = THEME,
	slideRels = [],
	parts = {},
	presentation = '',
}: DeckOptions) {
	const files: Record<string, string | Uint8Array> = {
		'[Content_Types].xml':
			'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
			'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
			'<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
			'<Default Extension="emf" ContentType="image/x-emf"/><Default Extension="svg" ContentType="image/svg+xml"/></Types>',
		'_rels/.rels': rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]),
		'ppt/presentation.xml':
			`<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>` +
			slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 10}"/>`).join('') +
			`</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/>${presentation}</p:presentation>`,
		'ppt/_rels/presentation.xml.rels': rels([
			['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
			...slides.map((_, i): [string, string, string] => [`rId${i + 10}`, 'slide', `slides/slide${i + 1}.xml`]),
		]),
		'ppt/slideLayouts/slideLayout1.xml': `<p:sldLayout ${NS}><p:cSld><p:spTree>${layout}</p:spTree></p:cSld></p:sldLayout>`,
		'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]),
		'ppt/slideMasters/slideMaster1.xml':
			`<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${master}</p:spTree></p:cSld>` +
			'<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
			`${TEXT_STYLES}</p:sldMaster>`,
		'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels([
			['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
			['rId2', 'theme', '../theme/theme1.xml'],
		]),
		'ppt/theme/theme1.xml': theme,
	}
	slides.forEach((xml, i) => {
		files[`ppt/slides/slide${i + 1}.xml`] = xml
		files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = rels([
			['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
			...(slideRels[i] ?? []),
		])
	})
	return {...files, ...parts}
}

// A zip of these parts (an empty archive patched with every one of them)
export function zip(parts: Record<string, string | Uint8Array>): Promise<Uint8Array> {
	const empty = new Uint8Array(22)
	empty.set([0x50, 0x4b, 0x05, 0x06])
	return patchZip(ZipArchive.open(empty), new Map(Object.entries(parts)))
}

export const buildDeck = (options: DeckOptions) => zip(deckParts(options))

export const DECKS = [
	'Samples/PowerPoint/2411-Performance_Up.pptx',
	'Samples/PowerPoint/aiden-complex.pptx',
	'Samples/PowerPoint/chart-picture-bg.pptx',
	'Samples/PowerPoint/customGeo.pptx',
	'Samples/PowerPoint/deck.pptx',
	'Samples/PowerPoint/EmbeddedVideo.pptx',
	'Samples/PowerPoint/KEY02.pptx',
	'Samples/PowerPoint/smartart-simple.pptx',
	'Samples/PowerPoint/themes.pptx',
	'Samples2/PowerPoint/backgrounds-poi.pptx',
	'Samples2/PowerPoint/deck-4x3.pptx',
	'Samples2/PowerPoint/features-16x9.pptx',
	'Samples2/PowerPoint/japanese-text-poi.pptx',
	'Samples2/PowerPoint/long-40-slides.pptx',
	'Samples2/PowerPoint/preset-shapes-poi.pptx',
	'Samples2/PowerPoint/smartart-poi.pptx',
	'Samples2/PowerPoint/table-theme-mac-poi.pptx',
]

// Every element of a model, groups flattened
export function flatten(elements: SlideElement[]): SlideElement[] {
	return elements.flatMap((element) => [element, ...(element.kind === 'group' ? flatten(element.children) : [])])
}
const paragraphText = (paragraph: Paragraph) =>
	paragraph.runs.map((run) => (run.kind === 'break' ? '\n' : run.text)).join('')
const bodyText = (text: TextBody | undefined) => text?.paragraphs.map(paragraphText).join('\n') ?? ''
export function textOf(element: SlideElement): string {
	if (element.kind === 'shape') return bodyText(element.text)
	if (element.kind === 'table') return element.cells.map((cell) => bodyText(cell.text)).join('\n')
	if (element.kind === 'group') return element.children.map(textOf).join('\n')
	return element.label ?? ''
}

// The text a rendered slide shows, in document order: bullets, runs and field results, frame labels
export function shownText(elements: SlideElement[]): string {
	const body = (text: TextBody | undefined) =>
		text?.paragraphs
			.map((p) => (p.bullet?.text ?? '') + p.runs.map((run) => (run.kind === 'break' ? '' : run.text)).join(''))
			.join('') ?? ''
	return elements
		.map((element) => {
			if (element.kind === 'group') return shownText(element.children)
			if (element.kind === 'shape') return body(element.text)
			if (element.kind === 'table') return element.cells.map((cell) => body(cell.text)).join('')
			return element.label ?? ''
		})
		.join('')
}
