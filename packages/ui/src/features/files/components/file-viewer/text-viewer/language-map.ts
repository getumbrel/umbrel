import type {Extension} from '@codemirror/state'

type LanguageLoader = () => Promise<Extension>

// Maps file extensions to CodeMirror language extensions (lazy-loaded per file type)
const EXTENSION_LANGUAGE_MAP: Record<string, LanguageLoader> = {
	'.yml': () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
	'.yaml': () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
	'.json': () => import('@codemirror/lang-json').then((m) => m.json()),
	'.js': () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
	'.jsx': () => import('@codemirror/lang-javascript').then((m) => m.javascript({jsx: true})),
	'.mjs': () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
	'.cjs': () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
	'.css': () => import('@codemirror/lang-css').then((m) => m.css()),
	'.html': () => import('@codemirror/lang-html').then((m) => m.html()),
	'.htm': () => import('@codemirror/lang-html').then((m) => m.html()),
	'.md': () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
	'.markdown': () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
	'.py': () => import('@codemirror/lang-python').then((m) => m.python()),
	'.xml': () => import('@codemirror/lang-xml').then((m) => m.xml()),
	'.svg': () => import('@codemirror/lang-xml').then((m) => m.xml()),
}

// Maps MIME types to extensions for files where MIME detection works reliably
const MIME_TO_EXTENSION: Record<string, string> = {
	'text/yaml': '.yml',
	'application/json': '.json',
	'text/javascript': '.js',
	'application/javascript': '.js',
	'text/css': '.css',
	'text/html': '.html',
	'text/markdown': '.md',
	'text/x-python': '.py',
	'text/xml': '.xml',
	'application/xml': '.xml',
}

export function getFileExtension(filename: string): string {
	const lastDot = filename.lastIndexOf('.')
	if (lastDot === -1) return ''
	return filename.slice(lastDot).toLowerCase()
}

export async function loadLanguageExtension(filename: string, mimeType?: string): Promise<Extension | null> {
	// First try MIME-based lookup (more reliable for known types)
	if (mimeType && mimeType in MIME_TO_EXTENSION) {
		const ext = MIME_TO_EXTENSION[mimeType]
		const loader = EXTENSION_LANGUAGE_MAP[ext]
		if (loader) return loader()
	}

	// Fall back to extension-based lookup (handles text/plain catch-all)
	const ext = getFileExtension(filename)
	const loader = EXTENSION_LANGUAGE_MAP[ext]
	if (loader) return loader()

	// No language support — plain text
	return null
}

export function getLanguageLabel(filename: string, mimeType?: string): string {
	if (mimeType && mimeType in MIME_TO_EXTENSION) {
		const ext = MIME_TO_EXTENSION[mimeType]
		return EXTENSION_TO_LABEL[ext] ?? 'Plain Text'
	}
	const ext = getFileExtension(filename)
	return EXTENSION_TO_LABEL[ext] ?? 'Plain Text'
}

const EXTENSION_TO_LABEL: Record<string, string> = {
	'.yml': 'YAML',
	'.yaml': 'YAML',
	'.json': 'JSON',
	'.js': 'JavaScript',
	'.jsx': 'JSX',
	'.mjs': 'JavaScript',
	'.cjs': 'JavaScript',
	'.css': 'CSS',
	'.html': 'HTML',
	'.htm': 'HTML',
	'.md': 'Markdown',
	'.markdown': 'Markdown',
	'.py': 'Python',
	'.xml': 'XML',
	'.svg': 'SVG',
	'.sh': 'Shell',
	'.bash': 'Shell',
	'.env': 'Environment',
	'.conf': 'Config',
	'.ini': 'Config',
	'.toml': 'TOML',
	'.txt': 'Plain Text',
	'.log': 'Log',
}

// Returns true if a file is a markdown file (used to show preview toggle)
export function isMarkdownFile(filename: string, mimeType?: string): boolean {
	if (mimeType === 'text/markdown') return true
	const ext = getFileExtension(filename)
	return ext === '.md' || ext === '.markdown'
}
