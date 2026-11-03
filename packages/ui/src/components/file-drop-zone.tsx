import React, {CSSProperties, type ReactNode} from 'react'
import {useDropzone} from 'react-dropzone'

import {cn} from '@/lib/utils'

interface FileDropZoneProps {
	onDrop: (files: File[]) => void
	// What the overlay says while files hover
	label: string
	disabled?: boolean
	// For a pane that paints outside this wrapper's box (negative margins), so
	// the veil can follow it
	overlayClassName?: string
	children: ReactNode
}

// The file-drop veil Files and Photos share: wraps a pane and, while files
// from the desktop hover over it, dims it under a ripple and an invitation
// to drop. Each feature brings its own onDrop and copy — and its own
// filtering, so unwanted files can be explained rather than silently ignored.
export function FileDropZone({onDrop, label, disabled, overlayClassName, children}: FileDropZoneProps) {
	const {getRootProps, getInputProps, isDragActive} = useDropzone({
		onDrop,
		noClick: true,
		noKeyboard: true,
		disabled,
	})

	return (
		<div {...getRootProps()} className='relative h-full'>
			<input {...getInputProps()} />
			{children}
			{isDragActive && <DropOverlay label={label} className={overlayClassName} />}
		</div>
	)
}

const DropOverlay = ({label, className}: {label: string; className?: string}) => (
	<div
		className={cn(
			'absolute inset-0 z-50 flex flex-col items-center justify-center overflow-hidden rounded-12 border-2 border-[hsl(var(--color-brand))]/30 bg-black/50',
			className,
		)}
	>
		<span className='z-10 text-center text-5xl font-medium tracking-tighter whitespace-pre-wrap text-white'>
			{label}
		</span>
		<Ripple />
	</div>
)

interface RippleProps {
	mainCircleSize?: number
	mainCircleOpacity?: number
	numCircles?: number
	className?: string
}

const Ripple = React.memo(function Ripple({
	mainCircleSize = 210,
	mainCircleOpacity = 0.24,
	numCircles = 8,
	className,
}: RippleProps) {
	return (
		<div
			className={cn(
				'pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,white,transparent)]',
				className,
			)}
		>
			{Array.from({length: numCircles}, (_, i) => {
				const size = mainCircleSize + i * 70
				const opacity = mainCircleOpacity - i * 0.03
				const animationDelay = `${i * 0.06}s`
				const borderStyle = i === numCircles - 1 ? 'dashed' : 'solid'

				return (
					<div
						key={i}
						// White edges over a brand fill, faded by the ring's own opacity
						className='absolute animate-files-drop-zone-ripple rounded-full border border-white bg-brand/25 shadow-xl'
						style={
							{
								width: `${size}px`,
								height: `${size}px`,
								opacity,
								animationDelay,
								borderStyle,
								borderWidth: '1px',
								top: '50%',
								left: '50%',
								transform: 'translate(-50%, -50%) scale(1)',
							} as CSSProperties
						}
					/>
				)
			})}
		</div>
	)
})
