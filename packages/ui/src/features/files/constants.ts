import {lazy} from 'react'

import {
	AiThumbnail,
	AudioThumbnail,
	CsvThumbnail,
	DmgThumbnail,
	DocxThumbnail,
	EbookThumbnail,
	ExeThumbnail,
	ImageThumbnail,
	IsoThumbnail,
	PdfThumbnail,
	PptThumbnail,
	PsdThumbnail,
	TxtThumbnail,
	VideoThumbnail,
	ZipThumbnail,
} from '@/features/files/assets/file-items-thumbnails'
import {AudioViewer} from '@/features/files/components/file-viewer/audio-viewer'

// lazy load viewers, except audio viewer since it's a floating ui component
const ImageViewer = lazy(() => import('@/features/files/components/file-viewer/image-viewer'))
const PdfViewer = lazy(() => import('@/features/files/components/file-viewer/pdf-viewer'))
const VideoViewer = lazy(() => import('@/features/files/components/file-viewer/video-viewer'))

export const BASE_ROUTE_PATH = '/files' as const
export const HOME_PATH = '/Home' as const
export const TRASH_PATH = '/Trash' as const
export const APPS_PATH = '/Apps' as const
export const EXTERNAL_STORAGE_PATH = '/External' as const
export const NETWORK_STORAGE_PATH = '/Network' as const
export const BACKUPS_PATH = '/Backups' as const

// NOTE: Search and Recents are not real directories on disk. They are
// pseudo-directories, i.e. they are handled client-side only and are just
// virtual routes that show a flat list of file items returned by the backend
// search and recents endpoints.
export const SEARCH_PATH = '/Search' as const
export const RECENTS_PATH = '/Recents' as const

// Directory listing constants
export const USE_LIST_DIRECTORY_LOAD_ITEMS = {
	INITIAL: 250, // Number of items to load when first viewing a directory
	ON_SCROLL_END: 250, // Number of items to load when user scrolls near the end
} as const

// TODO: define it in a common place for client and server
export const SUPPORTED_ARCHIVE_EXTRACT_EXTENSIONS = [
	'.tar.gz',
	'.tgz',
	'.tar.bz2',
	'.tar.xz',
	'.tar',
	'.zip',
	'.rar',
	'.7z',
] as const

export const SORT_BY_OPTIONS = [
	{sortBy: 'name', labelTKey: 'files-sort.name'},
	{sortBy: 'modified', labelTKey: 'files-sort.modified'},
	{sortBy: 'size', labelTKey: 'files-sort.size'},
	// {sortBy: 'created', labelTKey: 'files-sort.created'},
	{sortBy: 'type', labelTKey: 'files-sort.type'},
] as const

// ENSURE THESE 2 SETS MATCH THE ONES IN umbreld/source/modules/files/thumbnails.ts
export const IMAGE_EXTENSIONS_WITH_IMAGE_THUMBNAILS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'])
export const VIDEO_EXTENSIONS_WITH_IMAGE_THUMBNAILS = new Set(['.mov', '.mp4', '.3gp', '.mkv', '.avi'])

export const FILE_TYPE_MAP = {
	// Folder
	directory: {nameTKey: 'files-type.directory', thumbnail: null, viewer: null},

	// Disk Images
	'application/x-iso9660-image': {nameTKey: 'files-type.iso', thumbnail: IsoThumbnail, viewer: null},
	'application/x-apple-diskimage': {nameTKey: 'files-type.dmg', thumbnail: DmgThumbnail, viewer: null},

	// Executables
	'application/x-msdownload': {nameTKey: 'files-type.exe', thumbnail: ExeThumbnail, viewer: null},
	'application/x-executable': {nameTKey: 'files-type.executable', thumbnail: ExeThumbnail, viewer: null},

	// Design Files
	'image/vnd.adobe.photoshop': {nameTKey: 'files-type.psd', thumbnail: PsdThumbnail, viewer: null},
	'application/illustrator': {nameTKey: 'files-type.ai', thumbnail: AiThumbnail, viewer: null},

	// Archives
	'application/vnd.rar': {nameTKey: 'files-type.rar', thumbnail: ZipThumbnail, viewer: null},
	'application/zip': {nameTKey: 'files-type.zip', thumbnail: ZipThumbnail, viewer: null},
	'application/x-7z-compressed': {nameTKey: 'files-type.7z', thumbnail: ZipThumbnail, viewer: null},
	'application/x-tar': {nameTKey: 'files-type.tar', thumbnail: ZipThumbnail, viewer: null},
	'application/x-gzip': {nameTKey: 'files-type.gzip', thumbnail: ZipThumbnail, viewer: null},
	'application/gzip': {nameTKey: 'files-type.gzip', thumbnail: ZipThumbnail, viewer: null},
	'application/x-bzip2': {nameTKey: 'files-type.bzip2', thumbnail: ZipThumbnail, viewer: null},
	'application/x-xz': {nameTKey: 'files-type.xz', thumbnail: ZipThumbnail, viewer: null},
	'application/x-lzip': {nameTKey: 'files-type.lzip', thumbnail: ZipThumbnail, viewer: null},
	'application/x-lzma': {nameTKey: 'files-type.lzma', thumbnail: ZipThumbnail, viewer: null},
	'application/x-lzop': {nameTKey: 'files-type.lzop', thumbnail: ZipThumbnail, viewer: null},
	'application/x-compress': {nameTKey: 'files-type.compressed', thumbnail: ZipThumbnail, viewer: null},
	'application/x-compressed': {nameTKey: 'files-type.compressed', thumbnail: ZipThumbnail, viewer: null},

	// Documents
	'application/pdf': {nameTKey: 'files-type.pdf', thumbnail: PdfThumbnail, viewer: PdfViewer},
	'text/plain': {nameTKey: 'files-type.txt', thumbnail: TxtThumbnail, viewer: null},
	'text/csv': {nameTKey: 'files-type.csv', thumbnail: CsvThumbnail, viewer: null},

	// Ebooks
	'application/epub+zip': {nameTKey: 'files-type.epub', thumbnail: EbookThumbnail, viewer: null},
	'application/x-mobipocket-ebook': {nameTKey: 'files-type.mobi', thumbnail: EbookThumbnail, viewer: null},

	// Microsoft Office
	'application/msword': {nameTKey: 'files-type.word', thumbnail: DocxThumbnail, viewer: null},
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
		nameTKey: 'files-type.word',
		thumbnail: DocxThumbnail,
		viewer: null,
	},
	'application/vnd.ms-excel': {nameTKey: 'files-type.excel', thumbnail: CsvThumbnail, viewer: null},
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
		nameTKey: 'files-type.excel',
		thumbnail: CsvThumbnail,
		viewer: null,
	},
	'application/vnd.ms-powerpoint': {nameTKey: 'files-type.powerpoint', thumbnail: PptThumbnail, viewer: null},
	'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
		nameTKey: 'files-type.powerpoint',
		thumbnail: PptThumbnail,
		viewer: null,
	},

	// Apple iWork
	'application/vnd.apple.numbers': {nameTKey: 'files-type.numbers', thumbnail: CsvThumbnail, viewer: null},
	'application/vnd.apple.pages': {nameTKey: 'files-type.pages', thumbnail: DocxThumbnail, viewer: null},
	'application/vnd.apple.keynote': {nameTKey: 'files-type.keynote', thumbnail: PptThumbnail, viewer: null},

	// Images
	'image/svg+xml': {nameTKey: 'files-type.svg', thumbnail: ImageThumbnail, viewer: ImageViewer},
	'image/avif': {nameTKey: 'files-type.avif', thumbnail: ImageThumbnail, viewer: ImageViewer},
	'image/webp': {nameTKey: 'files-type.webp', thumbnail: ImageThumbnail, viewer: ImageViewer},
	'image/heic': {nameTKey: 'files-type.heic', thumbnail: ImageThumbnail, viewer: null},
	'image/jpeg': {nameTKey: 'files-type.jpeg', thumbnail: ImageThumbnail, viewer: ImageViewer},
	'image/png': {nameTKey: 'files-type.png', thumbnail: ImageThumbnail, viewer: ImageViewer},
	'image/gif': {nameTKey: 'files-type.gif', thumbnail: ImageThumbnail, viewer: ImageViewer},
	'image/bmp': {nameTKey: 'files-type.bmp', thumbnail: ImageThumbnail, viewer: ImageViewer},
	'image/vnd.microsoft.icon': {nameTKey: 'files-type.ico', thumbnail: ImageThumbnail, viewer: ImageViewer},
	'image/tiff': {nameTKey: 'files-type.tiff', thumbnail: ImageThumbnail, viewer: null},

	// Audio
	'audio/mpeg': {nameTKey: 'files-type.mp3', thumbnail: AudioThumbnail, viewer: AudioViewer},
	'audio/mp4': {nameTKey: 'files-type.mp4-audio', thumbnail: AudioThumbnail, viewer: AudioViewer},
	'audio/wav': {nameTKey: 'files-type.wav', thumbnail: AudioThumbnail, viewer: AudioViewer},
	'audio/aac': {nameTKey: 'files-type.aac', thumbnail: AudioThumbnail, viewer: AudioViewer},
	'audio/aacp': {nameTKey: 'files-type.aac', thumbnail: AudioThumbnail, viewer: AudioViewer},
	'audio/webm': {nameTKey: 'files-type.webm-audio', thumbnail: AudioThumbnail, viewer: AudioViewer},
	'audio/ogg': {nameTKey: 'files-type.ogg', thumbnail: AudioThumbnail, viewer: AudioViewer},
	'audio/x-flac': {nameTKey: 'files-type.flac', thumbnail: AudioThumbnail, viewer: AudioViewer},
	'audio/x-m4a': {nameTKey: 'files-type.m4a', thumbnail: AudioThumbnail, viewer: AudioViewer},
	'audio/x-wav': {nameTKey: 'files-type.wav', thumbnail: AudioThumbnail, viewer: AudioViewer},
	'audio/x-caf': {nameTKey: 'files-type.caf', thumbnail: AudioThumbnail, viewer: AudioViewer},
	'audio/x-aiff': {nameTKey: 'files-type.aiff', thumbnail: AudioThumbnail, viewer: null},
	'audio/basic': {nameTKey: 'files-type.au', thumbnail: AudioThumbnail, viewer: null},
	'audio/midi': {nameTKey: 'files-type.midi', thumbnail: AudioThumbnail, viewer: null},
	'audio/x-midi': {nameTKey: 'files-type.midi', thumbnail: AudioThumbnail, viewer: null},
	'audio/flac': {nameTKey: 'files-type.flac', thumbnail: AudioThumbnail, viewer: null},
	'audio/x-matroska': {nameTKey: 'files-type.mka', thumbnail: AudioThumbnail, viewer: null},
	'audio/x-mpegurl': {nameTKey: 'files-type.m3u', thumbnail: AudioThumbnail, viewer: null},
	'audio/x-ms-wma': {nameTKey: 'files-type.wma', thumbnail: AudioThumbnail, viewer: null},

	// Video
	'video/mp4': {nameTKey: 'files-type.mp4', thumbnail: VideoThumbnail, viewer: VideoViewer},
	'video/quicktime': {nameTKey: 'files-type.quicktime', thumbnail: VideoThumbnail, viewer: VideoViewer},
	'video/webm': {nameTKey: 'files-type.webm', thumbnail: VideoThumbnail, viewer: VideoViewer},
	'video/ogg': {nameTKey: 'files-type.ogv', thumbnail: VideoThumbnail, viewer: VideoViewer},
	'video/mpeg': {nameTKey: 'files-type.mpeg', thumbnail: VideoThumbnail, viewer: VideoViewer},
	'video/x-m4v': {nameTKey: 'files-type.m4v', thumbnail: VideoThumbnail, viewer: VideoViewer},
	'video/x-matroska': {nameTKey: 'files-type.mkv', thumbnail: VideoThumbnail, viewer: null},
	'video/3gpp': {nameTKey: 'files-type.3gp', thumbnail: VideoThumbnail, viewer: null},
	'video/3gpp2': {nameTKey: 'files-type.3gp2', thumbnail: VideoThumbnail, viewer: null},
	'video/x-flv': {nameTKey: 'files-type.flv', thumbnail: VideoThumbnail, viewer: null},
	'video/x-msvideo': {nameTKey: 'files-type.avi', thumbnail: VideoThumbnail, viewer: null},
	'video/x-ms-wmv': {nameTKey: 'files-type.wmv', thumbnail: VideoThumbnail, viewer: null},
	'video/x-sgi-movie': {nameTKey: 'files-type.sgi', thumbnail: VideoThumbnail, viewer: null},
	'video/mp2t': {nameTKey: 'files-type.ts', thumbnail: VideoThumbnail, viewer: null},
	'video/x-dv': {nameTKey: 'files-type.dv', thumbnail: VideoThumbnail, viewer: null},
	'video/vnd.dlna.mpeg-tts': {nameTKey: 'files-type.mpeg-ts', thumbnail: VideoThumbnail, viewer: null},
	'video/x-mng': {nameTKey: 'files-type.mng', thumbnail: VideoThumbnail, viewer: null},
} as const

export type FileType = keyof typeof FILE_TYPE_MAP
