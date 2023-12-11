import {ReactNode} from 'react'

export const NumberedList = ({children}: {children: ReactNode}) => {
	return <ol className='ml-7 list-none divide-y divide-white/5 text-15'>{children}</ol>
}

export const NumberedListItem = ({children}: {children: ReactNode}) => {
	return (
		<li className='relative py-3 leading-tight before:absolute before:grid before:h-5 before:w-5 before:-translate-x-7 before:place-items-center before:rounded-full before:bg-white/10 before:content-[counter(list-item)]'>
			{children}
		</li>
	)
}
