import {useRef} from 'react'
import {useMount} from 'react-use'

import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/components/ui/drawer'
import {FadeInImg} from '@/components/ui/fade-in-img'
import {cn} from '@/lib/utils'
import {useWallpaper, WallpaperId, wallpapers} from '@/providers/wallpaper'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {t} from '@/utils/i18n'

export function WallpaperDrawer() {
	const title = t('wallpaper')
	const dialogProps = useSettingsDialogProps()

	const {wallpaper, setWallpaperId} = useWallpaper()

	const selectWallpaper = (id: WallpaperId) => {
		setWallpaperId(id)
	}

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>{t('wallpaper-description')}</DrawerDescription>
				</DrawerHeader>
				<DrawerScroller>
					<div className='grid grid-cols-2 gap-2.5'>
						{wallpapers.map((w, i) => (
							<WallpaperItem
								key={w.id}
								bg={`/assets/wallpapers/generated-small/${w.id}.jpg`}
								active={w.id === wallpaper.id}
								onSelect={() => selectWallpaper(w.id)}
								className='animate-in fill-mode-both fade-in'
								style={{
									animationDelay: `${i * 20}ms`,
								}}
							/>
						))}
					</div>
				</DrawerScroller>
			</DrawerContent>
		</Drawer>
	)
}

function WallpaperItem({
	active,
	bg,
	onSelect,
	className,
	style,
}: {
	active?: boolean
	bg: string
	onSelect: () => void
	className?: string
	style: React.CSSProperties
}) {
	const ref = useRef<HTMLButtonElement>(null)

	useMount(() => {
		if (!active) return
		ref.current?.scrollIntoView({block: 'center'})
	})

	return (
		<button
			ref={ref}
			className={cn('relative aspect-1.9 overflow-hidden rounded-10 bg-white/10', className)}
			style={{
				...style,
			}}
			onClick={onSelect}
		>
			<FadeInImg src={bg} className='absolute inset-0 h-full w-full rounded-10 object-cover object-center' />
			{/* Border */}
			<div
				className={cn(
					'absolute inset-0 rounded-10 border-4 transition-colors',
					active ? 'border-white' : 'border-transparent',
				)}
			/>
		</button>
	)
}
