import externalStorageIcon from '@/features/files/assets/external-storage-icon.png'
import sdCard from '@/features/storage/assets/sd-card.svg'
import {cn} from '@/lib/utils'

// Drive depictions for the external-drive choice in onboarding.

export type DriveLed = 'green' | 'amber' | 'red' | 'none'

// The drive enclosure render shared with the Files feature - verified against the Figma
// export to be the exact artwork the designs use. The healthy state is the asset as-is
// (green LED baked in at 78.7%/83.9%); the failed/missing state covers the LED with a red
// glow (the design achieves its red variant with overlays too - there is no red asset).
export function DriveIcon({led = 'none', className}: {led?: DriveLed; className?: string}) {
	return (
		<div className={cn('relative h-11 w-12 shrink-0', className)}>
			<img src={externalStorageIcon} alt='' draggable={false} className='size-full object-contain' />
			{(led === 'red' || led === 'amber') && (
				<span
					className={cn(
						'absolute size-[11%] rounded-full',
						led === 'red'
							? 'bg-[#FF3434] shadow-[0_0_6px_1px_rgba(255,52,52,0.8)]'
							: 'bg-[#F5A623] shadow-[0_0_6px_1px_rgba(245,166,35,0.8)]',
					)}
					style={{left: '78.7%', top: '83.9%', transform: 'translate(-50%, -50%)'}}
				/>
			)}
		</div>
	)
}

// The SD card vector (body gradient, edge contacts, hairline outline). Portrait 3:4 like a
// real card.
export function SdCard({className}: {className?: string}) {
	return <img src={sdCard} alt='' draggable={false} className={cn('h-12 w-9 shrink-0', className)} />
}
