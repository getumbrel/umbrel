import {ReactNode} from 'react'

import {cn} from '@/lib/utils'

export function SectionHeading({
	overline,
	title,
	rightChildren,
	className,
}: {
	overline?: string
	title: ReactNode
	rightChildren?: ReactNode
	className?: string
}) {
	return (
		<div className={cn('flex items-end justify-between gap-3 px-2.5', className)}>
			<div className='flex min-w-0 flex-col gap-1'>
				{/* Overlines only come from the apps.umbrel.com feed, which is English. Marking them
				    so keeps the capitals English too: no Turkish "EDİTOR'S PİCKS" */}
				{overline && (
					<p lang='en' className='text-11 leading-tight font-semibold tracking-wide uppercase opacity-40'>
						{overline}
					</p>
				)}
				<h2 className='truncate text-17 leading-tight font-semibold -tracking-3 md:text-19'>{title}</h2>
			</div>
			{rightChildren && <div className='flex shrink-0 items-center gap-2'>{rightChildren}</div>}
		</div>
	)
}
