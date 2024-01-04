import {useContext} from 'react'

import {cn} from '@/shadcn-lib/utils'

import {BackdropBlurVariantContext} from './shared/backdrop-blur-context'
import {widgetContainerCva, widgetTextCva} from './shared/shared'
import {TablerIcon} from './shared/tabler-icon'

export function ThreeUpWidget() {
	const variant = useContext(BackdropBlurVariantContext)
	return (
		<div
			className={cn(
				widgetContainerCva({variant}),
				'grid justify-stretch gap-1.5 p-1.5 md:grid-cols-3 md:gap-2 md:px-4 md:py-3',
			)}
		>
			<ThreeUpItem iconName='settings' title='Optimal' value='56°C' />
			<ThreeUpItem iconName='settings' title='Free' value='1.75 TB' />
			<ThreeUpItem iconName='settings' title='Memory' value='5.8 GB' />
		</div>
	)
}
function ThreeUpItem({iconName, title, value}: {iconName: string; title?: string; value?: string}) {
	return (
		<div className='flex items-center rounded-5 bg-white/5 max-md:gap-1 max-md:px-1 md:flex-col md:justify-center md:rounded-full'>
			{/* `[&>svg]` to select child svg */}
			<TablerIcon iconName={iconName} className='h-5 w-5 [&>svg]:h-5 [&>svg]:w-5' />
			<p className={widgetTextCva({opacity: 'secondary', className: 'max-sm:hidden md:mt-4'})}>{title}</p>
			<p className={widgetTextCva()}>{value}</p>
		</div>
	)
}
