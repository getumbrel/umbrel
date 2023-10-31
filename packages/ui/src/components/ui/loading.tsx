import {TbLoader} from 'react-icons/tb'

export function Loading() {
	return (
		<div className='flex items-center gap-1'>
			<TbLoader className='animate-spin' />
			Loading...
		</div>
	)
}
