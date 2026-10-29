// Fixtures for the engine's tests: the shared corpus when it's there, and tiny packages built in code so the rules
// are covered without it

import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {deflateRawSync} from 'node:zlib'

import {crc32} from '@/features/files/components/file-viewer/shared/zip'

// A corpus of real-world documents (FILES_FIXTURES=<dir>) adds them to the suite; without one, those tests skip
export const FIXTURES = process.env.FILES_FIXTURES ?? ''

// Every .docx in the corpus, as paths relative to it
export const WORD_FIXTURES = ['Samples/Word', 'Samples2/Word'].flatMap((dir) =>
	FIXTURES && existsSync(join(FIXTURES, dir))
		? readdirSync(join(FIXTURES, dir))
				.filter((name) => name.endsWith('.docx'))
				.map((name) => `${dir}/${name}`)
		: [],
)

export const fixture = (path: string) => new Uint8Array(readFileSync(join(FIXTURES, path)))
export const hasFixture = (path: string) => WORD_FIXTURES.includes(path)

const encoder = new TextEncoder()

// A zip of stored entries, enough for a test package. Entries named in `deflate` are compressed; `aliases` add
// directory records under new names for entries already written, as a crafted file makes many parts of one stream.
export function zip(
	entries: Record<string, string | Uint8Array>,
	{deflate = [], aliases = {}}: {deflate?: string[]; aliases?: Record<string, string>} = {},
): Uint8Array {
	const locals: Uint8Array[] = []
	const centrals: Uint8Array[] = []
	const records = new Map<string, Uint8Array>()
	let offset = 0
	for (const [name, content] of Object.entries(entries)) {
		const raw = typeof content === 'string' ? encoder.encode(content) : content
		const method = deflate.includes(name) ? 8 : 0
		const data = method ? deflateRawSync(raw) : raw
		const nameBytes = encoder.encode(name)
		const crc = crc32(raw)
		const local = new Uint8Array(30 + nameBytes.length + data.length)
		const l = new DataView(local.buffer)
		l.setUint32(0, 0x04034b50, true)
		l.setUint16(4, 20, true)
		l.setUint16(6, 0x800, true)
		l.setUint16(8, method, true)
		l.setUint32(14, crc, true)
		l.setUint32(18, data.length, true)
		l.setUint32(22, raw.length, true)
		l.setUint16(26, nameBytes.length, true)
		local.set(nameBytes, 30)
		local.set(data, 30 + nameBytes.length)
		const central = new Uint8Array(46 + nameBytes.length)
		const c = new DataView(central.buffer)
		c.setUint32(0, 0x02014b50, true)
		c.setUint16(4, 20, true)
		c.setUint16(6, 20, true)
		c.setUint16(8, 0x800, true)
		c.setUint16(10, method, true)
		c.setUint32(16, crc, true)
		c.setUint32(20, data.length, true)
		c.setUint32(24, raw.length, true)
		c.setUint16(28, nameBytes.length, true)
		c.setUint32(42, offset, true)
		central.set(nameBytes, 46)
		locals.push(local)
		centrals.push(central)
		records.set(name, central)
		offset += local.length
	}
	for (const [name, target] of Object.entries(aliases)) {
		const nameBytes = encoder.encode(name)
		const central = new Uint8Array(46 + nameBytes.length)
		central.set(records.get(target)!.subarray(0, 46))
		new DataView(central.buffer).setUint16(28, nameBytes.length, true)
		central.set(nameBytes, 46)
		centrals.push(central)
	}
	const directory = centrals.reduce((sum, part) => sum + part.length, 0)
	const end = new Uint8Array(22)
	const e = new DataView(end.buffer)
	e.setUint32(0, 0x06054b50, true)
	e.setUint16(8, centrals.length, true)
	e.setUint16(10, centrals.length, true)
	e.setUint32(12, directory, true)
	e.setUint32(16, offset, true)
	const out = new Uint8Array(offset + directory + 22)
	let at = 0
	for (const part of [...locals, ...centrals, end]) {
		out.set(part, at)
		at += part.length
	}
	return out
}

export const NAMESPACES =
	'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
	'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
	'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
	'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
	'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
	'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
	'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
	'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" ' +
	'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'

const TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

// A .docx with this body, and optionally styles, numbering, settings and more parts with their relationships (zipped
// as `zip` does, with its options)
export function docx(
	body: string,
	options: {
		styles?: string
		numbering?: string
		settings?: string
		footnotes?: string
		parts?: Record<string, string | Uint8Array>
		rels?: Array<{id: string; type: string; target: string; external?: boolean}>
	} & Parameters<typeof zip>[1] = {},
): Uint8Array {
	const rels = [...(options.rels ?? [])]
	const parts: Record<string, string | Uint8Array> = {...options.parts}
	const add = (name: string, type: string, content: string | undefined, root: string) => {
		if (content === undefined) return
		parts[`word/${name}`] = `<?xml version="1.0" encoding="UTF-8"?><w:${root} ${NAMESPACES}>${content}</w:${root}>`
		rels.push({id: `rId${name}`, type, target: name})
	}
	add('styles.xml', 'styles', options.styles, 'styles')
	add('numbering.xml', 'numbering', options.numbering, 'numbering')
	add('settings.xml', 'settings', options.settings, 'settings')
	add('footnotes.xml', 'footnotes', options.footnotes, 'footnotes')
	const relationship = (rel: (typeof rels)[number]) =>
		`<Relationship Id="${rel.id}" Type="${TYPE}/${rel.type}" Target="${rel.target}"${rel.external ? ' TargetMode="External"' : ''}/>`
	return zip(
		{
			'[Content_Types].xml':
				'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
			'_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${TYPE}/officeDocument" Target="word/document.xml"/></Relationships>`,
			'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document ${NAMESPACES}><w:body>${body}</w:body></w:document>`,
			'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map(relationship).join('')}</Relationships>`,
			...parts,
		},
		options,
	)
}

// A 1×1 PNG
export const PNG = Uint8Array.from(
	atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
	(c) => c.charCodeAt(0),
)

// Random, well-formed WordprocessingML bodies: real element names nested any which way, with odd attribute values
export function structures(seed: number): () => string {
	let state = seed
	const random = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648
	const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]
	const names = [
		'w:p',
		'w:r',
		'w:t',
		'w:tbl',
		'w:tr',
		'w:tc',
		'w:tab',
		'w:br',
		'w:sdt',
		'w:sdtContent',
		'w:hyperlink',
		'w:ins',
		'w:del',
		'w:fldSimple',
		'w:fldChar',
		'w:instrText',
		'w:drawing',
		'wp:inline',
		'wp:anchor',
		'w:pict',
		'v:shape',
		'w:pPr',
		'w:rPr',
		'w:numPr',
		'w:numId',
		'w:sectPr',
		'w:cols',
		'w:sym',
		'w:footnoteReference',
		'mc:AlternateContent',
		'mc:Choice',
		'w:tblGrid',
		'w:gridCol',
		'w:tcPr',
		'w:vMerge',
		'w:gridSpan',
		'm:oMath',
		'w:ptab',
		'w:smartTag',
	]
	const attributes = [
		'w:val',
		'w:type',
		'w:fldCharType',
		'w:instr',
		'w:char',
		'w:font',
		'r:id',
		'w:w',
		'Requires',
		'w:num',
		'w:space',
	]
	const values = [
		'0',
		'1',
		'-1',
		'99999999999',
		'restart',
		'begin',
		'end',
		'separate',
		'page',
		'PAGE',
		'HYPERLINK "javascript:x"',
		'F0B7',
		'x',
		'',
		'wps',
		'1e400',
		'NaN',
	]
	const node = (depth: number): string => {
		if (depth > 6 || random() < 0.25) return random() < 0.5 ? 'text &amp; more' : ''
		const name = pick(names)
		const keys = new Set(Array.from({length: Math.floor(random() * 3)}, () => pick(attributes)))
		const content = Array.from({length: Math.floor(random() * 4)}, () => node(depth + 1)).join('')
		return `<${name}${[...keys].map((key) => ` ${key}="${pick(values)}"`).join('')}>${content}</${name}>`
	}
	return () => Array.from({length: 3}, () => node(0)).join('')
}
