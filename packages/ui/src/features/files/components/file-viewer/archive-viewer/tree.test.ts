import {describe, expect, test} from 'vitest'

import {buildTree, segmentsOf, typeOf, type ArchiveFile, type ArchiveFolder} from './tree'

const entry = (name: string, size = 0, modified = 0) => ({
	name,
	size,
	compressedSize: size,
	method: 0,
	crc32: 0,
	modified,
})
const names = (folder: ArchiveFolder) =>
	folder.children.map((node) => `${node.name}${node.kind === 'folder' ? '/' : ''}`)
const at = (folder: ArchiveFolder, name: string) =>
	folder.children.find((node): node is ArchiveFolder => node.kind === 'folder' && node.name === name)!

describe('segmentsOf', () => {
	test('never leads up out of the archive or from its root', () => {
		expect(segmentsOf('../evil.txt')).toEqual(['evil.txt'])
		expect(segmentsOf('../../../../etc/passwd')).toEqual(['etc', 'passwd'])
		expect(segmentsOf('/absolute/path.txt')).toEqual(['absolute', 'path.txt'])
		expect(segmentsOf('a/../../b.txt')).toEqual(['a', 'b.txt'])
		expect(segmentsOf('./dot/./file.txt')).toEqual(['dot', 'file.txt'])
		expect(segmentsOf('folder//nested/')).toEqual(['folder', 'nested'])
	})

	test('takes backslashes as separators, as Windows writers use them', () => {
		expect(segmentsOf('win\\style\\path.txt')).toEqual(['win', 'style', 'path.txt'])
	})

	test('shows control and bidirectional characters as U+FFFD, never as themselves', () => {
		expect(segmentsOf('bell\x07escape\x1b[31m.txt')).toEqual(['bell\ufffdescape\ufffd[31m.txt'])
		expect(segmentsOf('nul\0name.txt')).toEqual(['nul\ufffdname.txt'])
		expect(segmentsOf('c1\u0085.txt')).toEqual(['c1\ufffd.txt'])
		expect(segmentsOf('invoice\u202etxt.exe')).toEqual(['invoice\ufffdtxt.exe'])
		expect(segmentsOf('isolate\u2066d\u2069.txt')).toEqual(['isolate\ufffdd\ufffd.txt'])
		expect(segmentsOf('Résumé 日本語 😀.txt')).toEqual(['Résumé 日本語 😀.txt'])
	})

	test('cuts a name at 255 characters, never through one', () => {
		const [long] = segmentsOf('x'.repeat(70_000))
		expect(long).toHaveLength(255)
		expect(long.endsWith('x…')).toBe(true)
		const [emoji] = segmentsOf('😀'.repeat(300))
		expect(Array.from(emoji)).toHaveLength(255)
		expect(emoji).toBe('😀'.repeat(254) + '…')
		expect(segmentsOf('y'.repeat(255))).toEqual(['y'.repeat(255)])
	})
})

describe('buildTree', () => {
	test('lists folders first, then files, both in natural order', () => {
		const {root, count} = buildTree(
			['b.txt', 'file10.txt', 'Zebra/', 'file2.txt', 'apple/a.txt', 'A.txt'].map((name) => entry(name)),
		)
		expect(names(root)).toEqual(['apple/', 'Zebra/', 'A.txt', 'b.txt', 'file2.txt', 'file10.txt'])
		expect(count).toBe(7)
	})

	test('makes the folders an entry is in when the archive lists none, and keeps empty ones it lists', () => {
		const {root, count} = buildTree([entry('a/b/c.txt', 5), entry('empty/'), entry('a/b/')])
		expect(names(root)).toEqual(['a/', 'empty/'])
		expect(names(at(at(root, 'a'), 'b'))).toEqual(['c.txt'])
		expect(names(at(root, 'empty'))).toEqual([])
		expect(count).toBe(4)
	})

	test('sizes a folder by everything in it and dates it by the latest, a folder entry adding no size', () => {
		const {root} = buildTree([
			entry('docs/', 999, 50),
			entry('docs/a.txt', 10, 100),
			entry('docs/deep/b.txt', 20, 300),
			entry('top.txt', 5, 200),
		])
		const docs = at(root, 'docs')
		expect([docs.size, docs.modified]).toEqual([30, 300])
		expect([at(docs, 'deep').size, at(docs, 'deep').modified]).toEqual([20, 300])
		expect(root.size).toBe(35)
	})

	test('places hostile names safely, keeping every entry and the name each can be read by', () => {
		const hostile = ['../evil.txt', '/evil.txt', 'a/../../b.txt', '..', 'same', 'same/inner.txt']
		const {root, count} = buildTree(hostile.map((name) => entry(name)))
		expect(names(root).slice(0, 2)).toEqual(['a/', 'same/'])
		expect(names(at(root, 'a'))).toEqual(['b.txt'])
		// Two entries landing on one name stay two files, each still read by its own name in the archive
		const files = root.children.filter((node): node is ArchiveFile => node.kind === 'file')
		expect(files.map((file) => [file.name, file.entry.name]).sort()).toEqual([
			['evil.txt', '../evil.txt'],
			['evil.txt', '/evil.txt'],
			['same', 'same'],
			['\ufffd', '..'],
		])
		expect(count).toBe(8)
	})

	test('builds a hundred thousand entries in one folder', () => {
		const entries = Array.from({length: 100_000}, (_, i) => entry(`flat/file-${(i * 7919) % 100_000}.txt`, 1))
		const {root, count} = buildTree(entries)
		const flat = at(root, 'flat')
		expect(flat.children).toHaveLength(100_000)
		expect(flat.children.slice(0, 3).map((node) => node.name)).toEqual(['file-0.txt', 'file-1.txt', 'file-2.txt'])
		expect([flat.size, count]).toEqual([100_000, 100_001])
	})
})

describe('typeOf', () => {
	test('types a name by its extension as the listing would, and only by a real one', () => {
		expect(typeOf('Photo.JPG')).toBe('image/jpeg')
		expect(typeOf('notes.md')).toBe('text/markdown')
		expect(typeOf('report.final.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
		expect(typeOf('Makefile')).toBeUndefined()
		expect(typeOf('.bashrc')).toBeUndefined()
		// .ts is a video to MIME, and TypeScript as often in an archive: neither, rather than the wrong one
		expect(typeOf('index.ts')).toBeUndefined()
	})
})
