import {forwardRef, useEffect, useRef} from 'react'

import {useWallpaper, wallpapers} from '@/components/wallpaper-context'
import {cn} from '@/shadcn-lib/utils'

const ITEM_W = 40
const GAP = 4
const ACTIVE_SCALE = 1.4

const WallpaperItem = forwardRef(
	(
		{
			active,
			bg,
			onSelect,
			className,
		}: {
			active?: boolean
			bg: string
			onSelect: () => void
			className?: string
		},
		ref: React.ForwardedRef<HTMLButtonElement>,
	) => {
		return (
			<button
				ref={ref}
				onClick={onSelect}
				className={cn(
					'h-6 shrink-0 bg-white/10 bg-cover bg-center outline-none ring-white/50 transition-all duration-200 focus-visible:ring-1',
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
	},
)

WallpaperItem.displayName = 'WallpaperItem'

export function WallpaperPicker() {
	const {wallpaper, setWallpaperId} = useWallpaper()
	const containerRef = useRef<HTMLDivElement>(null)
	const scrollerRef = useRef<HTMLDivElement>(null)
	const itemsRef = useRef<HTMLDivElement>(null)
	const selectedItemRef = useRef<HTMLButtonElement>(null)

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
		// h-8 so we don't affect height of parent, but make gap work when wrapping
		<div ref={containerRef} className='flex-grow-1 flex h-8 max-w-full items-center'>
			<div
				className='umbrel-hide-scrollbar umbrel-wallpaper-fade-scroller w-full items-center overflow-x-auto bg-red-500/0 py-3 md:max-w-[350px]'
				ref={scrollerRef}
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
							bg={w.url}
						/>
					))}
					<div className='w-1 shrink-0' />
				</div>
			</div>
		</div>
	)
}
