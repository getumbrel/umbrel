// pdf.js, legacy build: the modern one calls APIs WebKit lacks. Its viewer
// components read the library from a global the library sets, so this is the
// only module that imports them, library first.
import {
	AnnotationEditorParamsType,
	AnnotationEditorType,
	AnnotationMode,
	getDocument,
	GlobalWorkerOptions,
	PasswordResponses,
	TouchManager,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import {EventBus, LinkTarget, PDFFindController, PDFLinkService, PDFViewer} from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'

export {
	AnnotationEditorParamsType,
	AnnotationEditorType,
	AnnotationMode,
	EventBus,
	LinkTarget,
	PasswordResponses,
	PDFFindController,
	PDFLinkService,
	PDFViewer,
	TouchManager,
}
export type {
	AnnotationEditorLayer,
	AnnotationEditorUIManager,
	PDFDocumentLoadingTask,
	PDFDocumentProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs'

GlobalWorkerOptions.workerSrc = workerSrc

// What pdf.js may ask for by name: the CMaps of CJK text in fonts the file
// doesn't carry, the Symbol and Dingbats fonts, and its decoders for fax,
// JBIG2 and JPEG 2000 images. Each is its own same-origin file, fetched only
// when a document needs it — never inlined, as the CSP takes neither data:
// fetches nor data: scripts.
const byName = (files: Record<string, string>) =>
	new Map(Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]))
const cMaps = byName(
	import.meta.glob<string>('/node_modules/pdfjs-dist/cmaps/*.bcmap', {
		query: '?url&no-inline',
		import: 'default',
		eager: true,
	}),
)
const standardFonts = byName(
	import.meta.glob<string>('/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', {
		query: '?url&no-inline',
		import: 'default',
		eager: true,
	}),
)
const imageDecoders = byName(
	import.meta.glob<string>('/node_modules/pdfjs-dist/wasm/*_nowasm_fallback.js', {
		query: '?url&no-inline',
		import: 'default',
		eager: true,
	}),
)
const [imageDecoderRouter] = Object.values(
	import.meta.glob<string>('./image-decoders.js', {query: '?url&no-inline', import: 'default', eager: true}),
)

// pdf.js names a sticky note's icon by appending its kind to this path
// ("annotation-key.svg"). After a '#' that name is only a fragment, so every
// note shows this one icon and none is ever a missing image: an unknown path
// would get Umbrel's page back.
const [noteIcon] = Object.values(
	import.meta.glob<string>('/node_modules/pdfjs-dist/legacy/web/images/annotation-comment.svg', {
		query: '?url&no-inline',
		import: 'default',
		eager: true,
	}),
)
export const noteIconPath = `${noteIcon}#`

// pdf.js fetches CMaps and fonts through this on the main thread
class BinaryDataFactory {
	async fetch({kind, filename}: {kind: string; filename: string}) {
		const url = (kind === 'cMapUrl' ? cMaps : standardFonts).get(filename)
		const response = url ? await fetch(url) : undefined
		if (!response?.ok) throw new Error(`Missing ${kind} ${filename}`)
		return new Uint8Array(await response.arrayBuffer())
	}
}

// Opens the file at `url`, streaming it and asking for ranges, so the first
// page shows long before a large file has arrived
export function openPdf(url: string, revision: string | undefined) {
	return getDocument({
		url,
		// Every request is for the revision a save will be checked against: a
		// file replaced while it loads fails (412) instead of mixing two
		httpHeaders: revision ? {'If-Match': revision} : undefined,
		// A font the file leaves out is drawn from pdf.js's own set, made to
		// match the standard ones, or else in the browser's generic family —
		// never looked up on the system: Chrome on macOS can hang the page
		// doing that (for STHeiti, in Chinese text)
		useSystemFonts: false,
		BinaryDataFactory,
		// The CSP has no 'wasm-unsafe-eval': straight to the JavaScript decoders
		useWasm: false,
		wasmUrl: `${imageDecoderRouter}${imageDecoderRouter.includes('?') ? '&' : '?'}${new URLSearchParams([...imageDecoders])}&/`,
	})
}
