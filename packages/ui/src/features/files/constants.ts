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
import {viewers} from '@/features/files/components/file-viewer/viewers'

export const BASE_ROUTE_PATH = '/files' as const
export const HOME_PATH = '/Home' as const
export const TRASH_PATH = '/Trash' as const
export const APPS_PATH = '/Apps' as const
export const MACHINES_PATH = '/Machines' as const
export const EXTERNAL_STORAGE_PATH = '/External' as const
export const NETWORK_STORAGE_PATH = '/Network' as const
export const BACKUPS_PATH = '/Backups' as const

// Roots whose direct children are created by umbrelOS itself (app data
// directories by app installs, machine directories by Machines). Files never
// offers to write into them: no uploads, new folders, paste or drops.
export const SYSTEM_MANAGED_ROOT_PATHS: ReadonlySet<string> = new Set([APPS_PATH, MACHINES_PATH])

// NOTE: Search and Recents are not real directories on disk. They are
// pseudo-directories, i.e. they are handled client-side only and are just
// virtual routes that show a flat list of file items returned by the backend
// search and recents endpoints.
export const SEARCH_PATH = '/Search' as const
export const RECENTS_PATH = '/Recents' as const

// Cloud is also not a real directory on disk: /Cloud/<accountId> is a virtual
// route listing a connected account's download destination folders.
export const CLOUD_PATH = '/Cloud' as const

// Cloud provider logos keyed by backend provider id, plus the UI-only
// WebDAV flavors (Nextcloud/ownCloud). Served from public/ because the CSP
// blocks data: URIs, so they must never be inlined.
export const CLOUD_PROVIDER_LOGOS: Record<string, string> = {
	'google-drive': '/assets/cloud/google-drive.svg',
	dropbox: '/assets/cloud/dropbox.svg',
	onedrive: '/assets/cloud/onedrive.svg',
	webdav: '/assets/cloud/webdav.svg',
	icloud: '/assets/cloud/icloud.webp',
	nextcloud: '/assets/cloud/nextcloud.svg',
	owncloud: '/assets/cloud/owncloud.svg',
}

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

// Keep these client-side sets aligned with PHOTO_EXTENSIONS and
// VIDEO_EXTENSIONS in umbreld/source/modules/photos/types.ts.
export const IMAGE_EXTENSIONS_WITH_IMAGE_THUMBNAILS = new Set([
	'.jpg',
	'.jpeg',
	'.jfif',
	'.jpe',
	'.png',
	'.gif',
	'.webp',
	'.avif',
	'.heic',
	'.heif',
	'.tif',
	'.tiff',
	'.bmp',
	'.dng',
	'.cr2',
	'.cr3',
	'.nef',
	'.arw',
	'.raf',
	'.orf',
	'.rw2',
])
export const VIDEO_EXTENSIONS_WITH_IMAGE_THUMBNAILS = new Set([
	'.mp4',
	'.mov',
	'.m4v',
	'.mkv',
	'.webm',
	'.avi',
	'.3gp',
	'.3g2',
	'.mts',
	'.m2ts',
	'.mpg',
	'.mpeg',
	'.wmv',
	'.360',
	'.insv',
])

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
	'application/zip': {nameTKey: 'files-type.zip', thumbnail: ZipThumbnail, viewer: viewers.archive},
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
	'application/pdf': {nameTKey: 'files-type.pdf', thumbnail: PdfThumbnail, viewer: viewers.pdf},
	'text/csv': {nameTKey: 'files-type.csv', thumbnail: CsvThumbnail, viewer: viewers.sheet},
	'text/tab-separated-values': {nameTKey: 'files-type.tsv', thumbnail: CsvThumbnail, viewer: viewers.sheet},

	// Text / Code (editable via TextViewer)
	'text/plain': {nameTKey: 'files-type.txt', thumbnail: TxtThumbnail, viewer: viewers.text},
	'text/yaml': {nameTKey: 'files-type.yaml', thumbnail: TxtThumbnail, viewer: viewers.text},
	'application/json': {nameTKey: 'files-type.json', thumbnail: TxtThumbnail, viewer: viewers.text},
	'text/javascript': {nameTKey: 'files-type.javascript', thumbnail: TxtThumbnail, viewer: viewers.text},
	'application/javascript': {nameTKey: 'files-type.javascript', thumbnail: TxtThumbnail, viewer: viewers.text},
	'application/node': {nameTKey: 'files-type.javascript', thumbnail: TxtThumbnail, viewer: viewers.text},
	'text/jsx': {nameTKey: 'files-type.javascript', thumbnail: TxtThumbnail, viewer: viewers.text},
	'text/css': {nameTKey: 'files-type.css', thumbnail: TxtThumbnail, viewer: viewers.text},
	'text/html': {nameTKey: 'files-type.html', thumbnail: TxtThumbnail, viewer: viewers.text},
	'text/markdown': {nameTKey: 'files-type.markdown', thumbnail: TxtThumbnail, viewer: viewers.text},
	'text/x-python': {nameTKey: 'files-type.python', thumbnail: TxtThumbnail, viewer: viewers.text},
	'application/x-sh': {nameTKey: 'files-type.shell', thumbnail: TxtThumbnail, viewer: viewers.text},
	'text/x-shellscript': {nameTKey: 'files-type.shell', thumbnail: TxtThumbnail, viewer: viewers.text},
	'text/xml': {nameTKey: 'files-type.xml', thumbnail: TxtThumbnail, viewer: viewers.text},
	'application/xml': {nameTKey: 'files-type.xml', thumbnail: TxtThumbnail, viewer: viewers.text},
	'application/toml': {nameTKey: 'files-type.toml', thumbnail: TxtThumbnail, viewer: viewers.text},
	'text/x-toml': {nameTKey: 'files-type.toml', thumbnail: TxtThumbnail, viewer: viewers.text},
	'application/x-subrip': {nameTKey: 'files-type.srt', thumbnail: TxtThumbnail, viewer: viewers.text},
	'text/vtt': {nameTKey: 'files-type.vtt', thumbnail: TxtThumbnail, viewer: viewers.text},
	'application/x-sql': {nameTKey: 'files-type.sql', thumbnail: TxtThumbnail, viewer: viewers.text},
	'text/x-c': {nameTKey: 'files-type.source-code', thumbnail: TxtThumbnail, viewer: viewers.text},
	'text/x-java-source': {nameTKey: 'files-type.source-code', thumbnail: TxtThumbnail, viewer: viewers.text},
	'application/x-httpd-php': {nameTKey: 'files-type.source-code', thumbnail: TxtThumbnail, viewer: viewers.text},
	'application/x-perl': {nameTKey: 'files-type.source-code', thumbnail: TxtThumbnail, viewer: viewers.text},
	// Other text types open too, without a name of their own (see getFileViewer)

	// Ebooks
	'application/epub+zip': {nameTKey: 'files-type.epub', thumbnail: EbookThumbnail, viewer: null},
	'application/x-mobipocket-ebook': {nameTKey: 'files-type.mobi', thumbnail: EbookThumbnail, viewer: null},

	// Microsoft Office (the binary pre-2007 formats have no viewer)
	'application/msword': {nameTKey: 'files-type.word', thumbnail: DocxThumbnail, viewer: null},
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
		nameTKey: 'files-type.word',
		thumbnail: DocxThumbnail,
		viewer: viewers.document,
	},
	'application/vnd.ms-word.document.macroenabled.12': {
		nameTKey: 'files-type.word',
		thumbnail: DocxThumbnail,
		viewer: viewers.document,
	},
	'application/vnd.openxmlformats-officedocument.wordprocessingml.template': {
		nameTKey: 'files-type.word',
		thumbnail: DocxThumbnail,
		viewer: viewers.document,
	},
	'application/vnd.ms-excel': {nameTKey: 'files-type.excel', thumbnail: CsvThumbnail, viewer: null},
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
		nameTKey: 'files-type.excel',
		thumbnail: CsvThumbnail,
		viewer: viewers.sheet,
	},
	'application/vnd.ms-excel.sheet.macroenabled.12': {
		nameTKey: 'files-type.excel',
		thumbnail: CsvThumbnail,
		viewer: viewers.sheet,
	},
	'application/vnd.openxmlformats-officedocument.spreadsheetml.template': {
		nameTKey: 'files-type.excel',
		thumbnail: CsvThumbnail,
		viewer: viewers.sheet,
	},
	'application/vnd.ms-powerpoint': {nameTKey: 'files-type.powerpoint', thumbnail: PptThumbnail, viewer: null},
	'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
		nameTKey: 'files-type.powerpoint',
		thumbnail: PptThumbnail,
		viewer: viewers.slides,
	},
	'application/vnd.ms-powerpoint.presentation.macroenabled.12': {
		nameTKey: 'files-type.powerpoint',
		thumbnail: PptThumbnail,
		viewer: viewers.slides,
	},
	'application/vnd.openxmlformats-officedocument.presentationml.slideshow': {
		nameTKey: 'files-type.powerpoint',
		thumbnail: PptThumbnail,
		viewer: viewers.slides,
	},
	'application/vnd.openxmlformats-officedocument.presentationml.template': {
		nameTKey: 'files-type.powerpoint',
		thumbnail: PptThumbnail,
		viewer: viewers.slides,
	},

	// Apple iWork: Apple's own preview of the first page
	'application/vnd.apple.numbers': {nameTKey: 'files-type.numbers', thumbnail: CsvThumbnail, viewer: viewers.iwork},
	'application/vnd.apple.pages': {nameTKey: 'files-type.pages', thumbnail: DocxThumbnail, viewer: viewers.iwork},
	'application/vnd.apple.keynote': {nameTKey: 'files-type.keynote', thumbnail: PptThumbnail, viewer: viewers.iwork},

	// Images
	'image/svg+xml': {nameTKey: 'files-type.svg', thumbnail: ImageThumbnail, viewer: viewers.image},
	'image/avif': {nameTKey: 'files-type.avif', thumbnail: ImageThumbnail, viewer: viewers.image},
	'image/webp': {nameTKey: 'files-type.webp', thumbnail: ImageThumbnail, viewer: viewers.image},
	'image/heic': {nameTKey: 'files-type.heic', thumbnail: ImageThumbnail, viewer: viewers.image},
	'image/heif': {nameTKey: 'files-type.heif', thumbnail: ImageThumbnail, viewer: viewers.image},
	'image/jpeg': {nameTKey: 'files-type.jpeg', thumbnail: ImageThumbnail, viewer: viewers.image},
	'image/png': {nameTKey: 'files-type.png', thumbnail: ImageThumbnail, viewer: viewers.image},
	'image/gif': {nameTKey: 'files-type.gif', thumbnail: ImageThumbnail, viewer: viewers.image},
	'image/bmp': {nameTKey: 'files-type.bmp', thumbnail: ImageThumbnail, viewer: viewers.image},
	'image/vnd.microsoft.icon': {nameTKey: 'files-type.ico', thumbnail: ImageThumbnail, viewer: viewers.image},
	'image/tiff': {nameTKey: 'files-type.tiff', thumbnail: ImageThumbnail, viewer: viewers.image},
	'image/x-adobe-dng': {nameTKey: 'files-type.raw', thumbnail: ImageThumbnail, viewer: viewers.image},
	'image/x-canon-cr2': {nameTKey: 'files-type.raw', thumbnail: ImageThumbnail, viewer: viewers.image},
	'image/x-canon-cr3': {nameTKey: 'files-type.raw', thumbnail: ImageThumbnail, viewer: viewers.image},
	'image/x-nikon-nef': {nameTKey: 'files-type.raw', thumbnail: ImageThumbnail, viewer: viewers.image},
	'image/x-sony-arw': {nameTKey: 'files-type.raw', thumbnail: ImageThumbnail, viewer: viewers.image},
	'image/x-fuji-raf': {nameTKey: 'files-type.raw', thumbnail: ImageThumbnail, viewer: viewers.image},
	'image/x-olympus-orf': {nameTKey: 'files-type.raw', thumbnail: ImageThumbnail, viewer: viewers.image},
	'image/x-panasonic-rw2': {nameTKey: 'files-type.raw', thumbnail: ImageThumbnail, viewer: viewers.image},

	// Audio
	'audio/mpeg': {nameTKey: 'files-type.mp3', thumbnail: AudioThumbnail, viewer: viewers.audio},
	'audio/mp4': {nameTKey: 'files-type.mp4-audio', thumbnail: AudioThumbnail, viewer: viewers.audio},
	'audio/wav': {nameTKey: 'files-type.wav', thumbnail: AudioThumbnail, viewer: viewers.audio},
	'audio/wave': {nameTKey: 'files-type.wav', thumbnail: AudioThumbnail, viewer: viewers.audio},
	'audio/aac': {nameTKey: 'files-type.aac', thumbnail: AudioThumbnail, viewer: viewers.audio},
	'audio/aacp': {nameTKey: 'files-type.aac', thumbnail: AudioThumbnail, viewer: viewers.audio},
	'audio/x-aac': {nameTKey: 'files-type.aac', thumbnail: AudioThumbnail, viewer: viewers.audio},
	'audio/webm': {nameTKey: 'files-type.webm-audio', thumbnail: AudioThumbnail, viewer: viewers.audio},
	'audio/ogg': {nameTKey: 'files-type.ogg', thumbnail: AudioThumbnail, viewer: viewers.audio},
	'audio/flac': {nameTKey: 'files-type.flac', thumbnail: AudioThumbnail, viewer: viewers.audio},
	'audio/x-flac': {nameTKey: 'files-type.flac', thumbnail: AudioThumbnail, viewer: viewers.audio},
	'audio/x-m4a': {nameTKey: 'files-type.m4a', thumbnail: AudioThumbnail, viewer: viewers.audio},
	'audio/x-wav': {nameTKey: 'files-type.wav', thumbnail: AudioThumbnail, viewer: viewers.audio},
	'audio/x-caf': {nameTKey: 'files-type.caf', thumbnail: AudioThumbnail, viewer: viewers.audio},
	'audio/x-matroska': {nameTKey: 'files-type.mka', thumbnail: AudioThumbnail, viewer: viewers.audio},
	'audio/x-aiff': {nameTKey: 'files-type.aiff', thumbnail: AudioThumbnail, viewer: null},
	'audio/basic': {nameTKey: 'files-type.au', thumbnail: AudioThumbnail, viewer: null},
	'audio/midi': {nameTKey: 'files-type.midi', thumbnail: AudioThumbnail, viewer: null},
	'audio/x-midi': {nameTKey: 'files-type.midi', thumbnail: AudioThumbnail, viewer: null},
	'audio/x-mpegurl': {nameTKey: 'files-type.m3u', thumbnail: AudioThumbnail, viewer: null},
	'audio/x-ms-wma': {nameTKey: 'files-type.wma', thumbnail: AudioThumbnail, viewer: null},

	// Video
	'video/mp4': {nameTKey: 'files-type.mp4', thumbnail: VideoThumbnail, viewer: viewers.video},
	'video/quicktime': {nameTKey: 'files-type.quicktime', thumbnail: VideoThumbnail, viewer: viewers.video},
	'video/webm': {nameTKey: 'files-type.webm', thumbnail: VideoThumbnail, viewer: viewers.video},
	'video/ogg': {nameTKey: 'files-type.ogv', thumbnail: VideoThumbnail, viewer: viewers.video},
	'video/mpeg': {nameTKey: 'files-type.mpeg', thumbnail: VideoThumbnail, viewer: viewers.video},
	'video/x-m4v': {nameTKey: 'files-type.m4v', thumbnail: VideoThumbnail, viewer: viewers.video},
	'video/x-matroska': {nameTKey: 'files-type.mkv', thumbnail: VideoThumbnail, viewer: viewers.video},
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
