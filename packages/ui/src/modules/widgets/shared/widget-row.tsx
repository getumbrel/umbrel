import {createContext, CSSProperties, isValidElement, ReactNode, useContext, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {tw} from '@/utils/tw'

import {WidgetMorphContext} from './widget-shell'
import {WidgetWrapper} from './widget-wrapper'

/** How usePager lays out a widget row (see app-pagination-utils.tsx) */
export type WidgetRowLayout = {
	/** Every widget's width, or the narrow ones' in the accordion */
	widgetW: number
	/** The regular phone widget: the accordion's widened one */
	focusW: number
	/** The app grid's width, which the row spans */
	gridW: number
	accordion: boolean
	/** No names under any widget when any is compact */
	named: boolean
	/** The slot's height: the widget, plus the name line when named */
	rowH: number
}

// The accordion's gap and how long a widget takes to widen
const ACCORDION_GAP_PX = 5
const ACCORDION_MS = 320
const FOCUS_STORAGE_KEY = 'widgets-row-focused'

const AccordionContext = createContext<{
	focusedId: string
	focus: (id: string) => void
	focusW: number
	narrowW: number
} | null>(null)

/**
 * A page's widget row. Its widgets share `layout.widgetW`, and are named only
 * when none is compact.
 *
 * With three on a phone the row is an accordion: one widget at its regular
 * size, the other two compact. Tapping a compact one widens it and narrows the
 * other; the widened one opens its app as usual. The widgets stay mounted
 * throughout (no new glass lens per tap), and each cross-fades between its two
 * layouts at their own widths while it resizes (WidgetMorphContext).
 */
export function WidgetRow({layout, children}: {layout: WidgetRowLayout; children: ReactNode[]}) {
	const style = {
		'--widget-w': `${layout.widgetW}px`,
		'--widget-labeled-h': `${layout.rowH}px`,
		'--widget-names': layout.named ? 'block' : 'none',
	} as CSSProperties
	if (!layout.accordion) {
		return (
			<div className={widgetRowClass} style={style}>
				{children}
			</div>
		)
	}
	return (
		<AccordionRow layout={layout} style={style}>
			{children}
		</AccordionRow>
	)
}

function AccordionRow({
	layout,
	style,
	children,
}: {
	layout: WidgetRowLayout
	style: CSSProperties
	children: ReactNode[]
}) {
	// Widget nodes are keyed by widget id (desktopWidgetNode)
	const ids = children.map((child) => (isValidElement(child) ? String(child.key) : ''))
	// The widened widget survives a reload; a removed one falls back to the first
	const [storedId, setStoredId] = useState(() => {
		try {
			return localStorage.getItem(FOCUS_STORAGE_KEY)
		} catch {
			return null
		}
	})
	const focusedId = storedId && ids.includes(storedId) ? storedId : ids[0]
	const focus = (id: string) => {
		setStoredId(id)
		try {
			localStorage.setItem(FOCUS_STORAGE_KEY, id)
		} catch {
			// Private mode: the focus just won't persist
		}
	}
	const narrowW = (layout.gridW - layout.focusW - ACCORDION_GAP_PX * (ids.length - 1)) / (ids.length - 1)
	return (
		<AccordionContext value={{focusedId, focus, focusW: layout.focusW, narrowW}}>
			<div className='flex w-full justify-center' style={{...style, gap: ACCORDION_GAP_PX}}>
				{children}
			</div>
		</AccordionContext>
	)
}

/**
 * A widget in the homescreen row, with its app's name under it. In the
 * accordion it's also the widget's resizing tile, and a compact one's own
 * controls are inert behind one button that widens it.
 */
export function WidgetSlot({id, label, children}: {id: string; label: string; children: ReactNode}) {
	const {t} = useTranslation()
	const accordion = useContext(AccordionContext)
	if (!accordion) return <WidgetWrapper label={label}>{children}</WidgetWrapper>

	const focused = accordion.focusedId === id
	return (
		<div
			className='shrink-0 transition-[width] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none'
			style={
				{
					width: focused ? accordion.focusW : accordion.narrowW,
					transitionDuration: `${ACCORDION_MS}ms`,
					'--widget-w': '100%',
				} as CSSProperties
			}
		>
			<WidgetWrapper label={label}>
				<div className='relative h-[var(--widget-h)] w-full'>
					<WidgetMorphContext
						value={{showing: focused ? 'regular' : 'compact', compactW: accordion.narrowW, regularW: accordion.focusW}}
					>
						<div inert={!focused} className='h-full w-full'>
							{children}
						</div>
					</WidgetMorphContext>
					{!focused && (
						<button
							aria-label={t('widget.expand', {name: label})}
							onClick={() => accordion.focus(id)}
							className='absolute inset-0 rounded-17 outline-hidden focus-visible:ring-6 focus-visible:ring-white/25'
						/>
					)}
				</div>
			</WidgetWrapper>
		</div>
	)
}

const widgetRowClass = tw`flex gap-[var(--app-x-gap)] w-full justify-center`
