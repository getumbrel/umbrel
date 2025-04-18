import {forwardRef, HTMLProps, useState} from 'react'

import {APP_ICON_PLACEHOLDER_SRC} from '@/modules/desktop/app-icon'
import {cn} from '@/shadcn-lib/utils'

type AppIconProps = {src?: string; size?: number} & HTMLProps<HTMLImageElement>

function ForwardedAppIcon({src, style, size, className, ...props}: AppIconProps, ref: React.Ref<HTMLImageElement>) {
	const [imgSrc, setImgSrc] = useState(src || APP_ICON_PLACEHOLDER_SRC)

	// Not using `FadeImg` because we have a placeholder and `FadeImg` doesn't support placeholder images
	// Also not fading any other way because we want color-thief to work by picking up the color
	return (
		<img
			src={imgSrc}
			alt=''
			ref={ref}
			className={cn(
				'aspect-square shrink-0 border-[1px] border-slate-100/10 bg-white/10 bg-cover bg-center',
				className,
			)}
			onError={() => setImgSrc(APP_ICON_PLACEHOLDER_SRC)}
			style={{
				...style,
				width: size,
				height: size,
				minWidth: size,
				minHeight: size,
			}}
			{...props}
		/>
	)
}

export const AppIcon = forwardRef(ForwardedAppIcon)
