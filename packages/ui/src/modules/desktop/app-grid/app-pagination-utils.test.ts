import {describe, expect, it} from 'vitest'

import {groupIntoPages} from './app-pagination-utils'

const apps = Array.from({length: 18}, (_, i) => `app-${i}`)
const widgets = ['storage', 'system', 'files']
const shape = (pages: ReturnType<typeof groupIntoPages>) => pages.map((page) => [page.widgets.length, page.apps.length])

describe('groupIntoPages', () => {
	it('leads with widgets when a page holds them and apps', () => {
		const pages = groupIntoPages({
			apps,
			widgets,
			widgetsPerPage: 3,
			appsPerPageWithWidgetRow: 8,
			appsPerPage: 16,
			widgetsFit: true,
		})
		expect(shape(pages)).toEqual([
			[3, 8],
			[0, 10],
		])
	})

	it('pages widgets that do not fit one row, each page with its apps', () => {
		const pages = groupIntoPages({
			apps,
			widgets,
			widgetsPerPage: 2,
			appsPerPageWithWidgetRow: 9,
			appsPerPage: 18,
			widgetsFit: true,
		})
		expect(shape(pages)).toEqual([
			[2, 9],
			[1, 9],
		])
	})

	it('moves widgets after the apps when a page cannot hold both', () => {
		const pages = groupIntoPages({
			apps,
			widgets,
			widgetsPerPage: 3,
			appsPerPageWithWidgetRow: 0,
			appsPerPage: 16,
			widgetsFit: true,
		})
		expect(shape(pages)).toEqual([
			[0, 16],
			[0, 2],
			[3, 0],
		])
	})

	it('leaves widgets out when they do not fit a page at all', () => {
		const pages = groupIntoPages({
			apps,
			widgets,
			widgetsPerPage: 3,
			appsPerPageWithWidgetRow: 0,
			appsPerPage: 8,
			widgetsFit: false,
		})
		expect(shape(pages)).toEqual([
			[0, 8],
			[0, 8],
			[0, 2],
		])
	})

	it('still pages widgets when there are no apps yet', () => {
		const pages = groupIntoPages({
			apps: [],
			widgets,
			widgetsPerPage: 3,
			appsPerPageWithWidgetRow: 8,
			appsPerPage: 16,
			widgetsFit: true,
		})
		expect(shape(pages)).toEqual([[3, 0]])
	})
})
