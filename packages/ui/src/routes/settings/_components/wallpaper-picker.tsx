import {useEffect, useRef} from 'react'

import {cn} from '@/lib/utils'
import {useWallpaper, wallpapers} from '@/providers/wallpaper'

// TODO: export from wallpaper.tsx when lucide-react is confirmed available
function UploadIcon({className}: {className?: string}) {
	return (
		<svg
			xmlns='http://www.w3.org/2000/svg'
			className={className}
			fill='none'
			viewBox='0 0 24 24'
			stroke='currentColor'
			strokeWidth={1.5}
		>
			<path
				strokeLinecap='round'
				strokeLinejoin='round'
				d='M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5'
			/>
		</svg>
	)
}

const ITEM_W = 40
const GAP = 4
const ACTIVE_SCALE = 1.4

function WallpaperItem({
	active,
	bg,
	onSelect,
	className,
	ref,
}: {
	active?: boolean
	bg: string
	onSelect: () => void
	className?: string
	ref?: React.Ref<HTMLButtonElement>
}) {
	return (
		<button
			ref={ref}
			onClick={onSelect}
			className={cn(
				'h-6 shrink-0 bg-white/10 bg-cover bg-center ring-white/50 outline-hidden transition-all duration-200 hover:brightness-125 focus-visible:ring-1',
				active
					? // NOTE: `mx-3` or whatever horizontal marging needs to be big enough to not cause the ring to get clipped from scrolling container
						'mx-3 rounded-5 ring-2 ring-white/50'
					: 'rounded-3',
				className,
			)}
			style={{
				width: ITEM_W,
				transform: `scale(${active ? ACTIVE_SCALE : 1})`,
				backgroundImage: `url(${bg})`,
				// transformOrigin: "left center",
			}}
		/>
	)
}

// TODO: delay mounting for performance
export function WallpaperPicker({maxW}: {maxW?: number}) {
	const {wallpaper, setWallpaperId, uploadWallpaper} = useWallpaper()
	const containerRef = useRef<HTMLDivElement>(null)
	const scrollerRef = useRef<HTMLDivElement>(null)
	const itemsRef = useRef<HTMLDivElement>(null)
	const selectedItemRef = useRef<HTMLButtonElement>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)

	async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0]
		if (!file) return

		// Normalise any browser-supported format (PNG, WebP, HEIC…) to JPEG and strip EXIF
		const objectUrl = URL.createObjectURL(file)
		const img = new Image()
		img.src = objectUrl
		await new Promise<void>((resolve) => {
			img.onload = () => resolve()
		})

		const canvas = document.createElement('canvas')
		canvas.width = img.naturalWidth
		canvas.height = img.naturalHeight
		const ctx = canvas.getContext('2d')!
		ctx.drawImage(img, 0, 0)
		URL.revokeObjectURL(objectUrl)

		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
		if (!blob) return

		const arrayBuffer = await blob.arrayBuffer()
		const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
		await uploadWallpaper(base64)
	}

	useEffect(() => {
		if (!containerRef.current || !selectedItemRef.current || !itemsRef.current || !scrollerRef.current) {
			return
		}

		const containerW = containerRef.current.clientWidth
		const index = wallpapers.findIndex((w) => w.id === wallpaper.id)

		scrollerRef.current.scrollTo({
			behavior: 'smooth',
			left: index * (ITEM_W + GAP) - containerW / 2 + (ITEM_W * ACTIVE_SCALE) / 2,
		})
	}, [wallpaper.id])

	return (
		// h-7 so we don't affect height of parent, but make gap work when wrapping
		<div ref={containerRef} className='flex h-7 max-w-full flex-grow-1 animate-in items-center fade-in'>
			<div
				className={cn(
					'umbrel-hide-scrollbar umbrel-wallpaper-fade-scroller w-full items-center overflow-x-auto bg-red-500/0 py-3',
					!maxW && 'md:max-w-[350px]',
				)}
				ref={scrollerRef}
				style={{
					maxWidth: maxW,
				}}
			>
				{/* NOTE: doing `items-center` here would cause the spacer items collapse because of a flex bug */}
				<div ref={itemsRef} className='flex' style={{gap: GAP}}>
					<div className='w-1 shrink-0' />
					{wallpapers.map((w) => (
						<WallpaperItem
							ref={w.id === wallpaper.id ? selectedItemRef : undefined}
							key={w.id}
							active={w.id === wallpaper.id}
							onSelect={() => {
								setWallpaperId(w.id)
							}}
							bg={`/assets/wallpapers/generated-thumbs/${w.id}.jpg`}
						/>
					))}
					<input
						ref={fileInputRef}
						type='file'
						accept='image/*'
						className='hidden'
						onChange={handleFileChange}
					/>
					<button
						type='button'
						onClick={() => fileInputRef.current?.click()}
						className='flex h-6 w-10 shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-3 border border-dashed border-white/30 hover:border-white/60 transition-colors outline-hidden focus-visible:ring-1 ring-white/50'
						aria-label='Upload custom wallpaper'
					>
						<UploadIcon className='h-2.5 w-2.5 text-white/60' />
					</button>
					<div className='w-1 shrink-0' />
				</div>
			</div>
		</div>
	)
}
