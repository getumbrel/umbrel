import {useLayoutEffect, useRef, type ReactNode} from 'react'

import {formatItemName, splitFileName} from '@/features/files/utils/format-filesystem-name'
import {cn} from '@/lib/utils'

interface TruncatedFilenameProps {
	filename: string
	className?: string
	view?: 'list' | 'icons'
	// Icons view only: an inline element that follows the name, wrapping with it
	suffix?: ReactNode
	// Icons view only: shorter names leave room for a suffix within the clamp
	maxLength?: number
}

export function TruncatedFilename({
	filename,
	className,
	view = 'list',
	suffix,
	maxLength = 30,
}: TruncatedFilenameProps) {
	// In icons view, we know the parent's height/width, so we don't need to use dynamic truncation
	if (view === 'icons') {
		return <IconsViewFilename filename={filename} className={className} suffix={suffix} maxLength={maxLength} />
	}

	// Keep last 16 characters always visible in suffix
	const SUFFIX_LENGTH = 16

	// Split the same number of characters whether or not there is a file extension
	const {name: fileName, extension} = splitFileName(filename)
	const nameSuffixLength = extension ? Math.max(0, SUFFIX_LENGTH - extension.length) : SUFFIX_LENGTH
	const prefixText = fileName.slice(0, fileName.length - nameSuffixLength)
	const suffixText = fileName.slice(fileName.length - nameSuffixLength) + (extension || '')

	// Using whitespace-pre instead of whitespace-nowrap to preserve spaces at span boundaries.
	// With nowrap, a space at the start/end of a flex item is stripped (CSS treats it as
	// collapsible leading/trailing whitespace). Pre preserves it while still preventing wrapping.
	return (
		<span className={cn('flex', className)} title={filename}>
			<span className='min-w-0 overflow-hidden text-ellipsis whitespace-pre'>{prefixText}</span>
			<span className='flex-shrink-0 whitespace-pre'>{suffixText}</span>
		</span>
	)
}

function IconsViewFilename({
	filename,
	className,
	suffix,
	maxLength,
}: {
	filename: string
	className?: string
	suffix?: ReactNode
	maxLength: number
}) {
	const ref = useRef<HTMLSpanElement>(null)
	const name = formatItemName({name: filename, maxLength})
	const hasSuffix = Boolean(suffix)

	// Names wrap between words. One that would run past the line clamp that way
	// packs its lines instead, so its end and extension stay in view
	useLayoutEffect(() => {
		const element = ref.current
		if (!element) return
		const fit = () => {
			element.style.wordBreak = ''
			if (element.scrollHeight > element.clientHeight) element.style.wordBreak = 'break-all'
		}
		fit()
		// A webfont that lands later reflows the name without resizing it
		if (document.fonts?.status === 'loading') void document.fonts.ready.then(fit)
		// Tiles are narrower below lg
		const observer = new ResizeObserver(fit)
		observer.observe(element)
		return () => observer.disconnect()
	}, [name, hasSuffix])

	return (
		<span ref={ref} className={cn('block w-full text-center', className)} title={filename}>
			{name}
			{suffix && <> {suffix}</>}
		</span>
	)
}
