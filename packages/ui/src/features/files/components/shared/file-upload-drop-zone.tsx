import React, {CSSProperties} from 'react'
import {useDropzone} from 'react-dropzone'

import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useGlobalFiles} from '@/providers/global-files'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

interface FileUploadDropZoneProps {
	children: React.ReactNode
}

export function FileUploadDropZone({children}: FileUploadDropZoneProps) {
	const {startUpload} = useGlobalFiles()
	const {currentPath} = useNavigate()

	const onDrop = (acceptedFiles: File[]) => {
		startUpload(acceptedFiles, currentPath)
	}

	const {getRootProps, getInputProps, isDragActive} = useDropzone({
		onDrop,
		noClick: true,
		noKeyboard: true,
	})

	return (
		<div {...getRootProps()} className='relative h-full'>
			<input {...getInputProps()} />
			{children}
			{isDragActive && <DropOverlay />}
		</div>
	)
}

const DropOverlay = () => {
	return (
		<div className='absolute inset-0 flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-12 border-2 border-[hsl(var(--color-brand))]/30 bg-black/50'>
			<span className='z-10 whitespace-pre-wrap text-center text-5xl font-medium tracking-tighter text-white'>
				{t('files-action.drop-to-upload')}
			</span>
			<Ripple />
		</div>
	)
}

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
				const borderOpacity = 5 + i * 5

				return (
					<div
						key={i}
						className={`absolute animate-files-drop-zone-ripple rounded-full border bg-brand/25 shadow-xl [--i:${i}]`}
						style={
							{
								width: `${size}px`,
								height: `${size}px`,
								opacity,
								animationDelay,
								borderStyle,
								borderWidth: '1px',
								borderColor: `hsl(var(--brand), ${borderOpacity / 100})`,
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
