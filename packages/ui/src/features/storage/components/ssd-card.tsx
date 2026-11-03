import {IoShieldHalf} from 'react-icons/io5'
import {TiInfoLarge} from 'react-icons/ti'

// A horizontal SSD card built around the same artwork the SSD health dialog
// uses. Unlike the Umbrel Pro tray (a photo of a real chassis), this makes no
// assumption about the machine it lives in, so it suits generic hardware in
// onboarding and the Storage Manager.

export type SsdCardProps = {
	/** Formatted capacity, e.g. "2 TB" */
	size: string
	/** Drive model name shown under the capacity */
	model?: string
	/**
	 * Storage drives are tinted with the brand color, the FailSafe (parity) drive white;
	 * neutral is the quiet resting state for selection lists. The Storage Manager adds
	 * red and amber for drives in trouble, and teal for a freshly detected drive.
	 */
	variant?: 'storage' | 'failsafe' | 'neutral' | 'critical' | 'attention' | 'new'
	hasWarning?: boolean
	onInfoClick?: () => void
	/** Names the info button for screen readers */
	infoLabel?: string
	/** Extra element at the card's right edge, e.g. a selection checkmark */
	trailing?: React.ReactNode
	/** Sits on the capacity's line, for anything worth knowing at a glance */
	status?: React.ReactNode
	/** The drive's main action, beside the info button */
	action?: React.ReactNode
}

// The same palette as the Umbrel Pro tray overlays: brand for pool storage,
// white for FailSafe so it reads against any wallpaper-derived brand color.
const tints = {
	storage: {
		border: 'hsl(var(--color-brand))',
		background: 'linear-gradient(90deg, hsl(var(--color-brand) / 0.3) 0%, hsl(var(--color-brand) / 0) 85%)',
	},
	failsafe: {
		border: '#FFFFFF',
		background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.24) 0%, rgba(255, 255, 255, 0) 85%)',
	},
	neutral: {
		border: 'rgba(255, 255, 255, 0.14)',
		background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0) 85%)',
	},
	critical: {
		border: '#E22C2C',
		background: 'linear-gradient(90deg, rgba(255, 47, 50, 0.4) 0%, rgba(255, 47, 50, 0) 85%)',
	},
	attention: {
		border: '#F5A623',
		background: 'linear-gradient(90deg, rgba(245, 166, 35, 0.32) 0%, rgba(245, 166, 35, 0) 85%)',
	},
	new: {
		border: 'rgb(45, 212, 191)',
		background: 'linear-gradient(90deg, rgba(45, 212, 191, 0.3) 0%, rgba(45, 212, 191, 0) 85%)',
	},
} as const

export function SsdCard({
	size,
	model,
	variant = 'storage',
	hasWarning = false,
	onInfoClick,
	infoLabel,
	trailing,
	status,
	action,
}: SsdCardProps) {
	const tint = tints[variant]
	return (
		<div className='relative h-[76px] overflow-hidden rounded-xl'>
			{/* SSD artwork anchored to the left edge, dissolving rightward */}
			<img
				src='/assets/onboarding/ssd-info.webp'
				alt=''
				draggable={false}
				className='pointer-events-none absolute inset-y-0 left-0 h-full w-auto max-w-none'
				style={{
					maskImage: 'linear-gradient(to right, black 55%, transparent 100%)',
					WebkitMaskImage: 'linear-gradient(to right, black 55%, transparent 100%)',
				}}
			/>
			{/* Tint overlay traced onto the label plate baked into the artwork (x86 y36 h179 of
			    the 881x253 image, scaled to the card's 76px height), extended rightward and
			    fading out with the photo so the color reads as part of the image */}
			<div
				className='pointer-events-none absolute rounded-lg border'
				style={{
					left: 26,
					top: 11,
					height: 54,
					right: 4,
					borderColor: tint.border,
					background: tint.background,
					maskImage: 'linear-gradient(to right, black 35%, transparent 96%)',
					WebkitMaskImage: 'linear-gradient(to right, black 35%, transparent 96%)',
				}}
			/>
			{/* pl clears the heatsink fins and the plate's left inset */}
			<div className='relative flex h-full items-center justify-between gap-3 pr-3 pl-14'>
				<div className='flex min-w-0 flex-col'>
					<div className='flex min-w-0 items-baseline gap-2'>
						<span
							className='shrink-0 text-[17px] leading-tight font-bold text-white'
							style={{textShadow: '0 0 8px rgba(255, 255, 255, 0.2)'}}
						>
							{size}
						</span>
						{status}
					</div>
					{model && (
						<span className='truncate text-[12px] text-white/50' title={model}>
							{model}
						</span>
					)}
				</div>
				<div className='flex shrink-0 items-center gap-2.5'>
					{trailing}
					{variant === 'failsafe' && <IoShieldHalf className='size-4 text-white' />}
					{action}
					{onInfoClick && (
						<button
							type='button'
							onClick={onInfoClick}
							aria-label={infoLabel}
							className='relative flex items-center justify-center rounded-full border border-white/[0.16] bg-white/[0.08] p-1 transition-colors hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-hidden'
						>
							<TiInfoLarge className='size-4 text-white/60' />
							{hasWarning && (
								<span className='absolute -top-0.5 -right-0.5 size-2.5'>
									<span className='absolute inset-0 rounded-full bg-[#F5A623]' />
									<span className='absolute inset-0 animate-ping rounded-full bg-[#F5A623] opacity-75' />
								</span>
							)}
						</button>
					)}
				</div>
			</div>
		</div>
	)
}
