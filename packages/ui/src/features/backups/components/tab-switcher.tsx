import {motion} from 'motion/react'
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
			{/* Radii just over half the one-line height at any text size, so one line
			    reads as a pill but a label that wraps (a narrow phone, a larger text
			    size) makes a rounded rectangle rather than a tall stadium */}
			<div className='flex w-full rounded-[calc(19px+var(--text-boost))] border-[0.5px] border-white/5 bg-white/5 p-1'>
				{options.map((opt) => {
					const selected = value === opt.id
					return (
						<button
							key={opt.id}
							className={[
								'relative flex-1 rounded-[calc(14px+var(--text-boost))] px-3 py-1 text-12 outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
								selected ? 'text-white' : 'text-white/60',
							].join(' ')}
							onClick={() => onChange(opt.id)}
							type='button'
						>
							{selected && (
								<motion.span
									layoutId='wizard-tabs-pill'
									className='absolute inset-0 -z-10 rounded-[calc(14px+var(--text-boost))] bg-white/10 contrast-more:bg-white/30 contrast-more:ring-1 contrast-more:ring-white contrast-more:ring-inset'
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
