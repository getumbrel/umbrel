import {ReactNode, Ref, useLayoutEffect} from 'react'
import {useMeasure, useWindowSize} from 'react-use'
import {chunk} from 'remeda'

import type {WidgetRowLayout} from '@/modules/widgets/shared/widget-row'

import {fitColumns, fitRows, homeFit, useIsTouch} from '../home-fit'

/** Where widgets switch to their compact layout (`w-regular` in index.css) */
const COMPACT_BELOW_PX = 140
/** Space under a row without names, before the apps */
const UNNAMED_ROW_GAP_PX = 6
/** Height of the regular scale's widgets on short screens (`w-tall` in index.css) */
const TIGHT_WIDGET_H = 130
/** Below this window width the regular scale keeps less margin, for an extra column */
const FULL_MARGIN_MIN_W = 768

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
	// Using the window instead of measure because max inner page width comes from the scale
	const windowSize = useWindowSize()
	const fit = homeFit({...windowSize, touch: useIsTouch()})
	const breakpoint = forceBreakpoint ?? (fit.phoneScale ? 'S' : 'M')
	const tight = !forceBreakpoint && fit.tightWidgets
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

	const widgetH = responsive([110, tight ? TIGHT_WIDGET_H : 150])
	const widgetLabeledH = widgetH + 26 // widget rect + label

	const paddingX = responsive([10, forceBreakpoint || windowSize.width >= FULL_MARGIN_MIN_W ? 32 : 16])
	const appsPerRowMax = responsive([fit.low ? 8 : 4, 6])
	const appH = responsive([fit.low ? 88 : 90, tight ? 100 : 110])
	const appPad = responsive([12, tight ? 6 : 12])
	const appIcon = responsive([48, 64])
	const appIconRadius = responsive([10, 15])
	const appLabel = responsive([11, 13])
	const appCell = responsive([70, 120])
	const appCellMin = responsive([70, 110])
	const appXGapMax = responsive([20, 30])
	const appXGapMin = responsive([12, 16])

	// The grid's columns, with cells and gaps giving way to keep a column: a 344px
	// outer display still fits four, and a 669px inner display five
	const {
		columns: appsPerRow,
		cellW: appW,
		gapX: appXGap,
	} = fitColumns({
		width: pageW,
		maxColumns: appsPerRowMax,
		cell: {min: appCellMin, max: appCell},
		gap: {min: appXGapMin, max: appXGapMax},
	})
	const widgetW = appW + appXGap + appW

	const appsInnerW = (appCell + appXGapMax) * appsPerRowMax - appXGapMax
	const appsMaxW = appsInnerW + paddingX * 2

	// Widgets share the app grid's width, edge to edge with its columns, instead
	// of each taking two columns. Up to three fit on any screen that holds them at
	// their minimum width: a phone's four columns and a 640–930px window's four or
	// five both fit three, which two-column widgets left a third on page 2.
	const gridW = appsPerRow > 0 ? appsPerRow * appW + (appsPerRow - 1) * appXGap : pageW
	const shareW = (n: number) => (gridW - (n - 1) * appXGap) / n
	// Narrowest a widget gets before the row pages instead: compact on phones, regular from 640px
	const minWidgetW = responsive([96, 160])
	// How many fit side by side at that width, however many there are: two on a 320px phone
	const widgetsFit = Math.max(1, Math.floor((gridW + appXGap) / (minWidgetW + appXGap)))
	const widgetsPerPage = Math.max(1, Math.min(widgets.length, widgetsFit))
	// A phone-scale grid wider than a phone (one on its side) lets widgets span three columns
	const widgetMaxW = breakpoint === 'S' && appsPerRow > 4 ? widgetW + appW + appXGap : widgetW
	const rowWidgetW = Math.floor(Math.min(widgetMaxW, shareW(widgetsPerPage)))
	// Three on a phone: one at its regular size, two compact (see WidgetRow)
	const accordion = breakpoint === 'S' && widgets.length === 3 && widgetsPerPage === 3 && shareW(3) < COMPACT_BELOW_PX
	// A row with any compact widget names none of them, and drops the name line.
	// So do short screens, whose height goes further on another row of apps.
	const named = !accordion && !tight && rowWidgetW >= COMPACT_BELOW_PX
	const rowH = named ? widgetLabeledH : widgetH + UNNAMED_ROW_GAP_PX

	// Rows spread out to fill a page, so a tall screen's apps don't huddle at the top
	const appYGapRange = {min: responsive([0, tight ? 4 : 8]), max: responsive([14, 32])}
	const {rows: appsPerColWhenWidgetRow, gapY: appYGapWithWidgets} = fitRows({
		height: pageH - rowH,
		rowH: appH,
		gap: appYGapRange,
		gapAbove: true,
	})
	// Pages of apps alone, after the widgets' pages, fit as many rows as they can
	// and spread them out on their own, instead of taking the widget pages' gaps
	const {rows: appsPerColAppsOnly, gapY: appYGapAppsOnly} = fitRows({height: pageH, rowH: appH, gap: appYGapRange})
	const widgetsShareAPage = widgets.length > 0 && appsPerColWhenWidgetRow > 0
	const appYGap = widgetsShareAPage ? appYGapWithWidgets : appYGapAppsOnly
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
		el.style.setProperty('--app-pad', `${appPad}px`)
		el.style.setProperty('--app-icon', `${appIcon}px`)
		el.style.setProperty('--app-icon-radius', `${appIconRadius}px`)
		el.style.setProperty('--app-label', `${appLabel}px`)
		el.style.setProperty('--app-x-gap', `${appXGap}px`)
		el.style.setProperty('--app-y-gap', `${appYGap}px`)
		el.style.setProperty('--app-y-gap-apps', `${appYGapAppsOnly}px`)
		el.style.setProperty('--apps-max-w', `${appsMaxW}px`)
		el.style.setProperty('--apps-padding-x', `${paddingX}px`)
		el.style.setProperty('--widget-w', `${widgetW}px`)
		// What each widget in the row gets, which Edit widgets' preview of the row matches
		el.style.setProperty('--widget-row-w', `${rowWidgetW}px`)
		// And how many of them fit on a page, which the preview pages by
		el.style.setProperty('--widgets-fit', `${widgetsFit}`)
		el.style.setProperty('--widget-h', `${widgetH}px`)
		el.style.setProperty('--widget-labeled-h', `${rowH}px`)
		// All values depend on the breakpoint
	}, [
		breakpoint,
		pageW,
		forceBreakpoint,
		rowH,
		appW,
		appXGap,
		appYGap,
		appYGapAppsOnly,
		widgetH,
		paddingX,
		rowWidgetW,
		widgetsFit,
	])

	const pages = groupIntoPages({
		apps,
		widgets,
		widgetsPerPage,
		appsPerPageWithWidgetRow: appsPerRow * appsPerColWhenWidgetRow,
		appsPerPage: appsPerRow * appsPerColAppsOnly,
		widgetsFit: pageH >= rowH,
	})

	// A widgets-only desktop (no apps yet) still pages its widgets
	if (pageH < Math.min(rowH, appH) || (!apps.length && !widgets.length)) {
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

/**
 * Widgets come first, sharing their pages with apps. When a page can't hold
 * them and a row of apps too, as on a phone on its side with Safari's bars
 * showing, the apps come first and the widgets get pages of their own after them.
 */
export function groupIntoPages({
	apps,
	widgets,
	widgetsPerPage,
	appsPerPageWithWidgetRow,
	appsPerPage,
	widgetsFit,
}: {
	apps: ReactNode[]
	widgets: ReactNode[]
	widgetsPerPage: number
	appsPerPageWithWidgetRow: number
	appsPerPage: number
	widgetsFit: boolean
}): PageT[] {
	const widgetsChunked = widgetsFit ? chunk(widgets, widgetsPerPage) : []
	const appPages = (apps: ReactNode[]) =>
		appsPerPage <= 0 ? [] : chunk(apps, appsPerPage).map((apps) => ({widgets: [], apps}))

	if (appsPerPageWithWidgetRow <= 0 && appsPerPage > 0) {
		return [...appPages(apps), ...widgetsChunked.map((widgets) => ({widgets, apps: []}))]
	}

	const widgetPages = widgetsChunked.map((pageWidgets, i) => {
		return {
			widgets: pageWidgets,
			apps: apps.slice(appsPerPageWithWidgetRow * i, appsPerPageWithWidgetRow * (i + 1)),
		}
	})
	// The apps not used in widget pages
	return [...widgetPages, ...appPages(apps.slice(appsPerPageWithWidgetRow * widgetsChunked.length))]
}
