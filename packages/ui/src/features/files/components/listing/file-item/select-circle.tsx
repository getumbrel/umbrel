import {Check} from 'lucide-react'

import {cn} from '@/lib/utils'

// The circle an item wears while a touch screen is selecting: empty until it
// is chosen, then the accent with a check. The same mark a Photos tile wears.
export function SelectCircle({
	selected,
	onPicture = false,
	className,
}: {
	selected: boolean
	// Over a picture or an icon rather than beside it: the empty ring is drawn to show on anything
	onPicture?: boolean
	className?: string
}) {
	return (
		<span
			aria-hidden
			className={cn(
				'flex size-[22px] shrink-0 items-center justify-center rounded-full transition-[background-color,border-color] duration-150 ease-out',
				selected
					? 'bg-brand text-white shadow-[0_1px_3px_rgb(0_0_0/0.35)]'
					: onPicture
						? 'border-[1.5px] border-white/85 bg-black/25 shadow-[0_1px_3px_rgb(0_0_0/0.35)]'
						: 'border-[1.5px] border-white/35 bg-black/10',
				className,
			)}
		>
			{selected && (
				<Check
					className='size-3.5 motion-safe:animate-in motion-safe:duration-150 motion-safe:zoom-in-50'
					strokeWidth={3}
				/>
			)}
		</span>
	)
}
