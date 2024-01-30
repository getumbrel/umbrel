import {forwardRef, useEffect, useRef} from 'react'
import {useTimeout} from 'react-use'

import {useWallpaper, wallpapers} from '@/modules/desktop/wallpaper-context'
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

// TODO: delay mounting for performance
export function WallpaperPicker({delayed, maxW}: {delayed?: boolean; maxW?: number}) {
	const {wallpaper, setWallpaperId} = useWallpaper()
	const containerRef = useRef<HTMLDivElement>(null)
	const scrollerRef = useRef<HTMLDivElement>(null)
	const itemsRef = useRef<HTMLDivElement>(null)
	const selectedItemRef = useRef<HTMLButtonElement>(null)

	const [show] = useTimeout(600)

	const canShow = delayed ? show() : true

	useEffect(() => {
		if (!canShow) return
		if (!containerRef.current || !selectedItemRef.current || !itemsRef.current || !scrollerRef.current) {
			return
		}

		const containerW = containerRef.current.clientWidth
		const index = wallpapers.findIndex((w) => w.id === wallpaper.id)

		scrollerRef.current.scrollTo({
			behavior: 'smooth',
			left: index * (ITEM_W + GAP) - containerW / 2 + (ITEM_W * ACTIVE_SCALE) / 2,
		})
	}, [wallpaper.id, canShow])

	if (!canShow) return null

	return (
		// h-7 so we don't affect height of parent, but make gap work when wrapping
		<div ref={containerRef} className='flex-grow-1 flex h-7 max-w-full items-center animate-in fade-in'>
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
							bg={`/wallpapers/generated-thumbs/${w.id}.jpg`}
						/>
					))}
					<div className='w-1 shrink-0' />
				</div>
			</div>
		</div>
	)
}
