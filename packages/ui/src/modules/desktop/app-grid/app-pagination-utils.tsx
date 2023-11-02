import {ReactNode, Ref, useLayoutEffect} from 'react'
import {createBreakpoint, useMeasure} from 'react-use'
import {chunk} from 'remeda'

const useBreakpoint = createBreakpoint({S: 0, M: 600})

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
export function usePager({apps, widgets}: PageT): {
	pages: PageT[]
	pageInnerRef: Ref<HTMLDivElement>
} {
	// Using breakpoint instead of measure because max inner page width comes from breakpoint
	const breakpoint = useBreakpoint()
	const [pageInnerRef, pageSize] = useMeasure<HTMLDivElement>()

	const pageW = pageSize.width
	const pageH = pageSize.height

	const widgetH = 150 + 26 // widget rect + label

	const responsive = (sizes: number | number[]) => {
		if (typeof sizes === 'number') {
			return sizes
		}
		if (breakpoint === 'S') {
			return sizes[0]
		}
		return sizes[1]
	}

	const paddingX = responsive([10, 32])
	const appsPerRowMax = responsive([4, 6])
	const appW = responsive([60, 120])
	const appH = responsive([110, 120])
	const appXGap = responsive([20, 30])
	const appYGap = responsive([0, 20])
	const widgetW = appW + appXGap + appW

	const appsInnerW = (appW + appXGap) * appsPerRowMax - appXGap
	const appsMaxW = appsInnerW + paddingX * 2

	// Putting on document so that app grid and widget selector both have access
	useLayoutEffect(() => {
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
		// All values depend on the breakpoint
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [breakpoint, pageW])

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
		function countWidgetsPerPage({pageW}: {pageW: number}) {
			const widgetsPerPage = (pageW + appXGap) / (widgetW + appXGap)
			// const pagesWithWidgetsCount = Math.ceil(widgetCount / widgetsPerPage);
			return widgetsPerPage
		}
		function countAppsPerCol({pageH}: {pageH: number}) {
			return Math.floor((pageH + appYGap) / (appH + appYGap))
		}
		function countAppsPerColWhenWidgetRow({pageH}: {pageH: number}) {
			const restH = pageH - widgetH - appYGap
			return Math.floor((restH + appYGap) / (appH + appYGap))
		}
		function countAppsPerRow({pageW}: {pageW: number}) {
			return Math.floor((pageW + appXGap) / (appW + appXGap))
		}

		const widgetsPerPage = countWidgetsPerPage({pageW})
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

	if (pageH < widgetH || !apps.length || apps.length === 0) {
		// Don't show any apps or widgets
		return {
			pageInnerRef,
			pages: [{widgets: [], apps: []}],
		}
	}

	return {pageInnerRef, pages}
}
