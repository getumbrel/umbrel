import {useTimeout} from 'react-use'

import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {useWallpaper, WallpaperId, wallpapers} from '@/modules/desktop/wallpaper-context'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {cn} from '@/shadcn-lib/utils'
import {useDialogOpenProps} from '@/utils/dialog'
import {sleep} from '@/utils/misc'

export function WallpaperDrawer() {
	const title = 'Wallpaper'
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('wallpaper')

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
					<DrawerDescription>Choose your Umbrel wallpaper</DrawerDescription>
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
	return (
		<button
			className={cn('relative aspect-1.9 rounded-10', className)}
			style={{
				backgroundImage: `url(${bg})`,
				backgroundSize: 'cover',
				backgroundPosition: 'center',
				...style,
			}}
			onClick={onSelect}
		>
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
