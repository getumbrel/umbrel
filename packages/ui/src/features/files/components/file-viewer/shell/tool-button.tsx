import {Children} from 'react'

import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

// The height of every control in the viewer's chrome: that of the round icon
// buttons (lightboxButtonClass), 48px, or 40px on a phone or in a short window
export const toolHeightClass = tw`h-10 sm:h-12 [@media(height<660px)]:h-10`

// A labelled control in the viewer's toolbar, as tall as the round icon
// buttons beside it. Where the actions are a toolbar beneath the file (below
// lg, as useIsMobile has it) it's one of those round buttons, its label left
// to assistive technology.
const toolPillClass = cn(
	toolHeightClass,
	tw`umbrel-button settings-edge-material inline-flex shrink-0 items-center gap-2 rounded-full bg-white/6 px-5 text-13 font-medium -tracking-2 text-white/85 transition-[background-color,transform] duration-200 hover:bg-white/12 active:scale-95 disabled:pointer-events-none disabled:opacity-40 max-lg:aspect-square max-lg:justify-center max-lg:px-0 max-lg:text-white max-lg:[&>svg]:scale-125 max-lg:[&>svg]:opacity-100`,
)

export function ToolPill({
	active,
	className,
	children,
	...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
	// Whether a pill that toggles is on, which it says when it's off too; a pill that only acts leaves it out
	active?: boolean
}) {
	return (
		<button
			type='button'
			aria-pressed={active}
			className={cn(toolPillClass, active && 'bg-white/20 hover:bg-white/25', className)}
			{...props}
		>
			{Children.map(children, (child) =>
				typeof child === 'string' ? <span className='max-lg:sr-only'>{child}</span> : child,
			)}
		</button>
	)
}
