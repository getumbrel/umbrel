import {SVGProps, useId} from 'react'
import {TbWifi, TbWifi0, TbWifi1, TbWifi2, TbWifiOff} from 'react-icons/tb'

import {cn} from '@/shadcn-lib/utils'

export function WifiIcon({bars = 4, className}: {bars: number; className?: string}) {
	const components = [TbWifiOff, TbWifi0, TbWifi1, TbWifi2, TbWifi]

	const Comp = components[bars]

	if (bars === 0) {
		return (
			<div className={cn('relative bg-red-500/20', className)}>
				<TbWifiOff className={cn('opacity-20 absolute-center', className)} />
			</div>
		)
	}

	return (
		<div className={cn('relative bg-red-500/20', className)}>
			<TbWifi className={cn('opacity-20 absolute-center', className)} />
			<Comp className={cn('absolute-center', className)} />
		</div>
	)
}

export function WifiIcon2({bars = 4, ...props}: {bars: number} & SVGProps<SVGSVGElement>) {
	const uniqueId = useId()

	return (
		<svg xmlns='http://www.w3.org/2000/svg' width={24} height={24} viewBox='0 0 24 24' fill='currentColor' {...props}>
			<defs>
				<path
					id={`${uniqueId}-a`}
					fillRule='evenodd'
					d='M11.002 17.177a1 1 0 0 1 1-1h.009a1 1 0 1 1 0 2h-.009a1 1 0 0 1-1-1Z'
					clipRule='evenodd'
				/>
				<path
					id={`${uniqueId}-b`}
					fillRule='evenodd'
					d='M12.002 14.726a2.45 2.45 0 0 0-1.733.718 1 1 0 1 1-1.414-1.415 4.451 4.451 0 0 1 6.294 0 1 1 0 1 1-1.414 1.415 2.45 2.45 0 0 0-1.733-.718Z'
					clipRule='evenodd'
				/>
				<path
					id={`${uniqueId}-c`}
					fillRule='evenodd'
					d='M12.002 11.274a5.9 5.9 0 0 0-4.174 1.729 1 1 0 1 1-1.414-1.414 7.901 7.901 0 0 1 11.176 0 1 1 0 1 1-1.415 1.414 5.9 5.9 0 0 0-4.173-1.729Z'
					clipRule='evenodd'
				/>
				<path
					id={`${uniqueId}-d`}
					fillRule='evenodd'
					d='M18.643 10.565c-3.68-3.657-9.603-3.654-13.254-.002a1 1 0 1 1-1.415-1.414c4.435-4.436 11.622-4.432 16.08-.002a1 1 0 1 1-1.41 1.418Z'
					clipRule='evenodd'
				/>
			</defs>
			<use fillRule='evenodd' clipRule='evenodd' href={`#${uniqueId}-a`} className='opacity-20' />
			{bars >= 1 && <use fillRule='evenodd' clipRule='evenodd' href={`#${uniqueId}-a`} />}
			<use fillRule='evenodd' clipRule='evenodd' href={`#${uniqueId}-b`} className='opacity-20' />
			{bars >= 2 && <use fillRule='evenodd' clipRule='evenodd' href={`#${uniqueId}-b`} />}
			<use fillRule='evenodd' clipRule='evenodd' href={`#${uniqueId}-c`} className='opacity-20' />
			{bars >= 3 && <use fillRule='evenodd' clipRule='evenodd' href={`#${uniqueId}-c`} />}
			<use fillRule='evenodd' clipRule='evenodd' href={`#${uniqueId}-d`} className='opacity-20' />
			{bars >= 4 && <use fillRule='evenodd' clipRule='evenodd' href={`#${uniqueId}-d`} />}
		</svg>
	)
}

export function WifiIcon2Circled({bars = 4, isConnected}: {bars: number; isConnected?: boolean}) {
	return (
		<div
			className={cn(
				'grid size-6 shrink-0 place-items-center rounded-full border border-white/20 bg-white/10 bg-white/6',
				isConnected && 'bg-brand',
			)}
		>
			<WifiIcon2
				className='size-5'
				bars={bars}
				style={{
					filter: 'drop-shadow(0px 0px 2px rgba(255,255,255,.5))',
				}}
			/>
		</div>
	)
}

export function LockIcon() {
	return (
		<svg width='12' height='12' viewBox='0 0 12 12' fill='none' xmlns='http://www.w3.org/2000/svg' className='shrink-0'>
			<path
				fill-rule='evenodd'
				clip-rule='evenodd'
				d='M4.91724 2.38599C5.20441 2.09883 5.59389 1.9375 6 1.9375C6.40611 1.9375 6.79559 2.09883 7.08276 2.38599C7.36992 2.67316 7.53125 3.06264 7.53125 3.46875V4.96875H4.46875V3.46875C4.46875 3.06264 4.63008 2.67316 4.91724 2.38599ZM3.53125 4.96875V3.46875C3.53125 2.814 3.79135 2.18606 4.25433 1.72308C4.71731 1.2601 5.34525 1 6 1C6.65475 1 7.28269 1.2601 7.74567 1.72308C8.20865 2.18606 8.46875 2.814 8.46875 3.46875V4.96875H8.5C9.32843 4.96875 10 5.64032 10 6.46875V9.46875C10 10.2972 9.32843 10.9688 8.5 10.9688H3.5C2.67157 10.9688 2 10.2972 2 9.46875V6.46875C2 5.64032 2.67157 4.96875 3.5 4.96875H3.53125Z'
				fill='currentColor'
			/>
		</svg>
	)
}
