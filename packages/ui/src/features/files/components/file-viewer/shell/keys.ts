import type {ViewerProps} from '@/features/files/components/file-viewer/viewers'

// Whether a key goes to something being typed in, which keeps the keys a viewer would otherwise take for itself
export const isTyping = (target: EventTarget | null) =>
	target instanceof HTMLInputElement ||
	target instanceof HTMLTextAreaElement ||
	target instanceof HTMLSelectElement ||
	(target instanceof HTMLElement && target.isContentEditable)

// ⌘F finds, and ⌘+ ⌘− ⌘0 zoom a viewer's own pages rather than the window. True when the key was one of them, now done.
export function pageShortcut(
	event: KeyboardEvent,
	on: {find: () => void; zoom: (direction: 1 | -1) => void; actualSize: () => void},
) {
	if (!(event.metaKey || event.ctrlKey) || event.altKey) return false
	const key = event.key.toLowerCase()
	const action =
		key === 'f'
			? on.find
			: key === '=' || key === '+'
				? () => on.zoom(1)
				: key === '-' || key === '_'
					? () => on.zoom(-1)
					: key === '0'
						? on.actualSize
						: undefined
	if (!action) return false
	event.preventDefault()
	action()
	return true
}

// Which way ← or → turns the page of an opened file when the pages have the keyboard: -1, 1, or 0 for any other key
export function pageTurn(event: KeyboardEvent, pages: HTMLElement, mode: ViewerProps['mode']) {
	if (mode !== 'open' || event.target !== pages || event.altKey || event.shiftKey || event.metaKey || event.ctrlKey)
		return 0
	return event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
}
