import {useEffect, useRef} from 'react'

import {useFilesStore} from '@/features/files/store/use-files-store'

interface ViewerWrapperProps {
	children: React.ReactNode
	dontCloseOnSpacebar?: boolean // used for video viewer, spacebar is used to play/pause
	dontCloseOnEscape?: boolean // used for text editor, escape handled by editor
	dontCloseOnClickOutside?: boolean // used for text editor, click-outside disabled during editing
	className?: string // additional classes on the overlay container
}

export const ViewerWrapper: React.FC<ViewerWrapperProps> = ({
	children,
	dontCloseOnSpacebar,
	dontCloseOnEscape,
	dontCloseOnClickOutside,
	className,
}) => {
	const setViewerItem = useFilesStore((s) => s.setViewerItem)

	const wrapperRef = useRef<HTMLDivElement>(null)

	const handleClose = () => {
		setViewerItem(null)
	}

	// Handle click outside and escape key
	useEffect(() => {
		// TODO: ignore clicks inside floatingislands
		const handleClickOutside = (e: MouseEvent) => {
			if (dontCloseOnClickOutside) return

			const isClickInViewer = wrapperRef.current?.contains(e.target as Node)

			if (!isClickInViewer) {
				handleClose()
			}
		}

		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && !dontCloseOnEscape) {
				e.preventDefault()
				handleClose()
			}
			if (e.key === ' ' && !dontCloseOnSpacebar) {
				e.preventDefault()
				handleClose()
			}
		}

		document.addEventListener('mousedown', handleClickOutside)
		window.addEventListener('keydown', handleEscape)

		return () => {
			document.removeEventListener('mousedown', handleClickOutside)
			window.removeEventListener('keydown', handleEscape)
		}
	}, [dontCloseOnClickOutside, dontCloseOnEscape, dontCloseOnSpacebar])

	return (
		<div
			className={`absolute top-0 left-1/2 z-10 flex h-full w-full -translate-x-1/2 items-center justify-center bg-black/80 ${className ?? ''}`}
		>
			<div ref={wrapperRef} className='p-2 md:px-10'>
				{children}
			</div>
		</div>
	)
}
