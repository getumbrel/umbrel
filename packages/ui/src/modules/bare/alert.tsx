import {TbAlertTriangleFilled} from 'react-icons/tb'

import {cn} from '@/shadcn-lib/utils'

export function Alert({children, className}: {children: React.ReactNode; className?: string}) {
	return (
		<div
			className={cn(
				'text-normal flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-14 -tracking-2',
				className,
			)}
		>
			<TbAlertTriangleFilled className='h-5 w-5 shrink-0' />
			<span>{children}</span>
		</div>
	)
}
