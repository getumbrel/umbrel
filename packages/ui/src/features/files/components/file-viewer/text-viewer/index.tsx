import {linter, type Diagnostic} from '@codemirror/lint'
import {SearchCursor} from '@codemirror/search'
import {RangeSetBuilder, StateEffect, StateField, type Extension} from '@codemirror/state'
import {Decoration, EditorView, type DecorationSet} from '@codemirror/view'
import CodeMirror, {type ReactCodeMirrorRef} from '@uiw/react-codemirror'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {FaEye, FaEyeSlash} from 'react-icons/fa'
import {RiCloseLine, RiEditLine, RiSave3Line} from 'react-icons/ri'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
	getFileExtension,
	getLanguageLabel,
	isMarkdownFile,
	loadLanguageExtension,
} from '@/features/files/components/file-viewer/text-viewer/language-map'
import {MarkdownPreview} from '@/features/files/components/file-viewer/text-viewer/markdown-preview'
import {umbrelTheme} from '@/features/files/components/file-viewer/text-viewer/umbrel-theme'
import {ViewerWrapper} from '@/features/files/components/file-viewer/viewer-wrapper'
import {APPS_PATH} from '@/features/files/constants'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {useWallpaper} from '@/providers/wallpaper'
import {trpcReact} from '@/trpc/trpc'

const MAX_EDITOR_FILE_SIZE = 1_048_576 * 50 // 50MB

const BASIC_SETUP = {
	lineNumbers: true,
	highlightActiveLineGutter: true,
	highlightActiveLine: true,
	foldGutter: false,
	dropCursor: true,
	allowMultipleSelections: false,
	indentOnInput: true,
	bracketMatching: true,
	closeBrackets: true,
	autocompletion: false,
	rectangularSelection: false,
	crosshairCursor: false,
	highlightSelectionMatches: true,
	closeBracketsKeymap: true,
	searchKeymap: false,
	foldKeymap: false,
	completionKeymap: false,
	lintKeymap: true,
} as const

const EDITOR_STYLE = {height: '100%', overflow: 'auto'} as const

// Custom search highlight system using CodeMirror decorations
const setSearchHighlights = StateEffect.define<{query: string}>()

const searchHighlightMark = Decoration.mark({class: 'cm-umbrel-search-match'})

const searchHighlightField = StateField.define<DecorationSet>({
	create() {
		return Decoration.none
	},
	update(decorations, tr) {
		for (const e of tr.effects) {
			if (e.is(setSearchHighlights)) {
				if (!e.value.query) return Decoration.none
				const builder = new RangeSetBuilder<Decoration>()
				const cursor = new SearchCursor(tr.state.doc, e.value.query)
				while (!cursor.next().done) {
					builder.add(cursor.value.from, cursor.value.to, searchHighlightMark)
				}
				return builder.finish()
			}
		}
		return decorations
	},
	provide: (f) => EditorView.decorations.from(f),
})

const searchHighlightTheme = EditorView.baseTheme({
	'.cm-umbrel-search-match': {
		backgroundColor: '#facc15',
		color: '#000',
		borderRadius: '2px',
	},
})

interface TextViewerProps {
	item: FileSystemItem
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function TextViewer({item}: TextViewerProps) {
	// Throw before any hooks — ErrorBoundary catches this and shows download dialog
	if (item.size && item.size > MAX_EDITOR_FILE_SIZE) {
		throw new Error('File too large for text editor')
	}

	const {t} = useTranslation()
	const viewerMode = useFilesStore((s) => s.viewerMode)
	const setViewerItem = useFilesStore((s) => s.setViewerItem)
	const isReadOnly = useIsFilesReadOnly()
	const utils = trpcReact.useUtils()
	const {wallpaper} = useWallpaper()
	const isPreviewMode = viewerMode === 'preview'
	const [isEditing, setIsEditing] = useState(!isPreviewMode && !isReadOnly)
	const editable = isEditing && !isReadOnly

	const editorRef = useRef<ReactCodeMirrorRef>(null)
	const [content, setContent] = useState<string | null>(null)
	const [originalContent, setOriginalContent] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [saveState, setSaveState] = useState<SaveState>('idle')
	const [languageExtension, setLanguageExtension] = useState<Extension | null>(null)
	const [showMarkdownPreview, setShowMarkdownPreview] = useState(isMarkdownFile(item.name, item.type))
	const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
	const [isClosing, setIsClosing] = useState(false)
	const [showSearch, setShowSearch] = useState(false)
	const [searchQuery, setSearchQuery] = useState('')
	const [showDiscardDialog, setShowDiscardDialog] = useState(false)
	const searchInputRef = useRef<HTMLInputElement>(null)
	const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const savingRef = useRef(false)

	const hasUnsavedChanges = content !== null && originalContent !== null && content !== originalContent
	const isSensitive = checkSensitivity(item.path)
	const isMarkdown = isMarkdownFile(item.name, item.type)
	const languageLabel = getLanguageLabel(item.name, item.type)
	const ext = getFileExtension(item.name)
	const isPreviewUI = !editable && !isEditing

	// Reset markdown preview when file changes (prevents carrying over state from a previous .md file)
	useEffect(() => {
		setShowMarkdownPreview(isMarkdown)
	}, [item.path])

	// Focus the editor for empty files (e.g. newly created text files)
	useEffect(() => {
		if (!loading && content === '') {
			setTimeout(() => editorRef.current?.view?.focus(), 50)
		}
	}, [loading, content])

	// Fetch file content
	useEffect(() => {
		const fetchContent = async () => {
			try {
				const response = await fetch(`/api/files/view?path=${encodeURIComponent(item.path)}`)
				if (!response.ok) {
					setError(response.status === 404 ? 'not-found' : 'fetch-error')
					setLoading(false)
					return
				}

				const arrayBuffer = await response.arrayBuffer()

				try {
					const decoder = new TextDecoder('utf-8', {fatal: true})
					const text = decoder.decode(arrayBuffer)
					setContent(text)
					setOriginalContent(text)
				} catch {
					setError('encoding')
					setLoading(false)
					return
				}

				setLoading(false)
			} catch {
				setError('fetch-error')
				setLoading(false)
			}
		}

		fetchContent()
	}, [item.path, item.size])

	// Load language extension
	useEffect(() => {
		loadLanguageExtension(item.name, item.type).then(setLanguageExtension)
	}, [item.name, item.type])

	// beforeunload handler
	useEffect(() => {
		if (!hasUnsavedChanges) return
		const handler = (e: BeforeUnloadEvent) => e.preventDefault()
		window.addEventListener('beforeunload', handler)
		return () => window.removeEventListener('beforeunload', handler)
	}, [hasUnsavedChanges])

	// Save
	const handleSave = useCallback(async () => {
		if (!editable || content === null || savingRef.current) return
		savingRef.current = true
		setSaveState('saving')

		try {
			const response = await fetch(`/api/files/upload?path=${encodeURIComponent(item.path)}&collision=replace`, {
				method: 'POST',
				body: content,
				headers: {'Content-Type': 'text/plain; charset=utf-8'},
			})

			if (!response.ok) {
				setSaveState('error')
				if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
				saveTimeoutRef.current = setTimeout(() => setSaveState('idle'), 3000)
				return
			}

			setOriginalContent(content)
			setSaveState('saved')
			setLastSavedAt(new Date())
			// Invalidate directory listing so modified date updates
			const dirPath = item.path.split('/').slice(0, -1).join('/')
			utils.files.list.invalidate({path: dirPath})
			if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
			saveTimeoutRef.current = setTimeout(() => setSaveState('idle'), 2000)
		} catch {
			setSaveState('error')
			if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
			saveTimeoutRef.current = setTimeout(() => setSaveState('idle'), 3000)
		} finally {
			savingRef.current = false
		}
	}, [content, editable, item.path])

	const handleClose = useCallback(() => {
		if (hasUnsavedChanges) {
			setShowDiscardDialog(true)
			return
		}
		setIsClosing(true)
		setTimeout(() => setViewerItem(null), 150)
	}, [hasUnsavedChanges, setViewerItem])

	const handleDiscardAndClose = useCallback(() => {
		setShowDiscardDialog(false)
		setIsClosing(true)
		setTimeout(() => setViewerItem(null), 150)
	}, [setViewerItem])

	// Keyboard shortcuts: Cmd+S, Cmd+F, Escape
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 's') {
				e.preventDefault()
				handleSave()
			}
			if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
				e.preventDefault()
				setShowSearch(true)
				setTimeout(() => searchInputRef.current?.focus(), 0)
			}
			if (e.key === 'Escape') {
				e.preventDefault()
				if (showSearch) {
					setShowSearch(false)
					setSearchQuery('')
					editorRef.current?.view?.dispatch({effects: setSearchHighlights.of({query: ''})})
				} else {
					handleClose()
				}
			}
			// Spacebar in preview mode toggles markdown preview
			if (e.key === ' ' && isPreviewUI && isMarkdown) {
				e.preventDefault()
				setShowMarkdownPreview((v) => !v)
			}
		}
		window.addEventListener('keydown', handler)
		return () => window.removeEventListener('keydown', handler)
	}, [handleSave, handleClose, showSearch, isPreviewUI, isMarkdown])

	// Search: find and highlight next match
	const searchNext = useCallback(() => {
		const view = editorRef.current?.view
		if (!view || !searchQuery) return

		const from = view.state.selection.main.to
		const cursor = new SearchCursor(view.state.doc, searchQuery, from)
		let result = cursor.next()

		// Wrap around to beginning
		if (result.done) {
			const wrapCursor = new SearchCursor(view.state.doc, searchQuery, 0)
			result = wrapCursor.next()
		}

		if (!result.done) {
			view.dispatch({
				selection: {anchor: result.value.from, head: result.value.to},
				scrollIntoView: true,
			})
		}
	}, [searchQuery])

	// Build extensions
	const editorExtensions = useMemo(() => {
		const exts: Extension[] = [umbrelTheme, searchHighlightField, searchHighlightTheme]
		if (languageExtension) exts.push(languageExtension)
		if (ext === '.json') exts.push(jsonLinter())
		return exts
	}, [languageExtension, ext])

	// Error states — glassmorphic error cards
	if (error === 'encoding' || error === 'not-found' || error === 'fetch-error') {
		const errorConfig = {
			encoding: {
				title: t('files-text-editor.error-encoding'),
				detail: t('files-text-editor.error-encoding-detail'),
				showDownload: true,
			},
			'not-found': {
				title: t('files-text-editor.error-not-found'),
				detail: t('files-text-editor.error-not-found-detail'),
				showDownload: false,
			},
			'fetch-error': {
				title: t('files-text-editor.error-fetch'),
				detail: t('files-text-editor.error-fetch-detail'),
				showDownload: false,
			},
		}[error]

		return (
			<ViewerWrapper>
				<div className='flex w-[380px] flex-col items-center gap-5 rounded-20 bg-dialog-content/70 p-8 text-center shadow-dialog backdrop-blur-2xl contrast-more:bg-dialog-content contrast-more:backdrop-blur-none'>
					<div className='flex h-14 w-14 items-center justify-center rounded-full bg-white/6'>
						<svg
							className='text-white/40'
							width='24'
							height='24'
							viewBox='0 0 24 24'
							fill='none'
							stroke='currentColor'
							strokeWidth='1.5'
						>
							<path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z' />
							<path d='M14 2v6h6' />
						</svg>
					</div>
					<div>
						<h3 className='text-15 font-semibold -tracking-2 text-white/90'>{errorConfig.title}</h3>
						<p className='mt-1.5 text-13 text-white/40'>{errorConfig.detail}</p>
					</div>
					<div className='flex gap-2'>
						{errorConfig.showDownload && (
							<a
								href={`/api/files/download?path=${encodeURIComponent(item.path)}`}
								download
								className='umbrel-button inline-flex h-[30px] items-center rounded-full border-[0.5px] border-white/20 bg-white/10 px-4 text-13 font-medium text-white/90 shadow-button-highlight-soft-hpx transition-all duration-300 hover:bg-white/15 active:scale-[0.97] active:bg-white/6'
							>
								{t('files-text-editor.download')}
							</a>
						)}
						<button
							onClick={() => setViewerItem(null)}
							className='umbrel-button inline-flex h-[30px] items-center rounded-full border-[0.5px] border-white/20 bg-white/10 px-4 text-13 font-medium text-white/90 shadow-button-highlight-soft-hpx transition-all duration-300 hover:bg-white/15 active:scale-[0.97] active:bg-white/6'
						>
							{t('files-text-editor.close')}
						</button>
					</div>
				</div>
			</ViewerWrapper>
		)
	}

	const animationClass = isPreviewUI
		? ''
		: isClosing
			? 'animate-out fade-out duration-150 fill-mode-forwards'
			: 'animate-in fade-in duration-200'
	const containerAnimationClass = isPreviewUI
		? ''
		: isClosing
			? 'animate-out fade-out zoom-out-95 duration-150'
			: 'animate-in fade-in zoom-in-95 duration-200'

	return (
		<>
			<ViewerWrapper
				dontCloseOnSpacebar={!isPreviewUI || isMarkdown}
				dontCloseOnEscape={editable}
				dontCloseOnClickOutside={editable}
				className={animationClass}
			>
				<div
					className={`relative flex h-[calc(100vh-250px)] w-[calc(100vw-40px)] max-w-[1280px] flex-col overflow-hidden rounded-20 border-hpx border-white/10 shadow-dock md:w-[calc(100vw-200px)] lg:w-[calc(100vw-300px)] ${containerAnimationClass}`}
				>
					{/* Blurred wallpaper background — same technique as Sheet component */}
					<div className='absolute inset-0 bg-black contrast-more:hidden'>
						<div
							className='absolute inset-0'
							style={{
								backgroundImage: `url(/assets/wallpapers/generated-thumbs/${wallpaper.id}.jpg)`,
								backgroundSize: 'cover',
								backgroundPosition: 'center',
								transform: 'scale(1.2) rotate(180deg)',
								filter: 'blur(48px) brightness(0.3) saturate(1.2)',
							}}
						/>
					</div>
					{/* Inner glow highlight — same as Sheet */}
					<div className='pointer-events-none absolute inset-0 z-50 rounded-20 shadow-[2px_2px_2px_0px_rgba(255,255,255,0.05)_inset]' />

					{/* Content — relative z-10 to sit above the absolute wallpaper bg */}
					<div className='relative z-10 flex min-h-0 flex-1 flex-col'>
						{/* Sensitive file warning — only in edit mode */}
						{isSensitive && editable && (
							<div className='flex items-center gap-2.5 border-b border-amber-500/10 bg-amber-500/[0.06] px-4 py-2'>
								<svg className='h-4 w-4 shrink-0 text-amber-400/80' viewBox='0 0 16 16' fill='currentColor'>
									<path d='M8 1a7 7 0 100 14A7 7 0 008 1zm0 2.5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 3.5zm0 7a.75.75 0 100-1.5.75.75 0 000 1.5z' />
								</svg>
								<span className='text-12 text-amber-300/70'>{t('files-text-editor.sensitive-warning')}</span>
							</div>
						)}

						{/* Toolbar */}
						{isPreviewUI ? (
							/* Preview mode: filename + extension pill + Edit button, same bg/border as edit mode */
							<div className='flex items-center justify-between gap-3 border-b border-white/6 bg-black/15 px-2.5 py-2.5'>
								<div className='flex min-w-0 items-center gap-2 pl-0.5'>
									<span className='shrink-0 rounded-full bg-white/6 px-2 py-0.5 text-11 font-medium text-white/30'>
										{ext.replace('.', '').toUpperCase() || 'TXT'}
									</span>
									<span className='min-w-0 truncate text-13 font-medium -tracking-2 text-white/80'>{item.name}</span>
								</div>
								<div className='pr-0.5'>
									{!isReadOnly && (
										<button
											onClick={() => setIsEditing(true)}
											className='umbrel-button inline-flex h-[30px] items-center gap-1.5 rounded-full border-[0.5px] border-white/10 bg-white/6 px-3 text-12 font-medium text-white/75 transition-colors duration-300 hover:bg-white/10 active:bg-white/6'
										>
											<RiEditLine className='h-3.5 w-3.5 opacity-80' />
											{t('files-text-editor.edit')}
										</button>
									)}
								</div>
							</div>
						) : (
							/* Edit mode: full toolbar with save, close, etc. */
							<div className='flex items-center justify-between gap-3 border-b border-white/6 bg-black/15 px-2.5 py-2.5'>
								<div className='flex min-w-0 items-center gap-2 pl-0.5'>
									<span className='shrink-0 rounded-full bg-white/6 px-2 py-0.5 text-11 font-medium text-white/30'>
										{ext.replace('.', '').toUpperCase() || 'TXT'}
									</span>
									<span className='min-w-0 truncate text-13 font-medium -tracking-2 text-white/80'>{item.name}</span>
									{hasUnsavedChanges && <span className='h-[6px] w-[6px] shrink-0 rounded-full bg-amber-400' />}
								</div>

								<div className='flex shrink-0 items-center gap-1.5 pr-0.5'>
									{isReadOnly && (
										<span className='rounded-full bg-white/6 px-2.5 py-1 text-11 text-white/30'>
											{t('files-text-editor.read-only')}
										</span>
									)}

									{editable && (
										<>
											{isMarkdown && (
												<button
													onClick={() => setShowMarkdownPreview((v) => !v)}
													title={
														showMarkdownPreview ? t('files-text-editor.hide-preview') : t('files-text-editor.preview')
													}
													className='umbrel-button inline-flex h-[30px] items-center gap-1.5 rounded-full border-[0.5px] border-white/10 bg-white/6 px-3 text-12 font-medium text-white/75 transition-colors duration-300 hover:bg-white/10 active:bg-white/6'
												>
													{showMarkdownPreview ? (
														<FaEyeSlash className='h-3 w-3 opacity-80' />
													) : (
														<FaEye className='h-3 w-3 opacity-80' />
													)}
													{showMarkdownPreview ? t('files-text-editor.hide-preview') : t('files-text-editor.preview')}
												</button>
											)}

											<button
												onClick={handleSave}
												disabled={saveState === 'saving' || !hasUnsavedChanges}
												className={`umbrel-button inline-flex h-[30px] items-center gap-1.5 rounded-full border-[0.5px] px-3 text-12 font-medium transition-[background-color] duration-300 ${
													hasUnsavedChanges
														? 'border-transparent bg-brand text-white shadow-button-highlight-hpx hover:bg-brand-lighter active:bg-brand'
														: 'border-white/10 bg-white/6 text-white/75 hover:bg-white/10 active:bg-white/6'
												} disabled:opacity-40 disabled:shadow-none`}
											>
												{saveState === 'saving' ? (
													<Spinner />
												) : saveState === 'saved' ? (
													<svg
														className='h-3.5 w-3.5 opacity-80'
														viewBox='0 0 12 12'
														fill='none'
														stroke='currentColor'
														strokeWidth='2'
													>
														<path d='M2 6l3 3 5-5' />
													</svg>
												) : (
													<RiSave3Line className='h-3.5 w-3.5 opacity-80' />
												)}
												{saveState === 'saving'
													? t('files-text-editor.saving')
													: saveState === 'saved'
														? t('files-text-editor.saved')
														: saveState === 'error'
															? t('files-text-editor.save-failed')
															: t('files-text-editor.save')}
											</button>
										</>
									)}

									<button
										onClick={handleClose}
										className='umbrel-button inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border-[0.5px] border-white/10 bg-white/6 text-white/75 transition-colors duration-300 hover:bg-white/10 active:bg-white/6'
									>
										<RiCloseLine className='h-4 w-4 text-white/75' />
									</button>
								</div>
							</div>
						)}

						{/* Search pill — floating over the editor */}
						{showSearch && (
							<div className='absolute top-14 right-4 z-20'>
								<input
									ref={searchInputRef}
									type='text'
									value={searchQuery}
									onChange={(e) => {
										const query = e.target.value
										setSearchQuery(query)
										const view = editorRef.current?.view
										if (!view) return
										// Dispatch highlight decorations for all matches
										view.dispatch({effects: setSearchHighlights.of({query})})
										// Jump to first match
										if (!query) return
										const cursor = new SearchCursor(view.state.doc, query, 0)
										const result = cursor.next()
										if (!result.done) {
											view.dispatch({
												selection: {anchor: result.value.from, head: result.value.to},
												scrollIntoView: true,
											})
										}
									}}
									onKeyDown={(e) => {
										if (e.key === 'Enter') {
											e.preventDefault()
											searchNext()
										}
										if (e.key === 'Escape') {
											e.preventDefault()
											setShowSearch(false)
											setSearchQuery('')
											editorRef.current?.view?.dispatch({effects: setSearchHighlights.of({query: ''})})
										}
									}}
									placeholder={t('files-text-editor.search-placeholder')}
									className='h-[32px] w-[220px] rounded-full border-[0.5px] border-white/10 bg-black/40 px-3.5 text-13 text-white/90 shadow-dialog backdrop-blur-xl placeholder:text-white/25 focus:border-white/25 focus:outline-none'
								/>
							</div>
						)}

						{/* Editor + optional markdown preview */}
						{/* Below md: preview takes over (full width, replaces editor). md+: side-by-side split. */}
						<div className='flex min-h-0 flex-1 overflow-hidden'>
							<div
								className={`min-h-0 min-w-0 overflow-hidden ${showMarkdownPreview ? (isPreviewUI ? 'hidden' : 'hidden md:block md:w-1/2') : 'w-full'}`}
							>
								{loading ? (
									<div className='flex h-full items-center justify-center'>
										<Spinner className='h-5 w-5 text-white/20' />
									</div>
								) : (
									<CodeMirror
										ref={editorRef}
										className='!bg-transparent [&_.cm-editor]:!bg-transparent [&_.cm-gutters]:!bg-transparent [&_.cm-scroller]:!bg-transparent'
										value={content ?? ''}
										onChange={editable ? (value) => setContent(value) : undefined}
										extensions={editorExtensions}
										editable={editable}
										basicSetup={BASIC_SETUP}
										height='100%'
										style={EDITOR_STYLE}
									/>
								)}
							</div>

							{showMarkdownPreview && content !== null && (
								<div className={isPreviewUI ? 'w-full' : 'w-full border-white/6 md:w-1/2 md:border-l'}>
									<MarkdownPreview content={content} />
								</div>
							)}
						</div>

						{/* Status bar — only in edit mode */}
						{!isPreviewUI && (
							<div className='flex items-center justify-between border-t border-white/6 bg-black/15 px-4 py-1 text-11 text-white/30'>
								<div className='flex items-center gap-3'>
									<span>{languageLabel}</span>
									<span>UTF-8</span>
									{lastSavedAt && <span className='text-white/30'>Saved {formatTimeAgo(lastSavedAt)}</span>}
								</div>
								<div className='flex items-center gap-3'>
									{content !== null && <span>{content.split('\n').length} lines</span>}
									{item.size !== undefined && <span>{formatBytes(item.size)}</span>}
								</div>
							</div>
						)}
					</div>
					{/* close content z-10 wrapper */}
				</div>
			</ViewerWrapper>

			{/* Discard unsaved changes dialog */}
			<AlertDialog open={showDiscardDialog} onOpenChange={setShowDiscardDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('files-text-editor.discard-title')}</AlertDialogTitle>
						<AlertDialogDescription>{t('files-text-editor.discard-description')}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction variant='destructive' onClick={handleDiscardAndClose}>
							{t('files-text-editor.discard-confirm')}
						</AlertDialogAction>
						<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}

function ToolbarToggle({
	active,
	onClick,
	title,
	children,
}: {
	active: boolean
	onClick: () => void
	title: string
	children: React.ReactNode
}) {
	return (
		<button
			onClick={onClick}
			title={title}
			className={`rounded-full px-2.5 py-1 text-11 font-medium transition-colors duration-300 ${
				active ? 'bg-white/10 text-white/70' : 'text-white/25 hover:bg-white/6 hover:text-white/40'
			}`}
		>
			{children}
		</button>
	)
}

// Only warn for files inside an app's data directory: /Apps/<app-id>/...
function checkSensitivity(path: string): boolean {
	if (!path.startsWith(APPS_PATH + '/')) return false
	// Must be at least /Apps/<app-id>/<something> (3+ segments after split)
	const segments = path.slice(APPS_PATH.length + 1).split('/')
	return segments.length >= 2
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B'
	const k = 1024
	const sizes = ['B', 'KB', 'MB', 'GB']
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatTimeAgo(date: Date): string {
	const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
	if (seconds < 5) return 'just now'
	if (seconds < 60) return `${seconds}s ago`
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`
	return `${Math.floor(minutes / 60)}h ago`
}

function jsonLinter(): Extension {
	return linter((view) => {
		const diagnostics: Diagnostic[] = []
		const text = view.state.doc.toString()
		if (!text.trim()) return diagnostics
		try {
			JSON.parse(text)
		} catch (e) {
			if (e instanceof SyntaxError) {
				const match = e.message.match(/position (\d+)/)
				const pos = match ? parseInt(match[1]) : 0
				diagnostics.push({
					from: Math.min(pos, text.length),
					to: Math.min(pos + 1, text.length),
					severity: 'error',
					message: e.message,
				})
			}
		}
		return diagnostics
	})
}

function Spinner({className = 'h-3.5 w-3.5'}: {className?: string}) {
	return (
		<svg className={`animate-spin ${className}`} viewBox='0 0 24 24' fill='none'>
			<circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='3' />
			<path className='opacity-75' fill='currentColor' d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z' />
		</svg>
	)
}
