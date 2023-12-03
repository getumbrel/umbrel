import {cva, VariantProps} from 'class-variance-authority'
import {LucideIcon} from 'lucide-react'
import {forwardRef} from 'react'
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

const alertVariants = cva(
	'relative rounded-lg py-2 px-3 gap-[5px] text-14 leading-tight -tracking-2 rounded-full truncate flex items-center',
	{
		variants: {
			variant: {
				default: 'bg-white/10',
				warning: 'bg-[#4B2D00] text-[#F27400]',
				destructive: 'bg-[#3C1C1C] text-[#F23737]',
				success: 'bg-[#142F14] text-[#18CE15]',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	},
)

type AlertProps = React.HTMLAttributes<HTMLDivElement> &
	VariantProps<typeof alertVariants> & {
		icon?: IconType | LucideIcon
	}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(({className, variant, icon, children, ...props}, ref) => {
	const Icon = icon

	return (
		<div ref={ref} role='alert' className={cn(alertVariants({variant}), className)} {...props}>
			{Icon && <Icon className='h-4 w-4 shrink-0' />}
			{children}
		</div>
	)
})
Alert.displayName = 'Alert'
