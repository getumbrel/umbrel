import {createContext, ReactNode, useContext} from 'react'

import {cn} from '@/lib/utils'

import {WidgetContainer} from './shared'

/**
 * Set by the homescreen's accordion row (see widget-row.tsx) while a widget
 * changes size: which layout to show, and the width each one is designed at.
 */
export type WidgetMorph = {showing: 'compact' | 'regular'; compactW: number; regularW: number}
export const WidgetMorphContext = createContext<WidgetMorph | null>(null)

// The type scale every widget shares, so sizes read as one family
export const widgetCaptionClass =
	'truncate text-11 leading-tight font-semibold -tracking-2 opacity-50 w-expanded:text-13'
export const widgetValueClass =
	'min-w-0 truncate text-15 leading-none font-semibold -tracking-3 tabular-nums opacity-90 w-regular:text-17 w-tall:text-20 w-expanded:text-24'
export const widgetValueUnitClass =
	'min-w-0 shrink-[2] truncate text-12 font-semibold -tracking-2 opacity-45 w-expanded:text-13'

// Compact layouts (under 140px wide) use their own, tighter scale
export const compactContainerClass = 'flex h-full w-full flex-col gap-1 p-2.5'
export const compactLabelClass = 'truncate text-[10px] leading-tight font-semibold -tracking-2 opacity-50'
export const compactValueClass = 'truncate text-15 leading-none font-semibold -tracking-3 tabular-nums opacity-90'
export const compactStatClass = 'truncate text-11 leading-snug font-semibold -tracking-2'

// 17px corners on the phone scale, 20px from 640px. The widget is a size
// container named `widget`, which the w-regular / w-tall / w-expanded variants
// (index.css) query
const shellClass = 'gap-0 rounded-17 sm:rounded-20 [container:widget/size]'

/**
 * The widget's glass, holding its compact layout (under 140px wide) and its
 * regular-and-up one (`children`, laid out by `className`). The widget's own
 * width picks one, so crossing 140px swaps content, never the glass.
 *
 * In the accordion both layouts are drawn, each pinned to the width it's
 * designed at, made its own size container and anchored to the left. As the
 * glass resizes, its moving edge reveals or covers them while one fades into
 * the other: no reflow mid-animation, and never an empty widget.
 */
export function WidgetShell({
	onClick,
	className,
	compact,
	children,
}: {
	onClick?: () => void
	className?: string
	compact: ReactNode
	children: ReactNode
}) {
	const morph = useContext(WidgetMorphContext)
	const regular = <div className={cn('flex h-full w-full min-w-0 flex-col', className)}>{children}</div>
	const body = morph ? (
		<div className='relative h-full w-full overflow-hidden rounded-[inherit]'>
			<MorphLayer width={morph.compactW} shown={morph.showing === 'compact'}>
				{compact}
			</MorphLayer>
			<MorphLayer width={morph.regularW} shown={morph.showing === 'regular'}>
				{regular}
			</MorphLayer>
		</div>
	) : (
		<div className='h-full w-full min-w-0'>
			<div className='h-full w-full w-regular:hidden'>{compact}</div>
			<div className='hidden h-full w-full w-regular:block'>{regular}</div>
		</div>
	)
	// WidgetContainer is a <button> only when it gets an onClick
	return onClick ? (
		<WidgetContainer onClick={onClick} className={shellClass}>
			{body}
		</WidgetContainer>
	) : (
		<WidgetContainer className={shellClass}>{body}</WidgetContainer>
	)
}

// A true cross-fade: both start together, the outgoing layout eases out late
// (ease-in) while the incoming eases in early (ease-out), so their combined
// opacity never dips below one. A few pixels of blur on whichever is leaving or
// arriving makes the overlap read as one layout turning into the other.
function MorphLayer({width, shown, children}: {width: number; shown: boolean; children: ReactNode}) {
	return (
		<div
			inert={!shown}
			aria-hidden={!shown || undefined}
			className={cn(
				'absolute inset-y-0 left-0 transition-[opacity,filter] duration-[220ms] [container:widget/size] motion-reduce:transition-none',
				shown
					? 'opacity-100 blur-none ease-[cubic-bezier(0,0,0.2,1)]'
					: 'opacity-0 blur-[3px] ease-[cubic-bezier(0.4,0,1,1)]',
			)}
			style={{width}}
		>
			{children}
		</div>
	)
}
