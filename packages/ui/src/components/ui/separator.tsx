import * as SeparatorPrimitive from '@radix-ui/react-separator'
import * as React from 'react'

import {cn} from '@/lib/utils'

function Separator({
	className,
	orientation = 'horizontal',
	decorative = true,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root> & {
	ref?: React.Ref<React.ComponentRef<typeof SeparatorPrimitive.Root>>
}) {
	return (
		<SeparatorPrimitive.Root
			ref={ref}
			decorative={decorative}
			orientation={orientation}
			className={cn(
				'shrink-0 from-transparent via-white/10 to-transparent',
				orientation === 'horizontal' ? 'h-[1px] w-full bg-linear-to-r' : 'h-full w-[1px] bg-linear-to-b',
				className,
			)}
			{...props}
		/>
	)
}

export {Separator}
