import {Portal} from '@radix-ui/react-portal'
import {useTimeout} from 'react-use'

import {useWallpaper} from '@/modules/desktop/wallpaper-context'
import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

/** Covers entire screen to show a message */
export function CoverMessage({children, delayed}: {children: React.ReactNode; delayed?: boolean}) {
	const [show] = useTimeout(600)
	const {wallpaper, localWallpaper} = useWallpaper()

	return (
		<Portal>
			<div
				className={cn(
					'pointer-events-none fixed inset-0 z-50 scale-110 bg-black bg-cover bg-center blur-2xl duration-700',
				)}
				style={{
					backgroundImage: `url(${wallpaper.url || localWallpaper.url})`,
				}}
			/>
			<div className={cn('fixed inset-0 z-50', 'flex flex-col items-center justify-center gap-1')}>
				{!delayed ? children : show() && children}
			</div>
		</Portal>
	)
}

export function CoverMessageParagraph({children}: {children: React.ReactNode}) {
	return <p className={tw`max-sm: px-4 text-center text-13 text-white/60`}>{children}</p>
}
