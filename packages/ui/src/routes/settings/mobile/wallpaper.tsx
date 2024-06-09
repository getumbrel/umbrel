import {useRef} from 'react'
import {useMount, useTimeout} from 'react-use'

import {FadeInImg} from '@/components/ui/fade-in-img'
import {useWallpaper, WallpaperId, wallpapers} from '@/providers/wallpaper'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'
import {sleep} from '@/utils/misc'

export function WallpaperDrawer() {
	const title = t('wallpaper')
	const dialogProps = useSettingsDialogProps()

	const {wallpaper, setWallpaperId} = useWallpaper()

	const selectWallpaper = async (id: WallpaperId) => {
		setWallpaperId(id)
		await sleep(500)
		dialogProps.onOpenChange(false)
	}

	const [isReady] = useTimeout(300)

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>{t('wallpaper-description')}</DrawerDescription>
				</DrawerHeader>
				<DrawerScroller>
					{isReady() && (
						<div className='grid grid-cols-2 gap-2.5'>
							{wallpapers.map((w, i) => (
								<WallpaperItem
									key={w.id}
									bg={`/wallpapers/generated-small/${w.id}.jpg`}
									active={w.id === wallpaper.id}
									onSelect={() => selectWallpaper(w.id)}
									className='animate-in fade-in fill-mode-both'
									style={{
										animationDelay: `${i * 20}ms`,
									}}
								/>
							))}
						</div>
					)}
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
					active ? ' border-white' : 'border-transparent',
				)}
			/>
		</button>
	)
}
