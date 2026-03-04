import {IoShieldHalf} from 'react-icons/io5'
import {TbActivityHeartbeat} from 'react-icons/tb'

import {t} from '@/utils/i18n'

import {FAILSAFE_COLOR} from './use-raid-setup'

export type SsdSlot = {
	size: string // e.g., "2TB"
	hasWarning?: boolean // true if SSD has health issues
}

type SsdTrayProps = {
	/** Array of occupied slots (index 0-3). null/undefined means empty slot */
	slots: (SsdSlot | null | undefined)[]
	/** Slot index (0-3) that is used for failsafe. -1 or undefined means no failsafe */
	failsafeSlot?: number
	/** Callback when health pill is clicked. Receives slot index (0-3) */
	onHealthClick?: (slotIndex: number) => void
}

/**
 * Renders the SSD tray with conditional SSD visibility.
 *
 * Layer order (bottom to top):
 * 1. Empty tray PNG
 * 2. Slot labels (SSD 1, SSD 2, etc.)
 * 3. Individual SSD PNGs (conditionally rendered)
 * 4. Brand color overlays (border + transparent background)
 * 5. Shield icon (failsafe slot only)
 */
export function SsdTray({slots, failsafeSlot = -1, onHealthClick}: SsdTrayProps) {
	return (
		<div className='relative w-full' style={{aspectRatio: '511 / 686', containerType: 'inline-size'}}>
			{/* Layer 1: Empty tray */}
			<img
				src='/assets/onboarding/ssd-tray.webp'
				alt={t('onboarding.raid.ssd-tray-alt')}
				draggable={false}
				className='absolute inset-0 size-full'
			/>

			{/* Layer 2: Slot labels - white with glow when SSD present */}
			{[0, 1, 2, 3].map((i) => (
				<div
					key={`label-${i}`}
					className={`absolute text-center font-medium ${slots[i] ? 'text-white' : 'text-[#656565]'}`}
					style={{
						left: `${18 + i * 19}%`,
						top: '14%',
						width: '17%',
						fontSize: 'clamp(6px, 2.5cqi, 12px)',
						...(slots[i] && {textShadow: '0px 0px 6px rgba(255, 255, 255, 0.25)'}),
					}}
				>
					{t('onboarding.raid.ssd-label', {number: i + 1})}
				</div>
			))}

			{/* Layers 3-5: SSDs with overlays (conditional) */}
			{slots.map((slot, i) => {
				if (!slot) return null

				const isFailsafe = i === failsafeSlot

				return (
					<div key={i}>
						{/* Layer 3: SSD image */}
						<img
							src='/assets/onboarding/ssd.webp'
							alt={t('onboarding.raid.ssd-label', {number: i + 1})}
							draggable={false}
							className='absolute'
							style={{
								left: `${17 + i * 19}%`,
								top: '17%',
								width: '27.2%',
							}}
						/>

						{/* Layer 4: Size text - vertical gradient, underneath overlay */}
						<div
							className='absolute'
							style={{
								left: `${17 + i * 19 - 4}%`,
								top: '-2%',
								width: '27.2%',
								height: '60%',
								display: 'grid',
								placeItems: 'center',
							}}
						>
							<span
								className='font-bold'
								style={{
									fontSize: 'clamp(12px, 6cqw, 24px)',
									writingMode: 'vertical-rl',
									textOrientation: 'mixed',
									transform: 'rotate(180deg)',
									background: 'linear-gradient(180deg, #FFFFFF 0%, #999999 100%)',
									WebkitBackgroundClip: 'text',
									backgroundClip: 'text',
									WebkitTextFillColor: 'transparent',
								}}
							>
								{slot.size}
							</span>
						</div>

						{/* Layer 5: Overlay (border + transparent bg) - brand color for storage, white for failsafe */}
						<div
							className='absolute rounded-lg'
							style={{
								left: `${17.5 + i * 19}%`,
								top: '13%',
								width: '18%',
								height: '53%',
								border: isFailsafe ? `1px solid ${FAILSAFE_COLOR}` : '1px solid hsl(var(--color-brand))',
								backgroundColor: isFailsafe ? 'rgba(0, 132, 255, 0.1)' : 'hsl(var(--color-brand) / 0.1)',
							}}
						/>

						{/* Layer 6: Shield icon - only shown on failsafe slot */}
						{isFailsafe && (
							<div
								className='absolute flex items-center justify-center'
								style={{
									left: `${17.5 + i * 19}%`,
									top: '11%',
									width: '18%',
									height: '56%',
								}}
							>
								<IoShieldHalf className='size-6' style={{color: FAILSAFE_COLOR}} />
							</div>
						)}

						{/* Layer 7: Health status pill - shown at bottom of each SSD */}
						<div
							className='absolute flex items-center justify-center'
							style={{
								left: `${17.5 + i * 19}%`,
								top: '56%',
								width: '18%',
							}}
						>
							<button
								type='button'
								onClick={() => onHealthClick?.(i)}
								className='relative flex items-center justify-center rounded-full border border-white/[0.16] bg-white/[0.08] transition-colors hover:bg-white/[0.12]'
								style={{
									paddingLeft: 'clamp(8px, 3cqi, 14px)',
									paddingRight: 'clamp(8px, 3cqi, 14px)',
									paddingTop: 'clamp(1px, 0.5cqi, 3px)',
									paddingBottom: 'clamp(1px, 0.5cqi, 3px)',
								}}
							>
								<TbActivityHeartbeat
									className='text-white/60'
									style={{width: 'clamp(12px, 4cqi, 20px)', height: 'clamp(12px, 4cqi, 20px)'}}
								/>
								{/* Radar ping warning dot - upper right of pill */}
								{slot.hasWarning && (
									<span
										className='absolute'
										style={{
											top: '-2px',
											right: '-2px',
											width: 'clamp(6px, 2cqi, 10px)',
											height: 'clamp(6px, 2cqi, 10px)',
										}}
									>
										{/* Solid center dot */}
										<span className='absolute inset-0 rounded-full bg-[#F5A623]' />
										{/* Expanding ping ring */}
										<span className='absolute inset-0 animate-ping rounded-full bg-[#F5A623] opacity-75' />
									</span>
								)}
							</button>
						</div>
					</div>
				)
			})}
		</div>
	)
}
