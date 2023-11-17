import {Slot} from '@radix-ui/react-slot'
import {cva, type VariantProps} from 'class-variance-authority'
import * as React from 'react'

import {cn} from '@/shadcn-lib/utils'

const buttonVariants = cva(
	'inline-flex items-center justify-center font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 -tracking-2 leading-inter-trimmed gap-1 focus:outline-none focus:ring-3 shrink-0 disabled:shadow-none duration-300',
	{
		variants: {
			variant: {
				default:
					'bg-white/6 active:bg-white/3 hover:bg-white/10 border-[0.5px] border-white/6 ring-white/20 data-[state=open]:bg-white/10 shadow-button-highlight-soft-hpx',
				primary:
					'bg-brand hover:bg-brand-lighter active:bg-brand ring-brand/40 data-[state=open]:bg-brand-lighter shadow-button-highlight-hpx',
				secondary: 'bg-white/80 hover:bg-white active:bg-white ring-white/40 data-[state=open]:bg-white text-black',
				destructive:
					'bg-destructive2 hover:bg-destructive2-lighter active:bg-destructive2 ring-destructive/40 data-[state=open]:bg-destructive2-lighter shadow-button-highlight-hpx',
			},
			size: {
				sm: 'rounded-full h-[25px] px-[10px] text-12 gap-2',
				default: 'rounded-full h-[30px] px-2.5 text-12',
				dialog: 'rounded-full h-[30px] min-w-[80px] px-4 font-medium text-13',
				lg: 'rounded-full h-[40px] px-[15px] text-17',
				xl: 'rounded-10 h-[50px] px-[15px] text-13',
				'icon-only': 'rounded-full h-[30px] w-[30px]',
			},
			text: {
				default: 'text-white',
				destructive: 'text-destructive/90',
			},
		},
		compoundVariants: [
			{
				variant: 'primary',
				size: 'lg',
				class: 'shadow-button-highlight',
			},
		],
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	},
)

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({className, variant, size, text, asChild = false, children, ...props}, ref) => {
		const Comp = asChild ? Slot : 'button'

		// No children for icon-only buttons
		const children2 = size === 'icon-only' ? null : children

		return (
			<Comp className={cn(buttonVariants({variant, size, text, className}))} ref={ref} {...props}>
				{children2}
			</Comp>
		)
	},
)
Button.displayName = 'Button'

export {Button, buttonVariants}
