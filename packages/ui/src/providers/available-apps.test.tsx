// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import type {RegistryApp} from '@/trpc/trpc'

import {AvailableAppsProvider, useAllAvailableApps, useAvailableApps} from './available-apps'

const fixtures = vi.hoisted(() => {
	const app = (appStoreId: string, id: string) => ({appStoreId, id, category: 'files'}) as RegistryApp
	return {
		officialOnly: app('umbrel-app-store', 'official-only'),
		officialConflict: app('umbrel-app-store', 'conflict'),
		communityConflict: app('community-store', 'conflict'),
	}
})

vi.mock('@/trpc/trpc', async (importOriginal) => {
	const original = await importOriginal<typeof import('@/trpc/trpc')>()
	return {
		...original,
		trpcReact: {
			appStore: {
				registry: {
					useQuery: () => ({
						data: [
							{
								meta: {id: 'umbrel-app-store'},
								apps: [fixtures.officialOnly, fixtures.officialConflict],
							},
							{meta: {id: 'community-store'}, apps: [fixtures.communityConflict]},
						],
						isLoading: false,
						isError: false,
					}),
				},
			},
		},
	}
})

const observe = vi.fn()

function Probe() {
	const allApps = useAllAvailableApps()
	const officialApps = useAvailableApps()
	const communityApps = useAvailableApps('community-store')
	observe({allApps, officialApps, communityApps})
	return null
}

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

describe('AvailableAppsProvider', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => root.unmount())
		container.remove()
		vi.clearAllMocks()
	})

	test('quarantines global collisions while keeping registry-qualified browsing available', () => {
		act(() =>
			root.render(
				<AvailableAppsProvider>
					<Probe />
				</AvailableAppsProvider>,
			),
		)

		const value = observe.mock.calls.at(-1)?.[0]
		expect(value.allApps.apps).toEqual([fixtures.officialOnly])
		expect(value.allApps.appsKeyed).toEqual({'official-only': fixtures.officialOnly})
		expect(value.allApps.resolvedAppsKeyed).toEqual({
			'official-only': fixtures.officialOnly,
			conflict: fixtures.officialConflict,
		})
		expect(value.allApps.ambiguousAppIds).toEqual(new Set(['conflict']))
		expect(value.officialApps.appsKeyed.conflict).toBe(fixtures.officialConflict)
		expect(value.communityApps.appsKeyed.conflict).toBe(fixtures.communityConflict)
	})
})
