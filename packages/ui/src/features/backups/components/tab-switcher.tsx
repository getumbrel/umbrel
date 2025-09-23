import {motion} from 'framer-motion'
import * as React from 'react'

export function TabSwitcher({
	options,
	value,
	onChange,
}: {
	options: Array<{id: string; label: string}>
	value: string
	onChange: (v: string) => void
}) {
	return (
		<div className='relative w-full'>
			<div className='flex w-full rounded-full border-[0.5px] border-white/5 bg-white/5 p-1'>
				{options.map((opt) => {
					const selected = value === opt.id
					return (
						<button
							key={opt.id}
							className={[
								'relative flex-1 rounded-full px-3 py-1 text-12 focus:outline-none focus:ring-0',
								selected ? 'text-white' : 'text-white/60',
							].join(' ')}
							onClick={() => onChange(opt.id)}
							type='button'
						>
							{selected && (
								<motion.span
									layoutId='wizard-tabs-pill'
									className='absolute inset-0 -z-10 rounded-full bg-white/10'
									transition={{type: 'tween', ease: 'easeInOut', duration: 0.2}}
								/>
							)}
							{opt.label}
						</button>
					)
				})}
			</div>
		</div>
	)
}
