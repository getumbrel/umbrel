import {TbCheck} from 'react-icons/tb'

import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

export function ListRadioItem({
	children,
	checked,
	name,
	onSelect,
}: {
	children: React.ReactNode
	checked: boolean
	name?: string
	onSelect: () => void
}) {
	return (
		<div className={cn(listItemClass, 'relative')}>
			{children}
			{checked && <TbCheck className='h-4 w-4' />}
			<input
				type='radio'
				name={name}
				checked={checked}
				onChange={onSelect}
				// Red so it's obvious when opacity is not zero and that it takes the whole space
				// Not using inset-0 because it's not supported in mobile Safari
				className='absolute left-0 top-0 block h-full w-full bg-red-500 opacity-0'
			/>
		</div>
	)
}

export const listClass = tw`divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6`
export const listItemClass = tw`flex items-center gap-3 px-3 h-[50px] text-15 font-medium -tracking-3 justify-between`
