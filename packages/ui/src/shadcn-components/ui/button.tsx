import {Slot} from '@radix-ui/react-slot'
import {cva, type VariantProps} from 'class-variance-authority'
import * as React from 'react'

import './button-styles.css'

import {cn} from '@/shadcn-lib/utils'

const buttonVariants = cva(
	// `bg-clip-padding` to make button bg (especially in progress button) not be clipped by invisible border
	'inline-flex items-center justify-center font-medium transition-[color,background-color,scale,box-shadow,opacity] disabled:pointer-events-none disabled:opacity-50 -tracking-2 leading-inter-trimmed gap-1.5 focus:outline-none focus:ring-3 shrink-0 disabled:shadow-none duration-300 umbrel-button bg-clip-padding',
	{
		variants: {
			variant: {
				default:
					'bg-white/10 active:bg-white/6 hover:bg-white/10 focus:bg-white/10 border-[0.5px] border-white/20 ring-white/20 data-[state=open]:bg-white/10 shadow-button-highlight-soft-hpx focus:border-white/20 focus:border-1 data-[state=open]:border-1 data-[state=open]:border-white/20',
				primary:
					'bg-brand hover:bg-brand-lighter focus:bg-brand-lighter active:bg-brand ring-brand/40 data-[state=open]:bg-brand-lighter shadow-button-highlight-hpx',
				secondary:
					'bg-white/90 hover:bg-white focus:bg-white active:bg-white ring-white/40 data-[state=open]:bg-white text-black',
				destructive:
					'bg-destructive2 hover:bg-destructive2-lighter focus:bg-destructive2-lighter active:bg-destructive2 ring-destructive/40 data-[state=open]:bg-destructive2-lighter shadow-button-highlight-hpx',
			},
			size: {
				sm: 'rounded-full h-[25px] px-[10px] text-12 gap-2',
				md: 'rounded-full h-[30px] min-w-[80px] px-4 text-13',
				'md-squared': 'rounded-8 h-[36px] px-[10px] text-13 gap-2',
				default: 'rounded-full h-[30px] px-2.5 text-12',
				'input-short': 'rounded-full h-9 px-4 text-13 font-medium min-w-[80px]',
				dialog:
					'rounded-full h-[42px] md:h-[30px] min-w-[80px] px-4 font-semibold w-full md:w-auto md:font-medium text-13',
				lg: 'rounded-full h-[40px] px-[15px] text-15',
				xl: 'rounded-10 h-[50px] px-[15px] text-13',
				'icon-only': 'rounded-full h-[30px] w-[30px]',
			},
			text: {
				default: 'text-white',
				destructive: 'text-destructive/90 hover:text-destructive2-lightest focus:text-destructive2-lightest',
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

		// Prevents ordinary buttons in forms from submitting it
		const extraPropsIfButton = Comp === 'button' ? {...props, type: props.type ?? 'button'} : props

		return (
			<Comp className={cn(buttonVariants({variant, size, text, className}))} ref={ref} {...extraPropsIfButton}>
				{children2}
			</Comp>
		)
	},
)
Button.displayName = 'Button'

export {Button, buttonVariants}
