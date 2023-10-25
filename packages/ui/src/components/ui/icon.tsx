import type {VariantProps} from 'class-variance-authority'
import type {LucideIcon} from 'lucide-react'
import type {IconType} from 'react-icons'

import {buttonVariants} from '@/shadcn-components/ui/button'
import {cn} from '@/shadcn-lib/utils'

type SizeVariant = VariantProps<typeof buttonVariants>['size']
type Size = NonNullable<SizeVariant>

type IconProps = {
	component: IconType | LucideIcon
	style?: React.CSSProperties
	size?: SizeVariant
} & Omit<React.ComponentPropsWithoutRef<'svg'>, 'size'>

const sizeMap = {
	default: '14px',
	dialog: '14px',
	none: '14px',
	icon: '14px',
	lg: '19px',
} as const satisfies Record<Size, string>

export function Icon({component, size = 'default', style, className, ...props}: IconProps) {
	const Comp = component

	return (
		<Comp
			className={cn('shrink-0 opacity-80', className)}
			{...props}
			style={{
				...style,
				width: sizeMap[size ?? 'default'],
				height: sizeMap[size ?? 'default'],
			}}
		/>
	)
}
