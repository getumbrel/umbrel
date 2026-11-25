import {Calendar, Camera, File, FileText, Image, MapPin, Music, User, Video, X, type LucideIcon} from 'lucide-react'
import type {ReactNode} from 'react'

import {cn} from '@/lib/utils'

import type {SearchChip} from './types'

// The parts of a query Search took as filters, shown back as quiet tokens:
// "dad in thailand 2026" becomes Dad · Thailand · 2026. Each token rises in
// as it is understood (`.search-chip` in index.css); one that stays across
// keystrokes is keyed by what it says and never replays. Where a surface can
// act on a disagreement (`onRemove`), the whole token is the button that
// takes it off.

const KIND_ICONS: Record<Extract<SearchChip, {type: 'kind'}>['kind'], LucideIcon> = {
	photo: Image,
	video: Video,
	document: FileText,
	audio: Music,
	file: File,
}

export function searchChipIcon(chip: SearchChip): LucideIcon {
	switch (chip.type) {
		case 'person':
			return User
		case 'place':
			return MapPin
		case 'date':
			return Calendar
		case 'kind':
			return KIND_ICONS[chip.kind]
		case 'subKind':
			return Camera
	}
}

export function SearchChips({
	chips,
	className,
	onRemove,
	removeLabel,
	icon,
}: {
	chips: readonly SearchChip[]
	className?: string
	// What stands before a chip's label in place of its kind's icon: a face,
	// where the surface knows the person's
	icon?: (chip: SearchChip) => ReactNode
	onRemove?: (chip: SearchChip) => void
	// The accessible name of a token's remove button
	removeLabel?: (chip: SearchChip) => string
}) {
	if (chips.length === 0) return null
	return (
		<ul className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)}>
			{chips.map((chip, index) => {
				const Icon = searchChipIcon(chip)
				const content = (
					<>
						{icon?.(chip) ?? <Icon className='size-3 shrink-0 text-white/50' strokeWidth={2.25} aria-hidden='true' />}
						<span className='truncate'>{chip.label}</span>
					</>
				)
				return (
					<li
						key={`${chip.type}:${chip.label}`}
						className={cn(
							'search-chip flex h-6 max-w-full min-w-0 items-center rounded-full bg-white/6 text-12 font-medium -tracking-2 text-white/75 shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.08)]',
							!onRemove && 'gap-1 pr-2.5 pl-2',
						)}
						style={{animationDelay: `${index * 40}ms`}}
					>
						{onRemove ? (
							<button
								type='button'
								aria-label={removeLabel?.(chip)}
								onClick={() => onRemove(chip)}
								className='group/chip flex h-full min-w-0 items-center gap-1 rounded-full pr-1.5 pl-2 outline-hidden transition-colors hover:bg-white/6 hover:text-white/90 focus-visible:ring-1 focus-visible:ring-white/50'
							>
								{content}
								<X
									className='size-3 shrink-0 text-white/35 transition-colors group-hover/chip:text-white/80'
									strokeWidth={2.25}
									aria-hidden='true'
								/>
							</button>
						) : (
							content
						)}
					</li>
				)
			})}
		</ul>
	)
}
