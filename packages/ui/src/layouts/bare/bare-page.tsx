import {DarkenLayer} from '@/components/darken-layer'
import {Wallpaper} from '@/providers/wallpaper'

export function BarePage({children}: {children: React.ReactNode}) {
	return (
		<>
			<Wallpaper stayBlurred />
			<DarkenLayer />
			<div className='relative flex min-h-[100dvh] flex-col items-center justify-between p-5'>{children}</div>
		</>
	)
}
