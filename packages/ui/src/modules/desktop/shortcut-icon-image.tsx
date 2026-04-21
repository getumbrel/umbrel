import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'

import {cn} from '@/lib/utils'

import {sampleEdgeColor} from './sample-edge-color'

// Module-level cache: icon URL → edge-color result. Same image always produces
// the same result, so we sample once and reuse across all consumers (desktop,
// popover preview, Cmd+K).
const edgeColorCache = new Map<string, {bgColor: string; padded: boolean}>()

// Resolve a stored shortcut icon path to a full URL
export function resolveShortcutIcon(shortcut: {url: string; icon?: string}): string {
	if (!shortcut.icon) return ''
	if (shortcut.icon.startsWith('umbrel:')) {
		const {protocol, hostname} = window.location
		const rest = shortcut.icon.slice('umbrel:'.length)
		return `${protocol}//${hostname}:${rest}`
	}
	return shortcut.icon
}

// Shared icon renderer for shortcuts. Handles CORS edge-color sampling (with
// caching), padding detection, and letter fallback. Used by the desktop grid,
// the shortcut popover preview, and the Cmd+K search palette.
//
// The component fills its parent — size and border-radius are controlled via
// className on the parent container.
export function ShortcutIconImage({
	src,
	title,
	className,
}: {
	// Resolved full icon URL, or empty string for letter fallback
	src: string
	// Shortcut title — first character used for letter fallback
	title: string
	// Extra classes on the outer container
	className?: string
	//
}) {
	const cached = edgeColorCache.get(src)
	const [bgColor, setBgColor] = useState<string | undefined>(cached?.bgColor)
	const [padded, setPadded] = useState(cached?.padded ?? false)
	const [ready, setReady] = useState(!!cached)
	const [imgLoaded, setImgLoaded] = useState(false)
	const [imgError, setImgError] = useState(false)

	const corsImgRef = useRef<HTMLImageElement>(null)
	const visibleImgRef = useRef<HTMLImageElement>(null)

	// Reset state when src changes
	useEffect(() => {
		const c = edgeColorCache.get(src)
		if (c) {
			setBgColor(c.bgColor)
			setPadded(c.padded)
			setReady(true)
		} else {
			setBgColor(undefined)
			setPadded(false)
			setReady(false)
		}
		setImgLoaded(false)
		setImgError(false)
	}, [src])

	const handleCorsResult = useCallback(
		(img: HTMLImageElement) => {
			const result = img.naturalWidth > 0 ? sampleEdgeColor(img) : {bgColor: 'black', padded: true}
			edgeColorCache.set(src, result)
			setBgColor(result.bgColor)
			setPadded(result.padded)
			setReady(true)
		},
		[src],
	)

	// Catch browser-cached images that don't fire onLoad after remount
	useLayoutEffect(() => {
		if (!ready && corsImgRef.current?.complete) {
			handleCorsResult(corsImgRef.current)
		}
		if (!imgLoaded && visibleImgRef.current?.complete && visibleImgRef.current.naturalWidth > 0) {
			setImgLoaded(true)
		}
	})

	const showIcon = src && !imgError

	return (
		<div
			className={cn('[container-type:inline-size] overflow-hidden', className)}
			style={{backgroundColor: bgColor ?? (!showIcon ? 'black' : undefined)}}
		>
			{showIcon ? (
				<>
					{/* Hidden CORS img for canvas edge-color sampling (skipped on cache hit) */}
					{!ready && (
						<img
							ref={corsImgRef}
							src={`${src}${src.includes('?') ? '&' : '?'}_cors=1`}
							crossOrigin='anonymous'
							className='hidden'
							onLoad={(e) => handleCorsResult(e.currentTarget)}
							onError={() => {
								edgeColorCache.set(src, {bgColor: 'black', padded: true})
								setBgColor('black')
								setPadded(true)
								setReady(true)
							}}
							alt=''
						/>
					)}
					<div
						className={cn(
							'h-full w-full transition-opacity duration-500',
							ready && imgLoaded ? 'opacity-100' : 'opacity-0',
							padded && 'p-[18%]',
						)}
					>
						<img
							ref={visibleImgRef}
							src={src}
							alt={title}
							onError={() => setImgError(true)}
							onLoad={(e) => {
								setImgLoaded(true)
								if (e.currentTarget.naturalWidth < 64 || e.currentTarget.naturalHeight < 64) {
									setPadded(true)
								}
							}}
							className={cn('h-full w-full', padded && 'rounded-[20%]')}
							draggable={false}
						/>
					</div>
				</>
			) : (
				<div className='flex h-full w-full items-center justify-center text-[40cqw] font-bold text-white/60'>
					{title ? title.charAt(0).toUpperCase() : '?'}
				</div>
			)}
		</div>
	)
}
