import {useEffect, useRef} from 'react'

import {useFilesStore} from '@/features/files/store/use-files-store'

interface ViewerWrapperProps {
	children: React.ReactNode
	dontCloseOnSpacebar?: boolean // used for video viewer, spacebar is used to play/pause
}

export const ViewerWrapper: React.FC<ViewerWrapperProps> = ({children, dontCloseOnSpacebar}) => {
	const setViewerItem = useFilesStore((s) => s.setViewerItem)

	const wrapperRef = useRef<HTMLDivElement>(null)

	const handleClose = () => {
		setViewerItem(null)
	}

	// Handle click outside and escape key
	useEffect(() => {
		// TODO: ignore clicks inside floatingislands
		const handleClickOutside = (e: MouseEvent) => {
			const isClickInViewer = wrapperRef.current?.contains(e.target as Node)

			if (!isClickInViewer) {
				handleClose()
			}
		}

		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === 'Escape' || (e.key === ' ' && !dontCloseOnSpacebar)) {
				handleClose()
			}
		}

		document.addEventListener('mousedown', handleClickOutside)
		window.addEventListener('keydown', handleEscape)

		return () => {
			document.removeEventListener('mousedown', handleClickOutside)
			window.removeEventListener('keydown', handleEscape)
		}
	}, [])

	return (
		<div className='absolute left-1/2 top-0 z-10 flex h-full w-full -translate-x-1/2 items-center justify-center bg-black/80'>
			<div ref={wrapperRef} className='p-2 md:px-10'>
				{children}
			</div>
		</div>
	)
}
