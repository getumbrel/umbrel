import {forwardRef, HTMLProps, useState} from 'react'

import {APP_ICON_PLACEHOLDER_SRC} from '@/modules/desktop/app-icon'
import {cn} from '@/shadcn-lib/utils'

type AppIconProps = {src?: string; size?: number} & HTMLProps<HTMLImageElement>

function ForwardedAppIcon({src, style, size, className, ...props}: AppIconProps, ref: React.Ref<HTMLImageElement>) {
	const [loaded, setLoaded] = useState(false)

	// Not using `FadeImg` because we have a placeholder and `FadeImg` doesn't support placeholder images
	// Also not fading any other way because we want color-thief to work by picking up the color
	return (
		<img
			src={src || APP_ICON_PLACEHOLDER_SRC}
			alt=''
			ref={ref}
			className={cn('aspect-square shrink-0 bg-cover bg-center', !loaded && 'bg-white/10', className)}
			onLoad={() => setLoaded(true)}
			style={{
				...style,
				width: size,
				height: size,
				minWidth: size,
				minHeight: size,
				// borderRadius: (size * 15) / 50, // 15px for 50px size
				backgroundImage: !loaded ? `url(${APP_ICON_PLACEHOLDER_SRC})` : undefined,
				backgroundColor: !loaded ? 'transparent' : undefined,
			}}
			{...props}
		/>
	)
}

export const AppIcon = forwardRef(ForwardedAppIcon)
