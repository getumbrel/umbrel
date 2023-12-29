import * as DialogPrimitive from '@radix-ui/react-dialog'
import {RiCloseCircleFill} from 'react-icons/ri'

import {cn} from '@/shadcn-lib/utils'

export const DialogCloseButton = ({className}: {className?: React.ReactNode}) => (
	<DialogPrimitive.Close
		className={cn(
			'rounded-full opacity-30 outline-none ring-white/60 transition-opacity hover:opacity-40 focus-visible:opacity-40 focus-visible:ring-2',
			className,
		)}
	>
		<RiCloseCircleFill className='h-6 w-6' />
		<span className='sr-only'>Close</span>
	</DialogPrimitive.Close>
)
