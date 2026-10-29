import {ReactNode, Ref, useLayoutEffect} from 'react'
import {createBreakpoint, useMeasure} from 'react-use'
import {chunk} from 'remeda'

import type {WidgetRowLayout} from '@/modules/widgets/shared/widget-row'

const useBreakpoint = createBreakpoint({S: 0, M: 640})

/** Where widgets switch to their compact layout (`w-regular` in index.css) */
const COMPACT_BELOW_PX = 140
/** Space under a row without names, before the apps */
const UNNAMED_ROW_GAP_PX = 6

type PageT = {
	widgets: ReactNode[]
	apps: ReactNode[]
}

// TODO: consider refactoring into two parts:
// 1. container size calculation
// 2. grouping into pages

// NOTE: everything is grouped together because into one hook because everything is using
// the same variables. In the future it'll be more obvious if these vars should come from a context,
// or if there's a config object will hold them and then get passed to functions that need it

/**
 * Calculate which apps and widgets will go into which pages based on the returned `pageInnerRef`
 */
export function usePager({apps, widgets, forceBreakpoint}: PageT & {forceBreakpoint?: 'S' | 'M'}): {
	pages: PageT[]
	pageInnerRef: Ref<HTMLDivElement>
	appsPerRow: number
	hasMeasurement: boolean
	widgetRow: WidgetRowLayout
} {
	// Using breakpoint instead of measure because max inner page width comes from breakpoint
	const viewportBreakpoint = useBreakpoint()
	const breakpoint = forceBreakpoint ?? viewportBreakpoint
	const [pageInnerRef, pageSize] = useMeasure<HTMLDivElement>()

	const pageW = pageSize.width
	const pageH = pageSize.height

	const responsive = (sizes: number | number[]) => {
		if (typeof sizes === 'number') {
			return sizes
		}
		if (breakpoint === 'S') {
			return sizes[0]
		}
		return sizes[1]
	}

	const widgetH = responsive([110, 150])
	const widgetLabeledH = widgetH + 26 // widget rect + label

	const paddingX = responsive([10, 32])
	const appsPerRowMax = responsive([4, 6])
	const appW = responsive([70, 120])
	const appH = responsive([90, 110])
	const appXGap = responsive([20, 30])
	const appYGap = responsive([0, 12])
	const widgetW = appW + appXGap + appW

	const appsInnerW = (appW + appXGap) * appsPerRowMax - appXGap
	const appsMaxW = appsInnerW + paddingX * 2

	function countAppsPerRow({pageW}: {pageW: number}) {
		return Math.floor((pageW + appXGap) / (appW + appXGap))
	}

	const appsPerRow = countAppsPerRow({pageW})

	// Widgets share the app grid's width, edge to edge with its columns, instead
	// of each taking two columns. Up to three fit on any screen that holds them at
	// their minimum width: a phone's four columns and a 640–930px window's four or
	// five both fit three, which two-column widgets left a third on page 2.
	const gridW = appsPerRow > 0 ? appsPerRow * appW + (appsPerRow - 1) * appXGap : pageW
	const shareW = (n: number) => (gridW - (n - 1) * appXGap) / n
	let widgetsPerPage = Math.max(1, widgets.length)
	// Narrowest a widget gets before the row pages instead: compact on phones, regular from 640px
	const minWidgetW = responsive([96, 160])
	while (widgetsPerPage > 1 && shareW(widgetsPerPage) < minWidgetW) widgetsPerPage--
	const rowWidgetW = Math.floor(Math.min(widgetW, shareW(widgetsPerPage)))
	// Three on a phone: one at its regular size, two compact (see WidgetRow)
	const accordion = breakpoint === 'S' && widgets.length === 3 && widgetsPerPage === 3
	// A row with any compact widget names none of them, and drops the name line
	const named = !accordion && rowWidgetW >= COMPACT_BELOW_PX
	const rowH = named ? widgetLabeledH : widgetH + UNNAMED_ROW_GAP_PX
	const widgetRow: WidgetRowLayout = {widgetW: rowWidgetW, focusW: widgetW, gridW, accordion, named, rowH}

	// Putting on document so that app grid and widget selector both have access.
	// Skip when forceBreakpoint is set (preview mode) to avoid overwriting
	// the real desktop's values on document.documentElement.
	useLayoutEffect(() => {
		if (forceBreakpoint) return

		const el = document.documentElement
		el.style.setProperty('--page-w', `${pageW}px`)
		el.style.setProperty('--app-w', `${appW}px`)
		el.style.setProperty('--app-h', `${appH}px`)
		el.style.setProperty('--app-x-gap', `${appXGap}px`)
		el.style.setProperty('--app-y-gap', `${appYGap}px`)
		el.style.setProperty('--apps-max-w', `${appsMaxW}px`)
		el.style.setProperty('--apps-padding-x', `${paddingX}px`)
		el.style.setProperty('--widget-w', `${widgetW}px`)
		el.style.setProperty('--widget-h', `${widgetH}px`)
		el.style.setProperty('--widget-labeled-h', `${rowH}px`)
		// All values depend on the breakpoint
	}, [breakpoint, pageW, forceBreakpoint, rowH])

	const pages = groupIntoPages({apps, widgets, pageW, pageH})

	function groupIntoPages({
		apps,
		widgets,
		pageW,
		pageH,
	}: {
		apps: ReactNode[]
		widgets: ReactNode[]
		pageW: number
		pageH: number
	}): PageT[] {
		function countAppsPerCol({pageH}: {pageH: number}) {
			return Math.floor((pageH + appYGap) / (appH + appYGap))
		}
		function countAppsPerColWhenWidgetRow({pageH}: {pageH: number}) {
			const restH = pageH - rowH - appYGap
			return Math.floor((restH + appYGap) / (appH + appYGap))
		}

		const appsPerCol = countAppsPerCol({pageH})
		const appsPerColWhenWidgetRow = countAppsPerColWhenWidgetRow({pageH})
		const appsPerRow = countAppsPerRow({pageW})

		const appsPerPageWithWidgetRow = appsPerRow * appsPerColWhenWidgetRow
		const widgetsChunked = chunk(widgets, widgetsPerPage)

		/*
    WIDGET PAGES
    */
		const widgetPages = widgetsChunked.map((pageWidgets, i) => {
			return {
				widgets: pageWidgets,
				apps: apps.slice(appsPerPageWithWidgetRow * i, appsPerPageWithWidgetRow * (i + 1)),
			}
		})

		/*
    PAGES WITHOUT WIDGETS
    */
		const maxAppsPerPage = appsPerRow * appsPerCol
		// Get the apps not used in widget pages
		const restApps = apps.slice(appsPerPageWithWidgetRow * widgetsChunked.length)
		const appsForPagesWithoutWidgetsChunked = maxAppsPerPage === 0 ? [] : chunk(restApps, maxAppsPerPage)
		const nonWidgetPages = appsForPagesWithoutWidgetsChunked.map((apps) => {
			return {
				widgets: [],
				apps,
			}
		})

		return [...widgetPages, ...nonWidgetPages]
	}

	// A widgets-only desktop (no apps yet) still pages its widgets
	if (pageH < rowH || (!apps.length && !widgets.length)) {
		// Don't show any apps or widgets
		return {
			pageInnerRef,
			pages: [{widgets: [], apps: []}],
			appsPerRow: 0,
			hasMeasurement: pageH > 0 && pageW > 0,
			widgetRow,
		}
	}

	return {pageInnerRef, pages, appsPerRow, hasMeasurement: true, widgetRow}
}
