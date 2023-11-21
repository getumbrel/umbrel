import {forwardRef, HTMLProps} from 'react'

import {cn} from '@/shadcn-lib/utils'

type AppIconProps = {src: string; size?: number} & HTMLProps<HTMLImageElement>

function ForwardedAppIcon({src, style, size, className, ...props}: AppIconProps, ref: React.Ref<HTMLImageElement>) {
	const defaultIcon = '/icons/app-icon-placeholder.svg'

	return (
		<img
			src={src || defaultIcon}
			alt=''
			ref={ref}
			className={cn('shrink-0 bg-white/10 bg-cover bg-center', className)}
			style={{
				...style,
				width: size,
				height: size,
				minWidth: size,
				minHeight: size,
				// borderRadius: (size * 15) / 50, // 15px for 50px size
				backgroundImage: `url(${defaultIcon})`,
			}}
			{...props}
		/>
	)
}

export const AppIcon = forwardRef(ForwardedAppIcon)
