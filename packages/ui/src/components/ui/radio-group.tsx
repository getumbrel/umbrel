import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import * as React from 'react'

import {cn} from '@/lib/utils'

function RadioGroup({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root> & {
	ref?: React.Ref<React.ComponentRef<typeof RadioGroupPrimitive.Root>>
}) {
	return <RadioGroupPrimitive.Root className={cn('grid gap-2', className)} {...props} ref={ref} />
}

function RadioGroupItem({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item> & {
	ref?: React.Ref<React.ComponentRef<typeof RadioGroupPrimitive.Item>>
}) {
	return (
		<RadioGroupPrimitive.Item
			ref={ref}
			className={cn(
				'group aspect-square h-5 w-5 rounded-full bg-white/10 opacity-100 shadow-radio-outline transition-all duration-300 focus-visible:ring-2 focus-visible:ring-brand-lighter/50 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-white/0',
				className,
			)}
			{...props}
		>
			<RadioGroupPrimitive.Indicator className='flex items-center justify-center'>
				<RadioIndicator />
			</RadioGroupPrimitive.Indicator>
		</RadioGroupPrimitive.Item>
	)
}

const RadioIndicator = () => (
	// Inner stroke not allowed in SVG, so using `clipPath`
	// https://stackoverflow.com/a/32162431
	<svg
		xmlns='http://www.w3.org/2000/svg'
		width={20}
		height={20}
		fill='none'
		className='block animate-in duration-300 zoom-in-50 fade-in'
	>
		<use
			href='#path'
			className='fill-brand stroke-white/20 stroke-2 transition-colors group-focus-visible:fill-brand-lighter'
			clip-path='url(#clip)'
		/>
		<defs>
			<path
				id='path'
				fill-rule='evenodd'
				clip-rule='evenodd'
				d='M10 20C15.5228 20 20 15.5228 20 10C20 4.47715 15.5228 0 10 0C4.47715 0 0 4.47715 0 10C0 15.5228 4.47715 20 10 20ZM10 12C11.1046 12 12 11.1046 12 10C12 8.89543 11.1046 8 10 8C8.89543 8 8 8.89543 8 10C8 11.1046 8.89543 12 10 12Z'
			/>
			<clipPath id='clip'>
				<use href='#path' />
			</clipPath>
		</defs>
	</svg>
)

export {RadioGroup, RadioGroupItem}
