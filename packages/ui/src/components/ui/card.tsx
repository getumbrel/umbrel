import {HtmlHTMLAttributes} from 'react'

import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

export function Card({
	children,
	className,
	...props
}: {children?: React.ReactNode; className?: string} & HtmlHTMLAttributes<HTMLDivElement>) {
	return (
		<div className={cn(cardClass, className)} {...props}>
			{children}
		</div>
	)
}

export const cardClass = tw`rounded-12 bg-white/5 px-3 py-4 max-lg:min-h-[95px] lg:p-6`
