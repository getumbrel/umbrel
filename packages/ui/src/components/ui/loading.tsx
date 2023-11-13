import {TbLoader} from 'react-icons/tb'

export function Loading({children}: {children?: React.ReactNode}) {
	return (
		<div className='flex items-center gap-1'>
			<TbLoader className='animate-spin' />
			{children ?? 'Loading'}...
		</div>
	)
}
