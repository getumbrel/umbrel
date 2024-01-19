import * as DialogPrimitive from '@radix-ui/react-dialog'
import {RiCloseCircleFill} from 'react-icons/ri'

import {cn} from '@/shadcn-lib/utils'
import {dialogHeaderCircleButtonClass} from '@/utils/element-classes'

export const DialogCloseButton = ({className}: {className?: React.ReactNode}) => (
	<DialogPrimitive.Close className={cn(dialogHeaderCircleButtonClass, className)}>
		<RiCloseCircleFill className='h-5 w-5 md:h-6 md:w-6' />
		<span className='sr-only'>Close</span>
	</DialogPrimitive.Close>
)
