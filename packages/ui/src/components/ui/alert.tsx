import {LucideIcon} from 'lucide-react'
import {IconType} from 'react-icons'

import {cn} from '@/shadcn-lib/utils'

export function ErrorAlert({
	icon,
	description,
	className,
}: {
	icon?: IconType | LucideIcon
	description: React.ReactNode
	className?: string
}) {
	const IconComponent = icon

	return (
		<div
			className={cn(
				'flex items-center gap-2 rounded-8 bg-[#3C1C1C] p-2.5 text-13 leading-tight -tracking-2 text-[#FF3434]',
				className,
			)}
		>
			{IconComponent && <IconComponent className='h-5 w-5 shrink-0' />}
			<span className='opacity-60'>{description}</span>
		</div>
	)
}
