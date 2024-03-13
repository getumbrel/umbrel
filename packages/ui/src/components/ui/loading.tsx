import {TbLoader} from 'react-icons/tb'

import {t} from '@/utils/i18n'

export function Loading({children}: {children?: React.ReactNode}) {
	return (
		<div className='flex items-center gap-1'>
			<Spinner />
			{children ?? t('loading')}
		</div>
	)
}

export function Spinner() {
	return <TbLoader className='animate-spin' />
}
