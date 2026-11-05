import {useEffect, type RefObject} from 'react'

import {isTyping} from '@/features/files/components/file-viewer/shell/keys'
import {ARROW_STEPS} from '@/features/files/store/slices/file-viewer-slice'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {isBeneathModal} from '@/utils/is-beneath-modal'

// The keys of a viewer over Files, heard wherever the keyboard is on the page
// (but not in a prompt open over the viewer): ⌘S saves, and never saves the
// page; ←/→ (↑/↓ a row of the icon grid) step through the folder, unless the
// file keeps them for itself; and Space is the viewer's, when it takes it.
export function useViewerKeys(
	viewerRef: RefObject<HTMLElement | null>,
	{onSave, onSpace, ownsArrows = false}: {onSave?: () => void; onSpace?: () => void; ownsArrows?: boolean},
) {
	const stepper = useFilesStore((s) => s.viewerStepper)
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (isBeneathModal(viewerRef.current, event)) return
			const mod = event.metaKey || event.ctrlKey
			if (mod && event.key.toLowerCase() === 's') {
				event.preventDefault()
				onSave?.()
				return
			}
			if (mod || event.altKey || isTyping(event.target)) return
			if (event.key === ' ' && onSpace) {
				event.preventDefault()
				onSpace()
				return
			}
			const step = ARROW_STEPS[event.key]
			if (step && !ownsArrows) {
				event.preventDefault()
				stepper?.step(step)
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	})
}
