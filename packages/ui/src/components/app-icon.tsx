import {forwardRef, HTMLProps, useState} from 'react'

import {cn} from '@/shadcn-lib/utils'

type AppIconProps = {src: string; size?: number} & HTMLProps<HTMLImageElement>

function ForwardedAppIcon({src, style, size, className, ...props}: AppIconProps, ref: React.Ref<HTMLImageElement>) {
	const [loaded, setLoaded] = useState(false)
	const defaultIcon = '/icons/app-icon-placeholder.svg'

	return (
		<img
			src={src}
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
				backgroundImage: !loaded ? `url(${defaultIcon})` : undefined,
				backgroundColor: !loaded ? 'transparent' : undefined,
			}}
			{...props}
		/>
	)
}

export const AppIcon = forwardRef(ForwardedAppIcon)
