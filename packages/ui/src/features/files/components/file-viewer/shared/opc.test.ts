import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, test} from 'vitest'

import {asUtf8, failureCode, openPackage, parseRelationships, relsPartOf, resolveTarget} from './opc'
import {parseXml, XmlError} from './xml'
import {patchZip, ZipArchive, ZipError} from './zip'

// A corpus of real-world documents (FILES_FIXTURES=<dir>) adds them to the suite; without one, those tests skip
const FIXTURES = process.env.FILES_FIXTURES ?? ''
const hasFixtures = Boolean(FIXTURES) && existsSync(join(FIXTURES, 'Samples/Legacy'))

const errorOf = (run: () => unknown) => {
	try {
		run()
	} catch (error) {
		return error instanceof ZipError ? error.code : error
	}
	return 'none'
}

// An OLE compound file: its signature, a 512-byte header and one sector of directory entries with these names
function compoundFile(...names: string[]) {
	const bytes = new Uint8Array(1024)
	bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
	names.forEach((name, i) => {
		const at = 512 + i * 128
		for (let c = 0; c < name.length; c++) bytes[at + 2 * c] = name.charCodeAt(c)
		bytes[at + 64] = name.length * 2 + 2
	})
	return bytes
}

describe('opening a package', () => {
	test('a zip opens; an encrypted package and a legacy binary file fail differently', async () => {
		const empty = new Uint8Array(22)
		empty.set([0x50, 0x4b, 0x05, 0x06])
		const zip = await patchZip(ZipArchive.open(empty), new Map([['a.xml', '<a/>']]))
		expect(openPackage(zip).has('a.xml')).toBe(true)
		expect(errorOf(() => openPackage(compoundFile('Root Entry', 'EncryptedInfo', 'EncryptedPackage')))).toBe(
			'encrypted',
		)
		expect(errorOf(() => openPackage(compoundFile('Root Entry', 'WordDocument')))).toBe('unsupported')
		expect(errorOf(() => openPackage(new TextEncoder().encode('hello')))).toBe('corrupt')
	})

	test('only a directory entry names the encrypted stream, not text that mentions it', () => {
		const legacy = compoundFile('Root Entry', 'WordDocument')
		legacy.set(
			[...'EncryptedPackage'].flatMap((c) => [c.charCodeAt(0), 0]),
			900,
		)
		expect(errorOf(() => openPackage(legacy))).toBe('unsupported')
	})

	test.skipIf(!hasFixtures)('real encrypted and legacy files', () => {
		const file = (path: string) => new Uint8Array(readFileSync(join(FIXTURES, path)))
		expect(errorOf(() => openPackage(file('Samples2/Word/encrypted-password-pass-poi.docx')))).toBe('encrypted')
		const legacy = readdirSync(join(FIXTURES, 'Samples/Legacy')).filter((name) => name.endsWith('.doc'))
		expect(legacy.length).toBeGreaterThan(0)
		for (const name of legacy)
			expect(
				errorOf(() => openPackage(file(`Samples/Legacy/${name}`))),
				name,
			).toBe('unsupported')
	})
})

describe('relationships', () => {
	test('a part’s relationships live beside it', () => {
		expect(relsPartOf('ppt/slides/slide1.xml')).toBe('ppt/slides/_rels/slide1.xml.rels')
		expect(relsPartOf('')).toBe('_rels/.rels')
	})

	test('targets resolve to part names', () => {
		const resolve = (target: string) => resolveTarget('ppt/slides/slide1.xml', target)
		expect(resolve('../media/image1.png')).toBe('ppt/media/image1.png')
		expect(resolve('./chart1.xml')).toBe('ppt/slides/chart1.xml')
		expect(resolve('/ppt/media/image1.png')).toBe('ppt/media/image1.png')
		// Backslashes, which some writers use, are slashes too
		expect(resolve('..\\media\\image1.png')).toBe('ppt/media/image1.png')
		expect(resolve('\\ppt\\media\\image1.png')).toBe('ppt/media/image1.png')
		// The fragment goes before escapes are decoded, so an escaped # stays part of the name
		expect(resolve('../media/image1.png#frame')).toBe('ppt/media/image1.png')
		expect(resolve('../media/My%20Picture%231.png')).toBe('ppt/media/My Picture#1.png')
		expect(resolve('../media/100%.png')).toBe('ppt/media/100%.png')
		expect(resolve('../../../../../../etc/passwd')).toBe('etc/passwd')
		expect(resolveTarget('', '/ppt/slides/slide1.xml')).toBe('ppt/slides/slide1.xml')
	})

	test('types by their last segment; external targets as written', () => {
		const rels = parseRelationships(
			parseXml(
				'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
					'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/a.png"/>' +
					'<Relationship Id="rId2" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/image" Target="../media/b.png"/>' +
					'<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="../x?y#z" TargetMode="External"/>' +
					'<Relationship Type="image" Target="no-id.png"/><Relationship Id="rId5" Type="image"/></Relationships>',
			),
			'ppt/slides/slide1.xml',
		)
		expect([...rels]).toEqual([
			['rId1', {type: 'image', target: 'ppt/media/a.png', external: false}],
			['rId2', {type: 'image', target: 'ppt/media/b.png', external: false}],
			['rId3', {type: 'hyperlink', target: '../x?y#z', external: true}],
		])
		expect(parseRelationships(undefined, 'ppt/slides/slide1.xml').size).toBe(0)
	})
})

test('zip and XML failures become the codes viewers explain; anything else is a bug', () => {
	expect(failureCode(new ZipError('missing', ''))).toBe('corrupt')
	expect(failureCode(new ZipError('encrypted', ''))).toBe('encrypted')
	expect(failureCode(new ZipError('limits', ''))).toBe('limits')
	expect(failureCode(new XmlError('limits', '', 0))).toBe('limits')
	expect(failureCode(new XmlError('doctype', '', 0))).toBe('corrupt')
	expect(failureCode(new TypeError('bug'))).toBeUndefined()
})

test('a part written as UTF-8 says so in its declaration', () => {
	expect(asUtf8('<?xml version="1.0" encoding="UTF-16" standalone="yes"?><a/>')).toBe(
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a/>',
	)
	expect(asUtf8("<?xml version='1.0' encoding = 'utf-16'?><a/>")).toBe("<?xml version='1.0' encoding = 'UTF-8'?><a/>")
	for (const kept of ['<?xml version="1.0" encoding="utf-8"?><a/>', '<?xml version="1.0"?><a/>', '<a/>'])
		expect(asUtf8(kept)).toBe(kept)
	// Only the declaration: a processing instruction that happens to come first isn't one
	expect(asUtf8('<?xml-stylesheet encoding="x"?><a/>')).toBe('<?xml-stylesheet encoding="x"?><a/>')
})
