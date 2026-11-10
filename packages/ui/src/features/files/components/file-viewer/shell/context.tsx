import {createContext, useContext, useEffect, useLayoutEffect, useRef, type ReactNode} from 'react'
import {createPortal} from 'react-dom'

import type {Viewer} from '@/features/files/components/file-viewer/viewers'
import type {ViewerStep} from '@/features/files/store/slices/file-viewer-slice'
import type {FileSystemItem} from '@/features/files/types'

// What a viewer saves: the bytes, and the revision they were edited from — the
// server refuses the save if the file has changed since (see saveFile)
export type ViewerSaveHandler = {
	revision: string | undefined
	serialize: () => Promise<Blob>
	// The file now holds what was serialized: the viewer's new baseline
	onSaved: (revision: string | undefined) => void
}

// A picture's or a film's own size, in pixels
export type ViewerSize = {width: number; height: number}

// A file a viewer shows on the stage in the viewer's place (an archive's
// entry): the shell titles the stage with it, Download calls `download`, the
// arrows `step` through its neighbours, and the back button (named for `from`)
// and Escape return to the viewer with `back`
export type ViewerShown = {
	item: FileSystemItem
	// What draws it, when anything can
	viewer: Viewer | undefined
	// Undefined while it can't be downloaded yet
	download: (() => void) | undefined
	from: string
	back: () => void
	step: (direction: ViewerStep) => void
}

type ViewerShellContextValue = {
	toolsSlot: HTMLElement | null
	backdropSlot: HTMLElement | null
	setDetail: (detail: string | undefined) => void
	setSize: (size: ViewerSize) => void
	setDirty: (dirty: boolean) => void
	saveHandler: {current: ViewerSaveHandler | null}
	escapeHandler: {current: (() => boolean) | null}
	returnFocus: (event: Event) => void
	setShown: (shown: ViewerShown | undefined) => void
}

export const ViewerShellContext = createContext<ViewerShellContextValue | null>(null)

function useViewerShell() {
	const shell = useContext(ViewerShellContext)
	if (!shell) throw new Error('Viewers render inside the ViewerShell or a QuickLook')
	return shell
}

// A viewer's own controls, placed in the shell's toolbar. A quick look has no
// toolbar, so they aren't shown there.
export function ViewerTools({children}: {children: ReactNode}) {
	const {toolsSlot} = useViewerShell()
	return toolsSlot ? createPortal(children, toolsSlot) : null
}

// A viewer's own backdrop, laid over the shell's (a picture, blown up). A
// quick look has no backdrop of its own to lay it over.
export function ViewerBackdrop({children}: {children: ReactNode}) {
	const {backdropSlot} = useViewerShell()
	return backdropSlot ? createPortal(children, backdropSlot) : null
}

// What the viewer knows about the file beyond its type and size, for the
// title's second line — "12 pages", "3 sheets"
export function useViewerDetail(detail: string | undefined) {
	const {setDetail} = useViewerShell()
	useEffect(() => {
		setDetail(detail)
		return () => setDetail(undefined)
	}, [detail, setDetail])
}

// The size of what the viewer shows, when it has one of its own (a picture, a
// film), for a quick look to take its shape. It isn't taken back as the viewer
// goes: stepping from one picture to the next goes from shape to shape.
export function useViewerSize(size: ViewerSize | undefined) {
	const {setSize} = useViewerShell()
	const width = size?.width
	const height = size?.height
	useEffect(() => {
		if (width && height) setSize({width, height})
	}, [width, height, setSize])
}

// Makes the file savable from the shell: Save in the toolbar, ⌘S, and the
// unsaved-changes and conflict prompts. Pass null while there is nothing a
// save could write (still loading, read-only).
export function useViewerSave(handler: ViewerSaveHandler | null, dirty: boolean) {
	const {saveHandler, setDirty} = useViewerShell()
	// The handler closes over the viewer's latest state; the shell only ever
	// calls it from an event, after this has run. Layout effects both ways: a
	// stepped-away viewer's cleanup must run before the next one registers.
	useLayoutEffect(() => {
		saveHandler.current = handler
	})
	useLayoutEffect(() => () => void (saveHandler.current = null), [saveHandler])
	const savable = handler !== null
	useEffect(() => {
		setDirty(dirty && savable)
	}, [dirty, savable, setDirty])
	useEffect(() => () => setDirty(false), [setDirty])
}

// Hands the keyboard back to where it was in the file, for a menu floating
// over it to call as it closes (as its onCloseAutoFocus)
export function useReturnFocus() {
	return useViewerShell().returnFocus
}

// Lets the viewer unwind its own state (a search, a tool) on Escape before
// the shell closes. The handler answers whether it used the key.
export function useViewerEscape(handler: () => boolean) {
	const {escapeHandler} = useViewerShell()
	useLayoutEffect(() => {
		escapeHandler.current = handler
	})
	useLayoutEffect(() => () => void (escapeHandler.current = null), [escapeHandler])
}

// Has the stage show another file in the viewer's place (see ViewerShown),
// until the caller goes. A quick look has no chrome for it: just the stage.
export function useViewerShown(shown: ViewerShown) {
	const {setShown} = useViewerShell()
	// What the shell calls closes over the viewer's latest state: it calls it
	// only from an event, after this has run, and renders again only for
	// another file, or one that can now be downloaded
	const latest = useRef(shown)
	useLayoutEffect(() => {
		latest.current = shown
	})
	const {item, viewer, from} = shown
	const downloadable = shown.download !== undefined
	useLayoutEffect(() => {
		setShown({
			item,
			viewer,
			download: downloadable ? () => latest.current.download?.() : undefined,
			from,
			back: () => latest.current.back(),
			step: (direction) => latest.current.step(direction),
		})
	}, [item, viewer, downloadable, from, setShown])
	useLayoutEffect(() => () => setShown(undefined), [setShown])
}
