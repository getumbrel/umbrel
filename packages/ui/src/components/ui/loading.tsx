import {TbLoader} from 'react-icons/tb'

import {t} from '@/utils/i18n'

export function Loading({children}: {children?: React.ReactNode}) {
	return (
		<div className='flex items-center gap-1'>
			<TbLoader className='animate-spin' />
			{children ?? t('loading')}...
		</div>
	)
}
