import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import * as React from 'react'
import {TbCheck, TbMinus} from 'react-icons/tb'

import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

function Checkbox({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
	ref?: React.Ref<React.ComponentRef<typeof CheckboxPrimitive.Root>>
}) {
	return (
		<CheckboxPrimitive.Root
			ref={ref}
			className={cn(
				'group peer h-5 w-5 shrink-0 rounded-5 border border-white/20 bg-white/10 ring-offset-neutral-950 transition-[color,background-color,opacity] focus-visible:ring-2 focus-visible:ring-neutral-300 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-brand data-[state=checked]:text-neutral-50 data-[state=checked]:text-white data-[state=indeterminate]:bg-brand data-[state=indeterminate]:text-neutral-50 data-[state=indeterminate]:text-white',
				className,
			)}
			{...props}
		>
			<CheckboxPrimitive.Indicator className={cn('flex items-center justify-center text-current')}>
				<TbCheck
					className='hidden h-4 w-4 animate-in shadow-xs duration-100 ease-out fade-in zoom-in-150 group-data-[state=checked]:block [&>*]:stroke-[3px]'
					style={{
						filter: 'drop-shadow(#00000055 0px 1px 1px)',
					}}
				/>

				<TbMinus
					className='hidden h-4 w-4 animate-in shadow-xs duration-100 ease-out fade-in zoom-in-150 group-data-[state=indeterminate]:block [&>*]:stroke-[3px]'
					style={{
						filter: 'drop-shadow(#00000055 0px 1px 1px)',
					}}
				/>
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	)
}

const checkboxContainerClass = tw`flex items-center space-x-2`
// Removing `peer-disabled:cursor-not-allowed` because we want to disable the checkbox while it's going to the server without changing the cursor
const checkboxLabelClass = tw`text-15 font-medium leading-none peer-disabled:opacity-50`

export {Checkbox, checkboxContainerClass, checkboxLabelClass}
