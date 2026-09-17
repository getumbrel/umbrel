import nodePath from 'node:path'
import type {FileIndexRoot} from '../file-index-engine.js'

export function hasReservedMemberTrashPath(root: FileIndexRoot) {
	return root.kind === 'home' && root.virtualPath === `/Users/${root.ownerId}`
}

export function isReservedMemberTrashPath(root: FileIndexRoot, relativePath: string) {
	return hasReservedMemberTrashPath(root) && (relativePath === 'Trash' || relativePath.startsWith('Trash/'))
}

export function relativePathWithin(rootSystemPath: string, systemPath: string) {
	const relative = nodePath.relative(nodePath.resolve(rootSystemPath), nodePath.resolve(systemPath))
	if (relative === '') return ''
	if (relative === '..' || relative.startsWith(`..${nodePath.sep}`) || nodePath.isAbsolute(relative)) {
		throw new Error(`Path '${systemPath}' is outside index root '${rootSystemPath}'`)
	}
	return relative.split(nodePath.sep).join('/')
}

export function relativeVirtualPath(rootVirtualPath: string, virtualPath: string) {
	const root = nodePath.posix.normalize(rootVirtualPath)
	const candidate = nodePath.posix.normalize(virtualPath)
	if (candidate === root) return ''
	if (!candidate.startsWith(`${root}/`))
		throw new Error(`Path '${virtualPath}' is outside index root '${rootVirtualPath}'`)
	const relative = candidate.slice(root.length + 1)
	if (!relative || relative.startsWith('../') || relative.includes('\0'))
		throw new Error(`Invalid indexed path '${virtualPath}'`)
	return relative
}

export function joinVirtualPath(rootVirtualPath: string, relativePath: string) {
	if (
		!relativePath ||
		nodePath.posix.isAbsolute(relativePath) ||
		relativePath === '..' ||
		relativePath.startsWith('../') ||
		relativePath.includes('/../') ||
		relativePath.includes('\0')
	) {
		throw new Error(`Invalid relative path in file index: '${relativePath}'`)
	}
	return nodePath.posix.join(rootVirtualPath, relativePath)
}
