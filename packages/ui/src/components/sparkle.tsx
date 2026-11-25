import {cn} from '@/lib/utils'

// The four-pointed star that stands for Search understanding something —
// what it read, saw or heard rather than a name it matched. Its sides curve
// in, so it reads as a glint of light rather than a shape. On a 24-unit box,
// centred.
export const SPARKLE_PATH =
	'M12 2C12.6 7.2 16.8 11.4 22 12C16.8 12.6 12.6 16.8 12 22C11.4 16.8 7.2 12.6 2 12C7.2 11.4 11.4 7.2 12 2Z'

export function Sparkle({className, style}: {className?: string; style?: React.CSSProperties}) {
	return (
		<svg viewBox='0 0 24 24' aria-hidden='true' className={cn('shrink-0', className)} style={style}>
			<path d={SPARKLE_PATH} fill='currentColor' />
		</svg>
	)
}
