import type {ZipEntry} from '@/features/files/components/file-viewer/shared/zip'
import type {FileType} from '@/features/files/constants'

export type ArchiveFile = {kind: 'file'; name: string; entry: ZipEntry}
// Its size is everything in it, and its date the latest of theirs
export type ArchiveFolder = {kind: 'folder'; name: string; children: ArchiveNode[]; size: number; modified: number}
export type ArchiveNode = ArchiveFile | ArchiveFolder

// An archive's names are whatever its writer put there: they're shown only as text, and never quite as they are.
// Control characters, and the bidirectional controls that can flip how a name reads (an .exe passing for a .jpg),
// show as U+FFFD, and a name stops at the longest a file's name can be.
const UNSAFE = /[\p{Cc}\p{Bidi_Control}]/gu
const MAX_NAME = 255

const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'})

// The folders an entry is in, then its own name. Either slash separates (Windows writers use backslashes), and as
// unzip does, nothing leads up out of the archive or from its root: empty parts, "." and ".." are dropped.
export function segmentsOf(name: string): string[] {
	return name
		.split(/[/\\]/)
		.filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
		.map((segment) => {
			const safe = segment.replace(UNSAFE, '\uFFFD')
			return safe.length > MAX_NAME
				? Array.from(safe)
						.slice(0, MAX_NAME - 1)
						.join('') + '…'
				: safe
		})
}

// The archive as folders of files, each folder's folders first, then its files, both by name. Explicit folder
// entries count, so an empty folder shows; two entries that end up at one place both show.
export function buildTree(entries: readonly ZipEntry[]): {root: ArchiveFolder; count: number} {
	const root = folder('')
	const subfolders = new Map<ArchiveFolder, Map<string, ArchiveFolder>>([[root, new Map()]])
	let count = 0
	for (const entry of entries) {
		const isFolder = /[/\\]$/.test(entry.name)
		const segments = segmentsOf(entry.name)
		// A file whose name is nothing but separators and dots is still listed
		const name = isFolder ? undefined : (segments.pop() ?? '\uFFFD')
		const size = isFolder ? 0 : entry.size
		let at = root
		for (const segment of segments) {
			at.size += size
			at.modified = Math.max(at.modified, entry.modified)
			let next = subfolders.get(at)!.get(segment)
			if (!next) {
				next = folder(segment)
				subfolders.get(at)!.set(segment, next)
				subfolders.set(next, new Map())
				at.children.push(next)
				count++
			}
			at = next
		}
		at.size += size
		at.modified = Math.max(at.modified, entry.modified)
		if (name !== undefined) {
			at.children.push({kind: 'file', name, entry})
			count++
		}
	}
	for (const each of subfolders.keys()) {
		each.children.sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'folder' ? -1 : 1))
	}
	return {root, count}
}

const folder = (name: string): ArchiveFolder => ({kind: 'folder', name, children: [], size: 0, modified: 0})

// Which of Files' types an entry's name makes it, as umbreld's MIME lookup would type a file of that name on disk
// (but for .ts, a video there and TypeScript as often in an archive): for its icon, never its thumbnail
const EXTENSIONS: Partial<Record<FileType, string>> = {
	'application/x-iso9660-image': 'iso',
	'application/x-apple-diskimage': 'dmg',
	'application/x-msdownload': 'exe dll',
	'image/vnd.adobe.photoshop': 'psd',
	'application/illustrator': 'ai',
	'application/vnd.rar': 'rar',
	'application/zip': 'zip',
	'application/x-7z-compressed': '7z',
	'application/x-tar': 'tar',
	'application/gzip': 'gz tgz',
	'application/x-bzip2': 'bz2',
	'application/x-xz': 'xz',
	'application/pdf': 'pdf',
	'text/csv': 'csv',
	'text/tab-separated-values': 'tsv',
	'text/plain': 'txt text log conf ini',
	'text/yaml': 'yaml yml',
	'application/json': 'json',
	'text/javascript': 'js mjs cjs',
	'text/css': 'css',
	'text/html': 'html htm',
	'text/markdown': 'md markdown',
	'text/x-python': 'py',
	'application/x-sh': 'sh',
	'application/xml': 'xml',
	'application/toml': 'toml',
	'application/x-subrip': 'srt',
	'application/epub+zip': 'epub',
	'application/x-mobipocket-ebook': 'mobi',
	'application/msword': 'doc',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
	'application/vnd.ms-excel': 'xls',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
	'application/vnd.ms-powerpoint': 'ppt',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
	'application/vnd.apple.numbers': 'numbers',
	'application/vnd.apple.pages': 'pages',
	'application/vnd.apple.keynote': 'key',
	'image/svg+xml': 'svg',
	'image/avif': 'avif',
	'image/webp': 'webp',
	'image/heic': 'heic',
	'image/heif': 'heif',
	'image/jpeg': 'jpg jpeg jpe jfif',
	'image/png': 'png',
	'image/gif': 'gif',
	'image/bmp': 'bmp',
	'image/vnd.microsoft.icon': 'ico',
	'image/tiff': 'tif tiff',
	'audio/mpeg': 'mp3',
	'audio/mp4': 'm4a',
	'audio/wav': 'wav',
	'audio/aac': 'aac',
	'audio/ogg': 'ogg oga opus',
	'audio/flac': 'flac',
	'audio/x-aiff': 'aif aiff',
	'audio/midi': 'mid midi',
	'video/mp4': 'mp4',
	'video/quicktime': 'mov',
	'video/webm': 'webm',
	'video/mpeg': 'mpeg mpg',
	'video/x-m4v': 'm4v',
	'video/x-matroska': 'mkv',
	'video/x-msvideo': 'avi',
	'video/x-ms-wmv': 'wmv',
	'video/mp2t': 'mts m2ts',
	'video/3gpp': '3gp',
}
const TYPES = new Map(
	Object.entries(EXTENSIONS).flatMap(([type, extensions]) =>
		extensions.split(' ').map((extension) => [extension, type as FileType] as const),
	),
)

export function extensionOf(name: string): string {
	const dot = name.lastIndexOf('.')
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export const typeOf = (name: string): FileType | undefined => TYPES.get(extensionOf(name))
