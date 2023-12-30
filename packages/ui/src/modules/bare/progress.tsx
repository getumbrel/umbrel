import * as ProgressPrimitive from '@radix-ui/react-progress'
import {ReactNode} from 'react'
import {isNil} from 'remeda'

import {cn} from '@/shadcn-lib/utils'

export function Progress({value, children}: {value?: number; children?: ReactNode}) {
	return (
		<div className='flex w-full flex-col items-center gap-5'>
			<ProgressPrimitive.Root
				className={cn(
					'relative h-1.5 w-full overflow-hidden rounded-full bg-white/10 sm:w-[80%]',
					isNil(value) && 'umbrel-bouncing-gradient',
				)}
			>
				<ProgressPrimitive.Indicator
					className='h-full w-full flex-1 rounded-full bg-white transition-all'
					style={{transform: `translateX(-${100 - (value || 0)}%)`}}
				/>
			</ProgressPrimitive.Root>
			{children && <span className='text-15 font-medium leading-none -tracking-2 opacity-80'>{children}</span>}
		</div>
	)
}
