import {TbArrowRight} from 'react-icons/tb'

import {CoverMessage} from '@/components/ui/cover-message'
import {LinkButton} from '@/components/ui/link-button'

export function NotFound() {
	return (
		<CoverMessage>
			404 | Not Found
			<LinkButton to='/' size='sm' variant='default' className='mt-1'>
				Go Home <TbArrowRight className='inline-block' />
			</LinkButton>
		</CoverMessage>
	)
}
