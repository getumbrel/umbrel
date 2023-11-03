import {cva, VariantProps} from 'class-variance-authority'
import * as React from 'react'
import {TbAlertCircle, TbEye, TbEyeOff} from 'react-icons/tb'

import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

const inputVariants = cva(
	'flex h-12 w-full rounded-full border-hpx border-white/10 bg-white/4 hover:bg-white/6 px-5 py-2 text-15 font-medium -tracking-1 transition-colors duration-300 placeholder:text-white/30 focus-visible:placeholder:text-white/40 text-white/40 focus-visible:text-white focus-visible:bg-white/10 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40',
	{
		variants: {
			variant: {
				default: '',
				destructive: 'text-destructive2-lighter border-destructive2-lighter',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	},
)

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement>, VariantProps<typeof inputVariants> {
	onValueChange?: (value: string) => void
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
	({className, type, variant, onChange, onValueChange, ...props}, ref) => {
		return (
			<input
				type={type}
				className={cn(inputVariants({variant}), className)}
				ref={ref}
				onChange={(e) => {
					onChange?.(e)
					onValueChange?.(e.target.value)
				}}
				{...props}
			/>
		)
	},
)
Input.displayName = 'Input'

export function InputError({children}: {children: React.ReactNode}) {
	return (
		<div className='flex items-center gap-1 p-1 text-13 font-normal -tracking-2 text-destructive2-lighter'>
			<TbAlertCircle className='h-4 w-4' />
			{children}
		</div>
	)
}

// NOTE: If too many props start getting added to this, best to convert to something like this:
// https://www.radix-ui.com/primitives/docs/components/form
export function PasswordInput({
	value,
	label,
	onValueChange,
	error,
	autoFocus,
}: {
	value?: string
	/** Calling it a label rather than a placeholder */
	label?: string
	onValueChange?: (value: string) => void
	error?: string
	autoFocus?: boolean
}) {
	const [showPassword, setShowPassword] = React.useState(false)
	return (
		<div className='space-y-1'>
			<div className={cn(iconRightClasses.root)}>
				<Input
					variant={error ? 'destructive' : undefined}
					placeholder={label}
					type={showPassword ? 'text' : 'password'}
					className={iconRightClasses.input}
					value={value}
					onChange={(e) => onValueChange?.(e.target.value)}
					autoFocus={autoFocus}
				/>
				<button
					// Prevent tabbing to this button to prevent accidentally showing the password
					tabIndex={-1}
					type='button'
					className={iconRightClasses.button}
					onClick={() => setShowPassword((prev) => !prev)}
				>
					{showPassword ? <TbEyeOff className={iconRightClasses.icon} /> : <TbEye className={iconRightClasses.icon} />}
				</button>
			</div>
			{error && <InputError>{error}</InputError>}
		</div>
	)
}

// Grouping like this to because they all depend on each other
/**
 * Classes for
 */
const iconRightClasses = {
	root: tw`relative`,
	input: tw`pr-11`,
	// Using `text-white opacity-40` instead of `text-white/40` because the latter applies to strokes and displays incorrectly
	button: tw`absolute inset-y-0 right-0 h-full pl-2 pr-4 text-white opacity-40 outline-none hover:opacity-80 transition-opacity`,
	icon: tw`h-5 w-5`,
}
