import {createElement, lazy, useState, type ComponentType} from 'react'

import {AudioViewer} from '@/features/files/components/file-viewer/audio-viewer'
import type {ActiveViewerMode} from '@/features/files/store/slices/file-viewer-slice'
import type {FileSystemItem} from '@/features/files/types'

export type ViewerProps = {item: FileSystemItem; mode: ActiveViewerMode}

export type Viewer = {
	Component: ComponentType<ViewerProps>
	// Fetches the viewer's code ahead of its first use
	preload: () => Promise<unknown>
	// Opened rather than quick-looked, the viewer keeps ←/→ for itself
	// (seeking, pages, cells, slides), so the arrows of another opened file
	// step past it rather than into it
	ownsArrows?: boolean
	// Hands the file to a floating island instead of opening over Files
	island?: boolean
	// Opened, its pages scroll on to the window's bottom edge rather than
	// stopping short of it
	bleeds?: boolean
}

function defineViewer(
	load: () => Promise<{default: ComponentType<ViewerProps>}>,
	options: Pick<Viewer, 'ownsArrows' | 'bleeds'> = {},
): Viewer {
	// Code that has already arrived renders straight away: React.lazy would
	// still suspend once, and hold its fallback on screen for a beat
	let loaded: ComponentType<ViewerProps> | undefined
	const preload = () => load().then((module) => (loaded = module.default))
	const Lazy = lazy(() => preload().then((Component) => ({default: Component})))
	function Component(props: ViewerProps) {
		// Settled once per mount, so a chunk landing mid-life never swaps the
		// component (and its state) out from under the viewer
		const [Implementation] = useState(() => loaded ?? Lazy)
		return createElement(Implementation, props)
	}
	return {Component, preload, ...options}
}

// The one place an engine is chosen for each family of formats: swapping one
// means changing its line here or the folder it points at, nothing else
export const viewers = {
	image: defineViewer(() => import('@/features/files/components/file-viewer/image-viewer')),
	video: defineViewer(() => import('@/features/files/components/file-viewer/video-viewer'), {ownsArrows: true}),
	audio: {Component: AudioViewer, preload: () => Promise.resolve(), island: true},
	text: defineViewer(() => import('@/features/files/components/file-viewer/text-viewer')),
	pdf: defineViewer(() => import('@/features/files/components/file-viewer/pdf-viewer'), {
		ownsArrows: true,
		bleeds: true,
	}),
	sheet: defineViewer(() => import('@/features/files/components/file-viewer/sheet-viewer'), {ownsArrows: true}),
	document: defineViewer(() => import('@/features/files/components/file-viewer/document-viewer'), {
		ownsArrows: true,
		bleeds: true,
	}),
	slides: defineViewer(() => import('@/features/files/components/file-viewer/slides-viewer'), {ownsArrows: true}),
	iwork: defineViewer(() => import('@/features/files/components/file-viewer/iwork-viewer')),
	archive: defineViewer(() => import('@/features/files/components/file-viewer/archive-viewer'), {ownsArrows: true}),
} satisfies Record<string, Viewer>
