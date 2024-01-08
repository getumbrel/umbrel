import {widgetTextCva} from './shared'

export function StatText({title, value, valueSub}: {title?: string; value?: string; valueSub?: string}) {
	return (
		// tabular-nums to prevent the numbers from jumping around, especially when showing live data
		<div className='flex flex-col gap-1 tabular-nums md:gap-2'>
			{title && <div className={widgetTextCva({opacity: 'secondary'})}>{title}</div>}
			<div className='flex min-w-0 items-end gap-1 text-12 font-semibold leading-none -tracking-3 opacity-80 md:text-24'>
				<span className='min-w-0 truncate'>{value}</span>
				<span className='min-w-0 flex-1 truncate text-13 font-bold opacity-[45%]'>{valueSub}</span>
			</div>
		</div>
	)
}
