import * as DialogPrimitive from '@radix-ui/react-dialog'
import {useTranslation} from 'react-i18next'
import {RiCloseCircleFill} from 'react-icons/ri'

import {cn} from '@/lib/utils'
import {dialogHeaderCircleButtonClass} from '@/utils/element-classes'

export const DialogCloseButton = ({className}: {className?: React.ReactNode}) => {
	const {t} = useTranslation()
	return (
		<DialogPrimitive.Close className={cn(dialogHeaderCircleButtonClass, className)}>
			<RiCloseCircleFill className='h-5 w-5 lg:h-6 lg:w-6' />
			<span className='sr-only'>{t('close')}</span>
		</DialogPrimitive.Close>
	)
}
