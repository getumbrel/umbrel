import {TbAlertCircle, TbAlertTriangle, TbCircleCheck, TbInfoCircle} from 'react-icons/tb'
import * as SonnerPrimitive from 'sonner'

import {buttonVariants} from '@/shadcn-components/ui/button'
import {tw} from '@/utils/tw'

export function Toaster() {
	return (
		<SonnerPrimitive.Toaster
			position='top-center'
			toastOptions={{
				unstyled: true,
				classNames: {
					toast: tw`bg-[#404040]/40 rounded-12 py-4 px-5 backdrop-blur-md flex items-center gap-2 shadow-dialog text-15 text-white -tracking-4 w-full`,
					title: tw`font-medium leading-[18px]`,
					description: tw`opacity-60 leading-[18px]`,
					actionButton: buttonVariants(),
				},
			}}
		/>
	)
}

const toastFunction = (...args: Parameters<typeof SonnerPrimitive.toast>) => {
	return SonnerPrimitive.toast(...args)
}

export const toast = Object.assign(toastFunction, {
	...SonnerPrimitive.toast,
	success: (message: string, opts?: SonnerPrimitive.ExternalToast) =>
		SonnerPrimitive.toast.success(message, {...opts, icon: <TbCircleCheck className='h-6 w-6' />}),
	info: (message: string, opts?: SonnerPrimitive.ExternalToast) =>
		SonnerPrimitive.toast.info(message, {...opts, icon: <TbInfoCircle className='h-6 w-6' />}),
	warning: (message: string, opts?: SonnerPrimitive.ExternalToast) =>
		SonnerPrimitive.toast.warning(message, {...opts, icon: <TbAlertTriangle className='h-6 w-6' />}),
	error: (message: string, opts?: SonnerPrimitive.ExternalToast) =>
		SonnerPrimitive.toast.error(message, {...opts, icon: <TbAlertCircle className='h-6 w-6' />}),
})
