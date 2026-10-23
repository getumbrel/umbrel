import nodePath from 'node:path'

import {describe, expect, test, vi} from 'vitest'

import Files, {isPathInsideOrEqual, normalizePath} from './files.ts'

import type Umbreld from '../../index.ts'

const dataDirectory = '/home/umbrel/umbrel'

const createFiles = () =>
	new Files({
		dataDirectory,
		logger: {createChildLogger: () => ({})},
		eventBus: {emit: vi.fn()},
	} as unknown as Umbreld)

// The previous implementations, kept to check the faster ones are equivalent
function referenceNormalizePath(path: string) {
	const normalized = nodePath.posix.normalize(path)
	if (normalized === '/') return normalized
	return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
}

function referenceSystemToVirtualPath(files: Files, systemPath: string) {
	systemPath = referenceNormalizePath(systemPath)
	const membersRoot = `${dataDirectory}/members/`
	if (systemPath.startsWith(membersRoot)) {
		const [slug, kind, ...tail] = systemPath.slice(membersRoot.length).split('/')
		const rest = tail.join('/')
		if (kind === 'trash') return referenceNormalizePath(`/Users/${slug}/Trash/${rest}`)
		if (kind === 'home') return referenceNormalizePath(`/Users/${slug}/${rest}`)
	}
	for (const [baseDirectory, basePath] of files.baseDirectories) {
		if (isPathInsideOrEqual(basePath, systemPath)) {
			const relativePath = nodePath.relative(basePath, systemPath).split(nodePath.sep).join('/')
			return referenceNormalizePath(nodePath.posix.join(baseDirectory, relativePath))
		}
	}
	throw new Error(`[invalid-path] Path '${systemPath}' is not within any base directory`)
}

const outcome = (fn: () => string) => {
	try {
		return fn()
	} catch (error) {
		return `throws: ${(error as Error).message}`
	}
}

const tricky = [
	'',
	'.',
	'..',
	'/',
	'//',
	'a',
	'a/',
	'./a',
	'a/./b',
	'a/../b',
	'/a/b/',
	'/a//b',
	'/a/.',
	'/a/..',
	'/a/...',
	'/a/..b',
	'/a/.b/c',
	'/a/b..',
	'...',
	'/.../x',
	`${dataDirectory}/home`,
	`${dataDirectory}/home/`,
	`${dataDirectory}/home/Photos/a.jpg`,
	`${dataDirectory}/home//Photos/./a.jpg`,
	`${dataDirectory}/home/Photos/../a.jpg`,
	`${dataDirectory}/home/../trash/x`,
	`${dataDirectory}/home2/x`,
	`${dataDirectory}/homes`,
	`${dataDirectory}/trash/x`,
	`${dataDirectory}/app-data/bitcoin/data`,
	`${dataDirectory}/machines/android/disk.qcow2`,
	`${dataDirectory}/external/usb/file`,
	`${dataDirectory}/backups`,
	`${dataDirectory}/network/host/share/f`,
	`${dataDirectory}/members/alice/home/Documents/a.txt`,
	`${dataDirectory}/members/alice/trash/a.txt`,
	`${dataDirectory}/members/alice/home`,
	`${dataDirectory}/members/alice/other/x`,
	`${dataDirectory}/secrets/jwt`,
	'/etc/passwd',
	`${dataDirectory}/home/with space/émoji 😀/new\nline`,
]

describe('normalizePath()', () => {
	test.each(tricky)('matches path.posix.normalize for %j', (path) => {
		expect(normalizePath(path)).toBe(referenceNormalizePath(path))
	})

	test('matches for random paths', () => {
		const segments = ['a', 'b', '.', '..', '', '...', '.x', 'x.', 'Photos', 'é']
		for (let i = 0; i < 20_000; i++) {
			const count = 1 + Math.floor(Math.random() * 6)
			const parts = Array.from({length: count}, () => segments[Math.floor(Math.random() * segments.length)])
			const path = (Math.random() < 0.8 ? '/' : '') + parts.join('/') + (Math.random() < 0.2 ? '/' : '')
			expect(normalizePath(path), path).toBe(referenceNormalizePath(path))
		}
	})
})

describe('systemToVirtualPath()', () => {
	test.each(tricky)('matches the previous implementation for %j', (path) => {
		const files = createFiles()
		expect(outcome(() => files.systemToVirtualPath(path))).toBe(
			outcome(() => referenceSystemToVirtualPath(files, path)),
		)
	})

	test('matches for random paths under the data directory', () => {
		const files = createFiles()
		const roots = [
			'home',
			'home2',
			'trash',
			'app-data',
			'machines',
			'external',
			'backups',
			'network',
			'members/bob/home',
			'members/bob/trash',
			'db',
		]
		const segments = ['a', 'b', '.', '..', '', 'Photos', 'x y']
		for (let i = 0; i < 20_000; i++) {
			const root = roots[Math.floor(Math.random() * roots.length)]
			const parts = Array.from(
				{length: Math.floor(Math.random() * 5)},
				() => segments[Math.floor(Math.random() * segments.length)],
			)
			const path = `${dataDirectory}/${root}${parts.length ? '/' + parts.join('/') : ''}${Math.random() < 0.1 ? '/' : ''}`
			expect(
				outcome(() => files.systemToVirtualPath(path)),
				path,
			).toBe(outcome(() => referenceSystemToVirtualPath(files, path)))
		}
	})
})
