import {useRef} from 'react'
import {useTranslation} from 'react-i18next'
import {useMount} from 'react-use'

import {useDrawerOrDialog} from '@/components/ui/drawer-or-dialog'
import {FadeInImg} from '@/components/ui/fade-in-img'
import {cn} from '@/lib/utils'
import {useWallpaper, WallpaperAvifSource, WallpaperId, wallpapers, type Wallpaper} from '@/providers/wallpaper'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'

export function WallpaperDrawerOrDialog() {
	const {t} = useTranslation()
	const title = t('wallpaper')
	const dialogProps = useSettingsDialogProps()
	const {Root, Content, Header, Title, Description, Scroller} = useDrawerOrDialog()

	const {wallpaper, setWallpaperId} = useWallpaper()

	const selectWallpaper = (id: WallpaperId) => {
		setWallpaperId(id)
	}

	return (
		<Root {...dialogProps}>
			<Content fullHeight>
				<Header>
					<Title>{title}</Title>
					<Description>{t('wallpaper-description')}</Description>
				</Header>
				<Scroller>
					<div className='grid grid-cols-2 gap-2.5'>
						{wallpapers.map((w, i) => (
							<WallpaperItem
								key={w.id}
								wallpaper={w}
								active={w.id === wallpaper.id}
								onSelect={() => selectWallpaper(w.id)}
								className='animate-in fill-mode-both fade-in'
								style={{
									animationDelay: `${i * 20}ms`,
								}}
							/>
						))}
					</div>
				</Scroller>
			</Content>
		</Root>
	)
}

function WallpaperItem({
	active,
	wallpaper,
	onSelect,
	className,
	style,
}: {
	active?: boolean
	wallpaper: Wallpaper
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
			type='button'
			ref={ref}
			aria-label={`Wallpaper ${wallpaper.id}`}
			aria-pressed={active}
			className={cn('relative aspect-1.9 overflow-hidden rounded-10 bg-white/10', className)}
			style={{
				...style,
			}}
			onClick={onSelect}
		>
			<picture>
				<WallpaperAvifSource wallpaper={wallpaper} tier='small' />
				<FadeInImg
					src={wallpaper.url}
					className='absolute inset-0 h-full w-full rounded-10 object-cover object-center'
				/>
			</picture>
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
