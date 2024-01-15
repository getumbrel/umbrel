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
			<div className='fixed left-1 top-1 z-50'>
				<TbLoader className='animate-spin' />
			</div>
		</Portal>
	)
}
