import {useState} from 'react'

import {cn} from '@/shadcn-lib/utils'

export function FadeInImg({src, alt, className, ...props}: React.ImgHTMLAttributes<HTMLImageElement>) {
	const [loaded, setLoaded] = useState(false)

	return (
		<img
			src={src}
			alt={alt}
			className={cn('transition-opacity duration-500 fill-mode-both', loaded ? 'opacity-100' : 'opacity-0', className)}
			onLoad={() => {
				setLoaded(true)
			}}
			{...props}
		/>
	)
}
