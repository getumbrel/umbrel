import {useContext} from 'react'

import {cn} from '@/shadcn-lib/utils'

import {BackdropBlurVariantContext} from './shared/backdrop-blur-context'
import {widgetContainerCva, widgetTextCva} from './shared/shared'

export function ActionsWidget() {
	const variant = useContext(BackdropBlurVariantContext)
	return (
		<div className={cn(widgetContainerCva({variant}), 'relative gap-0 p-2 pb-2.5 md:gap-2 md:p-5')}>
			<ActionItem emoji='🔒' title='Change password' />
			<div className='origin-left scale-90 opacity-60'>
				<ActionItem emoji='🔒' title='Change password' />
			</div>
			<div className='origin-left scale-[85%] opacity-40'>
				<ActionItem emoji='🔒' title='Change password' />
			</div>
			<div className='origin-left scale-[80%] opacity-20'>
				<ActionItem emoji='🔒' title='Change password' />
			</div>
			<div className='absolute bottom-3 right-3 text-[33px] font-semibold leading-none -tracking-3 opacity-10'>123</div>
		</div>
	)
}
function ActionItem({emoji, title}: {emoji: string; title?: string}) {
	return (
		<div className='flex items-center gap-1.5'>
			<div className='flex h-5 w-5 items-center justify-center rounded-5 bg-white/5'>{emoji}</div>
			<p className={widgetTextCva()}>{title}</p>
		</div>
	)
}
