import React from 'react'

import {cn} from '@/shadcn-lib/utils'

export function ListRow({
	title,
	description,
	children,
	isLabel = false,
}: {
	title: string
	description: React.ReactNode
	children?: React.ReactNode
	isLabel?: boolean
}) {
	const El = isLabel ? 'label' : 'div'

	return (
		<El
			className={cn(
				'flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 py-4',
				isLabel &&
					'cursor-pointer bg-gradient-to-r from-transparent to-transparent hover:via-white/4 active:via-white/3',
			)}
		>
			<div className='flex flex-col gap-1'>
				<h3 className='text-14 font-medium leading-none -tracking-2'>{title}</h3>
				<p className='text-12 leading-none -tracking-2 text-white/40'>{description}</p>
			</div>
			{children}
		</El>
	)
}
