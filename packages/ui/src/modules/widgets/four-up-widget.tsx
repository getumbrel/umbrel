import {useContext} from 'react'

import {cn} from '@/shadcn-lib/utils'

import {BackdropBlurVariantContext} from './shared/backdrop-blur-context'
import {widgetContainerCva, widgetTextCva} from './shared/shared'

export function FourUpWidget() {
	const variant = useContext(BackdropBlurVariantContext)
	return (
		<div
			className={cn(widgetContainerCva({variant}), 'grid grid-cols-2 grid-rows-2 gap-0 gap-1 p-1.5 md:gap-2 md:p-2.5')}
		>
			<FourUpItem title='Connections' value='10' valueSub='peers' />
			<FourUpItem title='Mempool' value='35' valueSub='MB' />
			<FourUpItem title='Hashrate' value='366' valueSub='EH/s' />
			<FourUpItem title='Blockchain size' value='563' valueSub='GB' />
		</div>
	)
}
function FourUpItem({title, value, valueSub}: {title?: string; value?: string; valueSub?: string}) {
	return (
		<div className='flex flex-col justify-center rounded-5 bg-white/5 px-1 leading-none md:rounded-12 md:px-5'>
			<p
				className={cn(
					widgetTextCva({
						opacity: 'secondary',
					}),
					'text-[8px] md:text-11',
				)}
				title={value}
			>
				{title}
			</p>
			<p className={widgetTextCva()}>
				{value} <span className={widgetTextCva({opacity: 'tertiary'})}>{valueSub}</span>
			</p>
		</div>
	)
}
