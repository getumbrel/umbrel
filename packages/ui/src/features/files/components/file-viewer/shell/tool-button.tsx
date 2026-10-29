import {Children} from 'react'

import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

// A labelled control in the viewer's toolbar, sized to sit with the round
// icon buttons beside it. Where the actions are a toolbar beneath the file
// (below lg, as useIsMobile has it) it's one of those round buttons, its
// label left to assistive technology.
const toolPillClass = tw`umbrel-button settings-edge-material inline-flex h-12 shrink-0 items-center gap-2 rounded-full bg-white/6 px-5 text-13 font-medium -tracking-2 text-white/85 transition-[background-color,transform] duration-200 hover:bg-white/12 active:scale-95 disabled:pointer-events-none disabled:opacity-40 max-lg:size-12 max-lg:justify-center max-lg:px-0 max-lg:text-white max-lg:[&>svg]:scale-125 max-lg:[&>svg]:opacity-100`

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
