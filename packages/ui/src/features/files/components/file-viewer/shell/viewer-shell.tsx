import * as DialogPrimitive from '@radix-ui/react-dialog'
import {Check, Download, X} from 'lucide-react'
import {useReducedMotion} from 'motion/react'
import {Suspense, useEffect, useRef, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'
import {useBlocker} from 'react-router-dom'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {ImmersiveDialog} from '@/components/ui/immersive-dialog'
import {ViewerShellContext, type ViewerSaveHandler} from '@/features/files/components/file-viewer/shell/context'
import {StageDownload, StageLoading, StageMessage} from '@/features/files/components/file-viewer/shell/stage-states'
import {toolHeightClass} from '@/features/files/components/file-viewer/shell/tool-button'
import {useViewerKeys} from '@/features/files/components/file-viewer/shell/use-viewer-keys'
import {keepFocus} from '@/features/files/components/file-viewer/shell/zoom-pill'
import type {Viewer} from '@/features/files/components/file-viewer/viewers'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {fileTypeLabel} from '@/features/files/utils/file-type-label'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {LightboxButton, lightboxButtonClass} from '@/features/photos/components/viewer/lightbox-button'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {dashboardAuthHeaders, useAuthorizedHttpUrl} from '@/modules/auth/http-auth'
import {useWallpaper, WallpaperAvifSource} from '@/providers/wallpaper'
import {trpcReact} from '@/trpc/trpc'
import {tw} from '@/utils/tw'

// How the viewer opens: the backdrop fades up over Files, the file settles in
// from a touch smaller, and a beat later the chrome rises in from its edge.
// Closing runs it backwards, the chrome leaving first. Stepping between files
// animates only the stage, a quick fade, so the title is never in motion.
// Entering fills backwards only: held at its end, an animation would leave a
// transform and a filter on the element for good, and a filter cuts the
// frosted glass inside off from what's behind it.
const CHROME_DELAY = tw`motion-safe:[animation-delay:120ms]`
const chromeEnter = {
	top: tw`motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-250 motion-safe:fill-mode-backwards`,
	bottom: tw`motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-250 motion-safe:fill-mode-backwards`,
}
const chromeLeave = tw`motion-safe:animate-out motion-safe:fade-out motion-safe:duration-150 motion-safe:fill-mode-forwards`
const backdropEnter = tw`motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300 motion-safe:fill-mode-backwards`
const backdropLeave = tw`motion-safe:animate-out motion-safe:fade-out motion-safe:duration-250 motion-safe:fill-mode-forwards`
const stageEnter = tw`motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-[0.98] motion-safe:duration-300 motion-safe:fill-mode-backwards`
const stageStep = tw`motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150`
const stageLeave = tw`motion-safe:animate-out motion-safe:fade-out motion-safe:zoom-out-[0.98] motion-safe:duration-200 motion-safe:fill-mode-forwards`
// Long enough for everything above to be gone
const LEAVE_MS = 260
// An opened file has the window, whatever its shape (see useViewerSize)
const setSize = () => {}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
// What the user was doing when the unsaved-changes prompt stopped them: closing, leaving Files, or anything else
// taking the viewer away (another file, a folder), which the store's guard held up
type Interrupted = {kind: 'close'} | {kind: 'route'} | {kind: 'held'; resume: () => void}

// A field only borrows the keyboard: Escape gives it back
const isField = (target: EventTarget | null) =>
	target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement

// Writes a file in place, unless it has changed since `revision` — another
// tab, an SMB client or an app got there first (the server answers 412).
// Without a revision it overwrites; as a copy it lands beside the original.
async function saveFile({
	path,
	body,
	revision,
	copy,
}: {
	path: string
	body: Blob
	revision: string | undefined
	copy: boolean
}): Promise<{status: 'saved'; path: string; revision?: string} | {status: 'conflict'} | {status: 'error'}> {
	const response = await fetch(
		`/api/files/upload?path=${encodeURIComponent(path)}&collision=${copy ? 'keep-both' : 'replace'}`,
		{
			method: 'POST',
			body,
			headers: {...dashboardAuthHeaders(), ...(revision ? {'If-Match': revision} : {})},
		},
	)
	if (response.status === 412) return {status: 'conflict'}
	if (!response.ok) return {status: 'error'}
	const {path: savedPath} = (await response.json()) as {path: string}
	// The ETag, quoted as If-Match expects it back
	return {status: 'saved', path: savedPath, revision: response.headers.get('ETag') ?? undefined}
}

// An opened file: the viewer takes the window over Files, with the file's
// tools, saving, and the way out
export function ViewerShell({item, viewer}: {item: FileSystemItem; viewer?: Viewer}) {
	const {t} = useTranslation()
	const reduceMotion = useReducedMotion() ?? false
	const isMobile = useIsMobile()
	const utils = trpcReact.useUtils()
	const {wallpaper} = useWallpaper()
	const setViewerItem = useFilesStore((s) => s.setViewerItem)
	const setSelectedItems = useFilesStore((s) => s.setSelectedItems)
	const setViewerNavigationGuard = useFilesStore((s) => s.setViewerNavigationGuard)
	const downloadUrl = useAuthorizedHttpUrl(`/api/files/download?path=${encodeURIComponent(item.path)}`)

	const contentRef = useRef<HTMLDivElement>(null)
	const [toolsSlot, setToolsSlot] = useState<HTMLElement | null>(null)
	const [backdropSlot, setBackdropSlot] = useState<HTMLElement | null>(null)
	const [detail, setDetail] = useState<string>()
	const [dirty, setDirty] = useState(false)
	const saveHandler = useRef<ViewerSaveHandler | null>(null)
	const escapeHandler = useRef<(() => boolean) | null>(null)
	const [saveState, setSaveState] = useState<SaveState>('idle')
	const saveStateTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
	const savingRef = useRef(false)
	const [interrupted, setInterrupted] = useState<Interrupted | null>(null)
	// Saving on the way out: the prompt steps aside until the save has landed
	const [resolving, setResolving] = useState(false)
	// Saving as a copy, which the viewer carries on with once it has landed
	const [copying, setCopying] = useState(false)
	const [conflict, setConflict] = useState(false)
	// Where the keyboard was in the file, for what floats over it — a prompt, a
	// menu, a field — to hand it back to (Radix would give it to a trigger,
	// which these prompts don't have, or to the menu's button and its tooltip).
	// Never the chrome, and never a field.
	const mainRef = useRef<HTMLElement>(null)
	const lastFocused = useRef<HTMLElement | null>(null)
	// Where it was went with a file before, when the viewer has stepped since: then the file's pages (the one part of
	// the stage a viewer focuses by script), or the viewer itself, rather than nowhere
	const refocus = () => {
		const last = lastFocused.current
		const target = last?.isConnected
			? last
			: (mainRef.current?.querySelector<HTMLElement>('[tabindex="-1"]') ?? contentRef.current)
		target?.focus({preventScroll: true})
	}
	const returnFocus = (event: Event) => {
		event.preventDefault()
		refocus()
	}
	const [closing, setClosing] = useState(false)
	const closingRef = useRef(false)
	// The first file of a session settles in with the chrome; later ones are
	// stepped to, which only fades the stage
	const [openedPath] = useState(item.path)
	const [stepped, setStepped] = useState(false)
	if (!stepped && item.path !== openedPath) setStepped(true)
	// What the file weighs since this viewer last saved it (the listing's item is a snapshot)
	const [savedSize, setSavedSize] = useState<{path: string; size: number}>()

	useEffect(() => () => clearTimeout(saveStateTimer.current), [])
	const flashSaveState = (state: 'saved' | 'error') => {
		setSaveState(state)
		clearTimeout(saveStateTimer.current)
		saveStateTimer.current = setTimeout(() => setSaveState('idle'), state === 'saved' ? 2000 : 3000)
	}

	const close = async () => {
		if (closingRef.current) return
		closingRef.current = true
		setClosing(true)
		await new Promise((resolve) => setTimeout(resolve, reduceMotion ? 0 : LEAVE_MS))
		// Held, when a change came in as it faded: the viewer comes back behind the prompt, for Cancel to return to
		// and Don't Save or Save to close again
		if (!setViewerItem(null)) {
			closingRef.current = false
			setClosing(false)
		}
	}

	// Resolves to whether the file now holds the viewer's version
	const save = async ({copy = false, overwrite = false} = {}) => {
		const handler = saveHandler.current
		if (!handler || savingRef.current) return false
		savingRef.current = true
		setSaveState('saving')
		if (copy) setCopying(true)
		try {
			const body = await handler.serialize()
			const result = await saveFile({
				path: item.path,
				body,
				revision: copy || overwrite ? undefined : handler.revision,
				copy,
			})
			if (result.status === 'conflict') {
				setSaveState('idle')
				setConflict(true)
				return false
			}
			if (result.status === 'error') {
				flashSaveState('error')
				return false
			}
			const directory = item.path.slice(0, item.path.lastIndexOf('/'))
			void utils.files.list.invalidate({path: directory})
			if (copy) {
				// The changes live in the copy now, so that is the file to carry on
				// with; the original is as it was
				const copyItem = {...item, path: result.path, name: result.path.slice(result.path.lastIndexOf('/') + 1)}
				setViewerNavigationGuard(null)
				if (setViewerItem(copyItem, 'open')) setSelectedItems([copyItem])
			} else {
				handler.onSaved(result.revision)
				setSavedSize({path: item.path, size: body.size})
			}
			flashSaveState('saved')
			return true
		} catch {
			flashSaveState('error')
			return false
		} finally {
			savingRef.current = false
			setCopying(false)
		}
	}

	// While a save that leaves the file is on its way (to close, to go elsewhere, or for the copy), the stage takes no
	// typing, pasting or clicks: they would go into the file being left, and be lost with it. Inert drops the keyboard
	// to the page, so it goes back to the file once the stage is live again (a save that failed).
	const sealed = resolving || copying
	const wasSealed = useRef(false)
	useEffect(() => {
		if (wasSealed.current && !sealed && document.activeElement === document.body) refocus()
		wasSealed.current = sealed
	}, [sealed])

	const requestClose = () => {
		if (dirty) setInterrupted({kind: 'close'})
		else void close()
	}

	// Unsaved changes hold every way out of the file: another file or a folder
	// (the store's setViewerItem and leaveViewer), leaving Files and closing the tab
	useEffect(() => {
		if (!dirty) return
		setViewerNavigationGuard((resume) => setInterrupted({kind: 'held', resume}))
		const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
		window.addEventListener('beforeunload', onBeforeUnload)
		return () => {
			setViewerNavigationGuard(null)
			window.removeEventListener('beforeunload', onBeforeUnload)
		}
	}, [dirty, setViewerNavigationGuard])
	// Read from the store as the route changes: an answered prompt has just let go
	const blocker = useBlocker(
		({currentLocation, nextLocation}) =>
			!!useFilesStore.getState().viewerNavigationGuard && currentLocation.pathname !== nextLocation.pathname,
	)
	const prompt: Interrupted | null = resolving
		? null
		: (interrupted ?? (blocker.state === 'blocked' ? {kind: 'route'} : null))

	const resume = (action: Interrupted) => {
		setInterrupted(null)
		// Nothing on the way out is held again
		setViewerNavigationGuard(null)
		if (action.kind === 'close') void close()
		else if (action.kind === 'route') blocker.proceed?.()
		else action.resume()
	}
	const dismissPrompt = () => {
		setInterrupted(null)
		if (blocker.state === 'blocked') blocker.reset()
	}
	const saveAndResume = async (action: Interrupted) => {
		setResolving(true)
		setInterrupted(null)
		const saved = await save()
		setResolving(false)
		if (saved) resume(action)
		else if (blocker.state === 'blocked') blocker.reset()
	}

	useViewerKeys(contentRef, {
		onSave: () => {
			if (dirty) void save()
		},
		ownsArrows: viewer?.ownsArrows,
	})

	const subtitle = [
		fileTypeLabel(item, t),
		detail,
		savedSize?.path === item.path
			? formatFilesystemSize(savedSize.size)
			: item.size != null && item.type !== 'directory'
				? formatFilesystemSize(item.size)
				: undefined,
	]
		.filter(Boolean)
		.join(' · ')
	const chrome = (edge: 'top' | 'bottom') => (closing ? chromeLeave : cn(chromeEnter[edge], CHROME_DELAY))
	const showSave = dirty || saveState !== 'idle'

	const actions = (
		<div className={cn('flex shrink-0 items-center gap-1', isMobile && 'justify-center')}>
			{/* The viewer's own tools (see ViewerTools) */}
			<div ref={setToolsSlot} className='contents' />
			{downloadUrl ? (
				<a
					href={downloadUrl}
					download={item.name}
					aria-label={t('files-viewer.download')}
					className={lightboxButtonClass}
				>
					<Download className='size-5' />
				</a>
			) : (
				<LightboxButton icon={Download} label={t('files-viewer.download')} disabled />
			)}
		</div>
	)

	return (
		<ImmersiveDialog open onOpenChange={(open) => !open && requestClose()}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className='fixed inset-0 z-50' />
				<DialogPrimitive.Content
					ref={contentRef}
					tabIndex={-1}
					// Focus moves into the viewer, not onto its first button: no ring
					// on open, while the listing beneath stops hearing keys
					onOpenAutoFocus={(event) => {
						event.preventDefault()
						contentRef.current?.focus()
					}}
					// The stage's, not the chrome's or a prompt's (portalled out of it)
					onFocus={(event) => {
						if (mainRef.current?.contains(event.target) && !isField(event.target)) lastFocused.current = event.target
					}}
					// A press on the chrome (the viewer's tools, Save, Download, Close)
					// leaves the keyboard in the file, as Safari does: the document
					// keeps its caret and its scrolling keys
					onMouseDown={(event) => {
						const target = event.target as Element
						const chrome = contentRef.current?.contains(target) && !mainRef.current?.contains(target)
						if (chrome && target.closest('button, a')) keepFocus(event)
					}}
					// Escape unwinds the viewer's own state first (a search, a tool)
					onEscapeKeyDown={(event) => {
						event.preventDefault()
						if (escapeHandler.current?.()) return
						// Then a text field gives the keyboard back to the file (a page
						// number half typed, a form's field), and only after that does
						// the viewer close
						const field = document.activeElement
						if (!isField(field)) return requestClose()
						field.blur()
						refocus()
					}}
					// The viewer fills the window: the only things outside it are
					// floating islands and toasts, and pressing those isn't leaving
					onPointerDownOutside={(event) => event.preventDefault()}
					onInteractOutside={(event) => event.preventDefault()}
					className='fixed inset-0 z-50 flex h-dvh w-screen flex-col outline-hidden'
				>
					<DialogPrimitive.Title className='sr-only'>{item.name}</DialogPrimitive.Title>
					<DialogPrimitive.Description className='sr-only'>{subtitle}</DialogPrimitive.Description>

					{/* Backdrop: the wallpaper, turned and blurred into a deep wash,
					    with room above it for a viewer's own (see ViewerBackdrop) */}
					<div
						className={cn(
							'pointer-events-none absolute inset-0 overflow-clip bg-neutral-950',
							closing ? backdropLeave : backdropEnter,
						)}
					>
						{wallpaper.url && (
							<picture className='contrast-more:hidden'>
								<WallpaperAvifSource wallpaper={wallpaper} tier='thumbnails' />
								<img
									src={wallpaper.url}
									alt=''
									aria-hidden='true'
									className='absolute inset-0 size-full scale-125 rotate-180 object-cover blur-[64px] brightness-[0.55] saturate-[1.2]'
								/>
							</picture>
						)}
						<div ref={setBackdropSlot} className='contents' />
						<div className='absolute inset-0 bg-black/20' />
					</div>

					<ViewerShellContext
						value={{toolsSlot, backdropSlot, setDetail, setSize, setDirty, saveHandler, escapeHandler, returnFocus}}
					>
						<header className='relative flex items-center justify-between gap-4 px-4 pt-4 md:px-6 md:pt-5'>
							<div className={cn('min-w-0', chrome('top'))}>
								<p className='flex min-h-[1lh] items-center gap-2 text-15 font-semibold -tracking-2 text-white/95'>
									<span className='min-w-0 truncate'>{item.name}</span>
									{dirty && (
										<span
											role='img'
											aria-label={t('files-viewer.unsaved-changes')}
											className='size-1.5 shrink-0 rounded-full bg-amber-400 motion-safe:animate-in motion-safe:zoom-in'
										/>
									)}
								</p>
								<p className='min-h-[1lh] truncate text-12 text-white/50'>{subtitle}</p>
							</div>
							<div className={cn('flex shrink-0 items-center gap-1', chrome('top'))}>
								{showSave && <SaveButton state={saveState} onSave={() => void save()} />}
								{!isMobile && actions}
								<LightboxButton icon={X} label={t('close')} onClick={requestClose} />
							</div>
						</header>

						<main ref={mainRef} inert={sealed} className='relative mt-3 flex min-h-0 flex-1 flex-col'>
							<div
								key={item.path}
								className={cn('flex min-h-0 flex-1 flex-col', closing ? stageLeave : stepped ? stageStep : stageEnter)}
							>
								<ErrorBoundary
									fallbackRender={() => (
										<StageMessage
											item={item}
											title={t('files-viewer.error-title')}
											detail={t('files-viewer.error-detail')}
										>
											<StageDownload item={item} />
										</StageMessage>
									)}
								>
									<Suspense fallback={<StageLoading item={item} />}>
										{viewer ? (
											<viewer.Component item={item} mode='open' />
										) : (
											// Opening something Files has no viewer for offers the download
											<StageMessage
												item={item}
												title={t('files-viewer.unsupported-title')}
												detail={t('files-viewer.unsupported-detail')}
											>
												<StageDownload item={item} />
											</StageMessage>
										)}
									</Suspense>
								</ErrorBoundary>
							</div>
						</main>

						{/* Phones: the actions are a toolbar beneath the file (placed, as the header is, so it
						    paints over the backdrop that comes before it) */}
						{isMobile ? (
							<div className={cn('relative flex justify-center px-4 pt-3 pb-4', chrome('bottom'))}>{actions}</div>
						) : (
							!viewer?.bleeds && <div className='h-5' />
						)}
					</ViewerShellContext>

					<AlertDialog open={!!prompt} onOpenChange={(open) => !open && dismissPrompt()}>
						<AlertDialogContent onCloseAutoFocus={returnFocus}>
							<AlertDialogHeader>
								<AlertDialogTitle>{t('files-viewer.unsaved-title', {name: item.name})}</AlertDialogTitle>
								<AlertDialogDescription>{t('files-viewer.unsaved-description')}</AlertDialogDescription>
							</AlertDialogHeader>
							{/* As on macOS, Don't Save leads, then Cancel, and Save sits on the trailing edge.
							    Stacked on a phone: Save, Don't Save, Cancel. */}
							<AlertDialogFooter>
								<AlertDialogAction onClick={() => prompt && void saveAndResume(prompt)}>
									{t('files-viewer.save')}
								</AlertDialogAction>
								<AlertDialogAction variant='default' className='md:order-last' onClick={() => prompt && resume(prompt)}>
									{t('files-viewer.dont-save')}
								</AlertDialogAction>
								<AlertDialogAction variant='default' onClick={dismissPrompt}>
									{t('cancel')}
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>

					<AlertDialog open={conflict} onOpenChange={setConflict}>
						<AlertDialogContent onCloseAutoFocus={returnFocus}>
							<AlertDialogHeader>
								<AlertDialogTitle>{t('files-viewer.conflict-title', {name: item.name})}</AlertDialogTitle>
								<AlertDialogDescription>{t('files-viewer.conflict-description')}</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogAction
									onClick={() => {
										setConflict(false)
										void save({copy: true})
									}}
								>
									{t('files-viewer.save-copy')}
								</AlertDialogAction>
								{/* The other way out sits at the leading edge, as Don't Save does above */}
								<AlertDialogAction
									variant='default'
									className='md:order-last'
									onClick={() => {
										setConflict(false)
										void save({overwrite: true})
									}}
								>
									{t('files-viewer.replace')}
								</AlertDialogAction>
								<AlertDialogAction variant='default' onClick={() => setConflict(false)}>
									{t('cancel')}
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</ImmersiveDialog>
	)
}

// Appears with the first unsaved change, and stays a moment to say how a save
// went, to assistive technology too: a save made with ⌘S shows nothing else
function SaveButton({state, onSave}: {state: SaveState; onSave: () => void}) {
	const {t} = useTranslation()
	const label =
		state === 'saving'
			? t('files-viewer.saving')
			: state === 'saved'
				? t('files-viewer.saved')
				: state === 'error'
					? t('files-viewer.save-failed')
					: t('files-viewer.save')
	return (
		<>
			<button
				type='button'
				onClick={onSave}
				disabled={state === 'saving' || state === 'saved'}
				className={cn(
					toolHeightClass,
					'umbrel-button mr-1 inline-flex items-center gap-2 rounded-full px-5 text-13 font-semibold -tracking-2 text-white transition-[background-color,transform] duration-200 active:scale-95 motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:fade-in',
					state === 'idle' || state === 'saving'
						? 'bg-brand shadow-button-highlight-hpx hover:bg-brand-lighter'
						: state === 'saved'
							? 'settings-edge-material bg-white/6'
							: 'bg-red-500/80',
				)}
			>
				{state === 'saving' && <TbLoader className='size-4 animate-spin' />}
				{state === 'saved' && <Check className='size-4' />}
				{label}
			</button>
			<span role='status' className='sr-only'>
				{state === 'saved' || state === 'error' ? label : ''}
			</span>
		</>
	)
}
