import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, test} from 'vitest'

import {
	attr,
	child,
	children,
	escapeXmlText,
	parseXml,
	textContent,
	tokenizeXml,
	XmlError,
	type XmlElement,
	type XmlErrorCode,
	type XmlEvent,
	type XmlText,
} from './xml'
import {ZipArchive} from './zip'

// A corpus of real-world documents (FILES_FIXTURES=<dir>) adds them to the suite; without one, those tests skip
const FIXTURES = process.env.FILES_FIXTURES ?? ''

function events(xml: string) {
	const out: XmlEvent[] = []
	tokenizeXml(xml, (event) => {
		out.push(event)
	})
	return out
}

function errorOf(run: () => unknown): XmlErrorCode | 'none' {
	try {
		run()
	} catch (error) {
		if (error instanceof XmlError) return error.code
		throw error
	}
	return 'none'
}

const offsetOf = (run: () => unknown) => {
	try {
		run()
	} catch (error) {
		if (error instanceof XmlError) return error.offset
	}
	return -1
}

// Rebuilding the source from the token spans and the gaps between them proves every offset exact; the gaps may
// only hold what produces no events (prolog whitespace, comments, processing instructions)
function expectExactSpans(xml: string) {
	let last = 0
	let rebuilt = ''
	tokenizeXml(xml, (event) => {
		const gap = xml.slice(last, event.start)
		if (!/^(?:\ufeff|\s|<!--[\s\S]*?-->|<\?[\s\S]*?\?>)*$/.test(gap))
			throw new Error(`Unexpected gap ${gap.slice(0, 80)}`)
		const span = xml.slice(event.start, event.end)
		if (
			event.type === 'open' &&
			!(span.startsWith(`<${event.name}`) && span.endsWith(event.selfClosing ? '/>' : '>'))
		) {
			throw new Error(`Bad open span ${span}`)
		}
		if (event.type === 'close' && !(span.startsWith(`</${event.name}`) && span.endsWith('>'))) {
			throw new Error(`Bad close span ${span}`)
		}
		if (event.type === 'text' && span.includes('<') && !span.startsWith('<![CDATA[')) {
			throw new Error(`Bad text span ${span}`)
		}
		rebuilt += gap + span
		last = event.end
	})
	expect(rebuilt + xml.slice(last)).toBe(xml)
}

// Re-encodes every text node in place; the result must parse to the same tree and text
function respliceText(xml: string) {
	const root = parseXml(xml)
	const texts: XmlText[] = []
	const walk = (element: XmlElement) => {
		for (const node of element.children) {
			if ('text' in node) texts.push(node)
			else walk(node)
		}
	}
	walk(root)
	let out = ''
	let last = 0
	for (const node of texts) {
		out += xml.slice(last, node.start) + escapeXmlText(node.text)
		last = node.end
	}
	out += xml.slice(last)
	const again = parseXml(out)
	expect(textContent(again)).toBe(textContent(root))
	expect(again.children.length).toBe(root.children.length)
	return out
}

// Timed first, while the tokenizer is as fresh as it is in the sheet worker: the hostile-input tests below leave V8's
// optimised code for it measurably slower in this process
const r200k = join(FIXTURES, 'Samples/Spreadsheets/r200k.xlsx')
test.skipIf(!FIXTURES || !existsSync(r200k))('r200k.xlsx: tokenizing the 81 MB sheet', async () => {
	const sheet = await ZipArchive.open(new Uint8Array(readFileSync(r200k))).text('xl/worksheets/sheet1.xml')
	let cells = 0
	let values = 0
	const started = performance.now()
	tokenizeXml(sheet, (event) => {
		if (event.type === 'open' && event.name === 'c') cells++
		else if (event.type === 'text') values++
	})
	const elapsed = performance.now() - started
	console.info(
		`r200k sheet1.xml: ${(sheet.length / 1e6).toFixed(1)} MB, ${cells} cells tokenized in ${elapsed.toFixed(0)} ms ` +
			`(${Math.round(sheet.length / 1e6 / (elapsed / 1000))} MB/s)`,
	)
	expect(cells).toBe(2_000_010)
	expect(values).toBe(2_000_010)
	expect(elapsed).toBeLessThan(15_000)
})

describe('tokenizeXml', () => {
	test('emits open, text and close events with exact source spans', () => {
		const xml =
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<!-- prolog -->' +
			`<w:document xmlns:w="urn:w"><w:p w:rsidR="00A1"><w:t xml:space='preserve'> Hi </w:t><w:br/></w:p></w:document>\n`
		const list = events(xml)
		expect(list.map((event) => xml.slice(event.start, event.end))).toEqual([
			'<w:document xmlns:w="urn:w">',
			'<w:p w:rsidR="00A1">',
			"<w:t xml:space='preserve'>",
			' Hi ',
			'</w:t>',
			'<w:br/>',
			'</w:p>',
			'</w:document>',
		])
		expect(list[0]).toEqual({
			type: 'open',
			name: 'w:document',
			attributes: {'xmlns:w': 'urn:w'},
			selfClosing: false,
			start: xml.indexOf('<w:document'),
			end: xml.indexOf('<w:p '),
		})
		expect(list[3]).toMatchObject({type: 'text', text: ' Hi '})
		expect(list[5]).toMatchObject({type: 'open', name: 'w:br', attributes: {}, selfClosing: true})
		expect(list[7]).toMatchObject({type: 'close', name: 'w:document'})
	})

	test('allows whitespace inside tags and both quote kinds', () => {
		const list = events(`<a\n\tb = "1"\r\nc='2' d="it's" e='say "hi"'  ><x></x ><y\n/></a>`)
		expect(list[0]).toMatchObject({attributes: {b: '1', c: '2', d: "it's", e: 'say "hi"'}, selfClosing: false})
		expect(list.map((event) => event.type)).toEqual(['open', 'open', 'close', 'open', 'close'])
		expect(list[3]).toMatchObject({name: 'y', selfClosing: true})
	})

	test('decodes the predefined entities and character references, in text and attributes', () => {
		const xml =
			'<a t="&lt;&gt;&amp;&quot;&apos;&#65;&#x42;&#x1f600;&#0000067;">&lt;tag&gt; &amp;amp; &#169; &#x10FFFF;</a>'
		const [open, text] = events(xml)
		expect(open).toMatchObject({attributes: {t: '<>&"\'AB😀C'}})
		expect(text).toMatchObject({text: '<tag> &amp; © \u{10ffff}', start: open.end, end: xml.indexOf('</a>')})
	})

	test('rejects entities without a definition and references to impossible characters', () => {
		const bad = ['&nbsp;', '&#0;', '&#xD800;', '&#xdfff;', '&#x110000;', '&#99999999999;', '&#X41;', '&#;', '&#x;']
		for (const reference of [...bad, '&#12a;', '& ', '&amp', '&#x41', '&']) {
			expect(
				errorOf(() => events(`<a>${reference}</a>`)),
				reference,
			).toBe('malformed')
			expect(
				errorOf(() => events(`<a b="${reference}"/>`)),
				reference,
			).toBe('malformed')
		}
		expect(offsetOf(() => events('<a>fine &bogus;</a>'))).toBe(8)
		expect(offsetOf(() => events('<a b="x&y;"/>'))).toBe(7)
	})

	test('normalises line ends, and whitespace in attribute values, as an XML parser must', () => {
		const [open, text] = events('<a b="x\r\ny\tz\nw\rv" c="&#13;&#10;&#9;">1\r\n2\r3\n4&#13;5</a>')
		expect(open).toMatchObject({attributes: {b: 'x y z w v', c: '\r\n\t'}})
		expect(text).toMatchObject({text: '1\n2\n3\n4\r5'})
	})

	test('reads CDATA verbatim, as its own text event spanning its delimiters', () => {
		const xml = '<a>x<![CDATA[<b>&amp;</b>\r\n]]]]><![CDATA[>]]>y</a>'
		const list = events(xml)
		expect(list.map((event) => (event.type === 'text' ? event.text : event.type))).toEqual([
			'open',
			'x',
			'<b>&amp;</b>\n]]',
			'>',
			'y',
			'close',
		])
		expect(xml.slice(list[2].start, list[2].end)).toBe('<![CDATA[<b>&amp;</b>\r\n]]]]>')
	})

	test('skips comments and processing instructions wherever they are', () => {
		const xml = '<?xml version="1.0"?>\n<!--a--><r><!-- in <tag> & --><?pi data?>x<!---->y</r><!-- after -->\n<?after?>'
		expect(events(xml).map((event) => (event.type === 'text' ? event.text : event.type))).toEqual([
			'open',
			'x',
			'y',
			'close',
		])
	})

	test('rejects DOCTYPE wherever it appears, so entity expansion never happens', () => {
		const laughs =
			'<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]><lolz>&lol2;</lolz>'
		expect(errorOf(() => events(laughs))).toBe('doctype')
		expect(errorOf(() => parseXml('<!DOCTYPE r SYSTEM "file:///etc/passwd"><r/>'))).toBe('doctype')
		expect(errorOf(() => events('<r><!DOCTYPE x></r>'))).toBe('doctype')
	})

	test('rejects documents that are not well-formed', () => {
		const cases = [
			'',
			'  \n ',
			'<a>',
			'<a></b>',
			'</a>',
			'<a/><b/>',
			'text<a/>',
			'<a/>text',
			'<a b="1" b="2"/>',
			'<a __proto__="1" __proto__="2"/>',
			'<a b=1/>',
			'<a b/>',
			'<a b="1"c="2"/>',
			'<a b="1/>',
			'<a b=\'1"/>',
			'<',
			'<a',
			'<a b',
			'<a b=',
			'< a/>',
			'<>',
			'</>',
			'<a></a',
			'<a></ a>',
			'<a/ >',
			'<a><!-- x</a>',
			'<a><![CDATA[x</a>',
			'<a><?pi</a>',
			'<!ELEMENT a><a/>',
			'<a><!foo></a>',
			'<![CDATA[x]]><a/>',
			'<a></a><!-- -->x',
			'<a>&</a>',
			'<a x="&"/>',
			'<a:b></a>',
			'<a></a:b>',
		]
		for (const xml of cases)
			expect(
				errorOf(() => events(xml)),
				JSON.stringify(xml),
			).toBe('malformed')
	})

	test('stops at once when the handler returns false', () => {
		const seen: string[] = []
		tokenizeXml('<a><b/><c/>garbage<<<', (event) => {
			seen.push(event.type)
			if (seen.length === 2) return false
		})
		expect(seen).toEqual(['open', 'open'])
	})

	test('handles a BOM, and nesting far deeper than any call stack', () => {
		const depth = 200_000
		let current = 0
		let deepest = 0
		tokenizeXml('\ufeff' + '<a>'.repeat(depth) + '</a>'.repeat(depth), (event) => {
			if (event.type === 'open') deepest = Math.max(deepest, ++current)
			else if (event.type === 'close') current--
		})
		expect(deepest).toBe(depth)
	})

	test('keeps attributes named after Object.prototype members as plain own attributes', () => {
		const [open] = events('<a __proto__="p" constructor="c" toString="t" hasOwnProperty="h"/>')
		if (open.type !== 'open') throw new Error('expected an open tag')
		expect(Object.getPrototypeOf(open.attributes)).toBe(Object.prototype)
		expect(Object.entries(open.attributes)).toEqual([
			['__proto__', 'p'],
			['constructor', 'c'],
			['toString', 't'],
			['hasOwnProperty', 'h'],
		])
		expect(({} as Record<string, unknown>).polluted).toBeUndefined()
	})

	test('stays linear on pathological input', () => {
		const huge = 4_000_000
		const cases = [
			'<a>' + '&amp;'.repeat(huge / 5) + '</a>',
			'<a b="' + 'x'.repeat(huge),
			'<a>' + '<!--' + '-'.repeat(huge),
			'<a ' + 'b'.repeat(huge),
			'<a>' + '<'.repeat(huge),
			'<' + 'a'.repeat(huge) + '>' + '</' + 'a'.repeat(huge) + '>',
			'<a ' + Array.from({length: 100_000}, (_, i) => `k${i}="${i}"`).join(' ') + '/>',
		]
		for (const xml of cases) {
			const started = performance.now()
			errorOf(() => events(xml))
			expect(performance.now() - started).toBeLessThan(2000)
		}
	})

	test('random corruption only ever surfaces as XmlError', () => {
		const xml =
			'<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t xml:space="preserve">a &amp; b</w:t>' +
			"</w:r><w:r><w:t><![CDATA[<x>]]></w:t></w:r></w:p><!-- c --><w:sectPr w:val='1'/></w:body></w:document>"
		const alphabet = '<>/="\'&;#x!-?[]CDATA \n\r\tabw:0123456789'
		let seed = 9
		const random = () => {
			seed = (seed * 16807) % 2147483647
			return seed / 2147483647
		}
		let parsed = 0
		for (let round = 0; round < 5000; round++) {
			let mutated = xml
			for (let k = 0; k < 1 + random() * 3; k++) {
				const at = Math.floor(random() * mutated.length)
				const insert = random() < 0.7 ? alphabet[Math.floor(random() * alphabet.length)] : ''
				mutated = mutated.slice(0, at) + insert + mutated.slice(at + (random() < 0.5 ? 1 : 0))
			}
			if (errorOf(() => parseXml(mutated)) === 'none') parsed++
		}
		expect(parsed).toBeGreaterThan(100)
	})
})

describe('parseXml', () => {
	test('builds the element tree with spans for splicing', () => {
		const xml =
			'<?xml version="1.0"?>\n<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:sp><a:t>Title</a:t><a:off x="1" y="2"/></p:sp></p:sld>'
		const root = parseXml(xml)
		expect(root).toMatchObject({name: 'p:sld', local: 'sld', attributes: {'xmlns:p': 'urn:p', 'xmlns:a': 'urn:a'}})
		const shape = child(root, 'sp')!
		const [title, offset] = children(shape)
		expect(xml.slice(shape.start, shape.end)).toBe('<p:sp><a:t>Title</a:t><a:off x="1" y="2"/></p:sp>')
		expect(xml.slice(shape.contentStart, shape.contentEnd)).toBe('<a:t>Title</a:t><a:off x="1" y="2"/>')
		expect(xml.slice(title.contentStart, title.contentEnd)).toBe('Title')
		expect(title.children).toEqual([{text: 'Title', start: title.contentStart, end: title.contentEnd}])
		expect(offset).toMatchObject({
			name: 'a:off',
			local: 'off',
			children: [],
			contentStart: offset.end,
			contentEnd: offset.end,
		})
		expect(xml.slice(offset.start, offset.end)).toBe('<a:off x="1" y="2"/>')
	})

	test('keeps every text node verbatim, so significant whitespace survives', () => {
		const slide = parseXml('<a:p><a:r><a:t>Hello</a:t></a:r><a:r><a:t> </a:t></a:r><a:r><a:t>world</a:t></a:r></a:p>')
		expect(textContent(slide)).toBe('Hello world')
		const run = parseXml('<w:r>\n  <w:t xml:space="preserve">  two  </w:t>\n</w:r>')
		expect(run.children.map((node) => ('text' in node ? node.text : node.name))).toEqual(['\n  ', 'w:t', '\n'])
		expect(attr(child(run, 't')!, 'space')).toBe('preserve')
		expect(textContent(child(run, 't')!)).toBe('  two  ')
	})

	test('caps nesting depth and node count', () => {
		const nest = (depth: number) => '<a>'.repeat(depth) + '</a>'.repeat(depth)
		expect(errorOf(() => parseXml(nest(256)))).toBe('none')
		expect(errorOf(() => parseXml(nest(257)))).toBe('limits')
		expect(errorOf(() => parseXml('<a>'.repeat(256) + '<b/>' + '</a>'.repeat(256)))).toBe('limits')
		expect(errorOf(() => parseXml(nest(1_000_000)))).toBe('limits')
		// The root and five million text nodes: processing instructions split the text without being nodes
		// themselves, which makes this the cheapest way past the cap (still a second's allocation, more when busy)
		expect(errorOf(() => parseXml(`<r>${'x<??>'.repeat(5_000_000)}</r>`))).toBe('limits')
	}, 30000)

	test('an edited text node splices back into otherwise identical source', () => {
		const xml = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>old text</w:t></w:r><w:r><w:t>tail</w:t></w:r></w:p>'
		const [first] = children(parseXml(xml), 'r')
		const node = child(first, 't')!.children[0] as XmlText
		const edited = xml.slice(0, node.start) + escapeXmlText('a < b & c > d') + xml.slice(node.end)
		expect(edited).toBe(
			'<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>a &lt; b &amp; c &gt; d</w:t></w:r><w:r><w:t>tail</w:t></w:r></w:p>',
		)
		expect(textContent(parseXml(edited))).toBe('a < b & c > dtail')
	})
})

describe('helpers', () => {
	const root = parseXml(
		'<p:sldIdLst xmlns:p="urn:p" xmlns:r="urn:r"><p:sldId id="256" r:id="rId2"/><p:sldId r:id="rId3"/>' +
			'<w:pStyle xmlns:w="urn:w" w:val="Heading1"/>text<p:sldId id="258" r:id="rId4"><x>deep <y>er</y></x></p:sldId></p:sldIdLst>',
	)

	test('child and children match local names whatever the prefix', () => {
		expect(child(root, 'sldId')?.attributes).toEqual({id: '256', 'r:id': 'rId2'})
		expect(child(root, 'missing')).toBeUndefined()
		expect(children(root, 'sldId').map((element) => attr(element, 'r:id'))).toEqual(['rId2', 'rId3', 'rId4'])
		expect(children(root).map((element) => element.name)).toEqual(['p:sldId', 'p:sldId', 'w:pStyle', 'p:sldId'])
	})

	test('attr prefers the exact name, then the local part of a prefixed one', () => {
		const [first, second] = children(root, 'sldId')
		expect(attr(first, 'id')).toBe('256')
		expect(attr(first, 'r:id')).toBe('rId2')
		expect(attr(second, 'id')).toBe('rId3')
		expect(attr(child(root, 'pStyle')!, 'val')).toBe('Heading1')
		expect(attr(child(root, 'pStyle')!, 'w')).toBeUndefined()
		expect(attr(root, 'xmlns:p')).toBe('urn:p')
		expect(attr(first, 'constructor')).toBeUndefined()
		expect(attr(first, 'toString')).toBeUndefined()
	})

	test('textContent concatenates descendant text in document order', () => {
		expect(textContent(root)).toBe('textdeep er')
		expect(textContent({text: 'node', start: 0, end: 4})).toBe('node')
	})
})

describe('escapeXmlText', () => {
	test('escapes markup and keeps CR as a reference', () => {
		expect(escapeXmlText('a & b < c > d "e" \'f\'')).toBe('a &amp; b &lt; c &gt; d "e" \'f\'')
		expect(escapeXmlText(']]>')).toBe(']]&gt;')
		expect(escapeXmlText('line\r\nnext')).toBe('line&#13;\nnext')
	})

	test('drops what XML 1.0 cannot carry and keeps everything it can', () => {
		expect(escapeXmlText('\u0000a\u0001\u0008b\u000b\u000c\u001fc\ufffe\uffff')).toBe('abc')
		expect(escapeXmlText('lone \ud800 high, lone \udc00 low')).toBe('lone  high, lone  low')
		expect(escapeXmlText('tab\tnewline\n😀 \u{10ffff} \ufffd \u0085 \u00a0')).toBe(
			'tab\tnewline\n😀 \u{10ffff} \ufffd \u0085 \u00a0',
		)
	})

	test('round-trips any string through the parser', () => {
		let seed = 5
		const random = () => {
			seed = (seed * 16807) % 2147483647
			return seed / 2147483647
		}
		const pool = [
			'a',
			' ',
			'&',
			'<',
			'>',
			'"',
			"'",
			'\r',
			'\n',
			'\t',
			'\r\n',
			']]>',
			'😀',
			'\u0001',
			'\ud800',
			'é',
			'&amp;',
		]
		const valid = (text: string) => text.replace(/[^\t\n\r\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
		for (let round = 0; round < 2000; round++) {
			const text = Array.from({length: Math.floor(random() * 12)}, () => pool[Math.floor(random() * pool.length)]).join(
				'',
			)
			expect(textContent(parseXml(`<t>${escapeXmlText(text)}</t>`))).toBe(valid(text))
		}
	})
})

const PART_DIRS = [
	'Samples/Word',
	'Samples/PowerPoint',
	'Samples/Spreadsheets',
	'Samples2/Word',
	'Samples2/PowerPoint',
	'Samples2/Spreadsheets',
]
// Packages that aren't zips, or are hostile on purpose (covered by the zip tests and below)
const SKIPPED = /^(not-a-zip|corrupt-|encrypted-|hostile-zip-bomb|hostile-xxe)|^r200k\.xlsx$/
const XXE = 'Samples2/Word/hostile-xxe-doctype-poi.docx'
const packages = PART_DIRS.flatMap((dir) =>
	FIXTURES && existsSync(join(FIXTURES, dir))
		? readdirSync(join(FIXTURES, dir))
				.filter((file) => /\.(docx|xlsx|pptx)$/.test(file) && !SKIPPED.test(file))
				.map((file) => join(dir, file))
		: [],
)

describe.skipIf(packages.length === 0)('real OOXML parts', () => {
	test.each(packages)('%s: every XML part tokenizes with exact spans and splices back', async (path) => {
		const archive = ZipArchive.open(new Uint8Array(readFileSync(join(FIXTURES, path))))
		const parts = archive.entries.filter((entry) => /\.(xml|rels)$/.test(entry.name))
		expect(parts.length).toBeGreaterThan(0)
		for (const part of parts) {
			const xml = await archive.text(part.name)
			expectExactSpans(xml)
			respliceText(xml)
		}
	})

	test.skipIf(!existsSync(join(FIXTURES, XXE)))('a document declaring external entities is refused', async () => {
		const xml = await ZipArchive.open(new Uint8Array(readFileSync(join(FIXTURES, XXE)))).text('word/document.xml')
		expect(errorOf(() => parseXml(xml))).toBe('doctype')
	})
})
