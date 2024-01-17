import {Portal} from '@radix-ui/react-portal'
import {useIsFetching, useIsMutating} from '@tanstack/react-query'
import {TbLoader} from 'react-icons/tb'

export function LoadingIndicator() {
	const isFetching = useIsFetching()
	const isMutating = useIsMutating()

	if (!isFetching && !isMutating) {
		return null
	}

	return (
		<Portal>
			<div className='fixed bottom-1.5 left-1.5 z-50'>
				<TbLoader className='white h-3 w-3 animate-spin opacity-50 shadow-sm' />
			</div>
		</Portal>
	)
}
