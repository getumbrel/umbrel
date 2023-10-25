import {LucideIcon} from 'lucide-react'
import * as React from 'react'
import type {IconType} from 'react-icons'

import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

const largeIconButtonClass = tw`text-left w-full inline-flex items-center gap-2 rounded-10 border font-normal border-white/4 bg-white/4 hover:bg-white/6 active:bg-white/4 p-2 ring-white/3 transition-colors focus-visible:outline-none focus-visible:ring-3`

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
	icon: IconType | LucideIcon
	description?: React.ReactNode
	iconClassName?: string
}

const LargeIconButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({className, iconClassName, icon, children, description, ...props}, ref) => {
		const IconComponent = icon

		return (
			<button
				className={cn(largeIconButtonClass, className)}
				ref={ref}
				style={{
					boxShadow: '0px 40px 60px 0px rgba(0, 0, 0, 0.10)',
				}}
				{...props}
			>
				<div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-8 bg-white/4'>
					<IconComponent className={cn('h-5 w-5 [&>*]:stroke-1', iconClassName)} />
				</div>
				<div className='space-y-1'>
					<div className='text-13 font-normal leading-tight -tracking-2'>{children}</div>
					{description && (
						<div className='text-12 font-normal leading-tight -tracking-2 text-white/50'>{description}</div>
					)}
				</div>
			</button>
		)
	},
)
LargeIconButton.displayName = 'LargeIconButton'

export {LargeIconButton, largeIconButtonClass}
