import * as DialogPrimitive from '@radix-ui/react-dialog'
import {RiCloseCircleFill} from 'react-icons/ri'

import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

export const DialogCloseButton = ({className}: {className?: React.ReactNode}) => (
	<DialogPrimitive.Close className={cn(closeClass, className)}>
		<RiCloseCircleFill className='h-6 w-6' />
		<span className='sr-only'>Close</span>
	</DialogPrimitive.Close>
)

const closeClass = tw`group rounded-full outline-none ring-white/60 focus-visible:opacity-40 focus-visible:ring-2 opacity-30 hover:opacity-40`
