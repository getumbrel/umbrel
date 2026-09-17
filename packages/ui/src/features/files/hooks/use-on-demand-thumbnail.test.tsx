// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import type {FileSystemItem} from '@/features/files/types'

import {useOnDemandThumbnail} from './use-on-demand-thumbnail'

const mocks = vi.hoisted(() => ({mutate: vi.fn()}))
vi.mock('@/trpc/trpc', () => {
	const utils = {client: {files: {getThumbnail: {mutate: mocks.mutate}}}}
	return {trpcReact: {useUtils: () => utils}}
})
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let queryClient: QueryClient
// Each request the backend has been sent, answered by hand
let requests: {path: string; resolve: (url: string) => void; reject: (error: Error) => void}[]

beforeEach(() => {
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
	queryClient = new QueryClient()
	requests = []
	mocks.mutate.mockReset()
	mocks.mutate.mockImplementation(
		({path}: {path: string}) =>
			new Promise<string>((resolve, reject) => {
				requests.push({path, resolve, reject})
			}),
	)
})

afterEach(async () => {
	vi.useRealTimers()
	act(() => root.unmount())
	host.remove()
	// The line is the module's: hand back every slot a test left held
	await act(async () => requests.forEach((request) => request.resolve('')))
})

const photo = (name: string, extra: Partial<FileSystemItem> = {}) =>
	({name, path: `/Home/${name}`, type: 'image/jpeg', size: 1, modified: 1, operations: [], ...extra}) as FileSystemItem

function Icon({item}: {item: FileSystemItem}) {
	return <span data-path={item.path}>{useOnDemandThumbnail(item) ?? 'none'}</span>
}

const render = (items: FileSystemItem[]) =>
	act(async () =>
		root.render(
			<QueryClientProvider client={queryClient}>
				{items.map((item, index) => (
					<Icon key={index} item={item} />
				))}
			</QueryClientProvider>,
		),
	)
const shown = (item: FileSystemItem) => host.querySelector(`[data-path="${item.path}"]`)?.textContent
// React Query batches its notifications on a timer: let one pass
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))
// The nth ask about a path
const ask = (path: string, nth = 0) => requests.filter((request) => request.path === path)[nth]!
const answer = async (path: string, url: string, nth = 0) => {
	await act(async () => ask(path, nth).resolve(url))
	await settle()
}
// What Files does when a share remounts, a watcher fires, an operation lands:
// every cached listing is invalidated, here two of them
const refreshListings = async () => {
	for (const path of ['/Home', '/Home/Photos'])
		queryClient.setQueryData([['files', 'list'], {input: {path}}], {files: []})
	await act(async () => void queryClient.invalidateQueries({queryKey: [['files', 'list']]}))
	await settle()
}
const fail = async (path: string, nth = 0) => {
	await act(async () => ask(path, nth).reject(new Error('[thumbnail-failed]')))
	await settle()
}

describe('useOnDemandThumbnail', () => {
	test('a thumbnail the listing carried is used as it is, without asking', async () => {
		const item = photo('a.jpg', {thumbnail: '/api/files/thumbnail/a.webp'})
		await render([item])
		expect(shown(item)).toBe('/api/files/thumbnail/a.webp')
		expect(mocks.mutate).not.toHaveBeenCalled()
	})

	test('a missing one is asked for once, however often the row comes back', async () => {
		const item = photo('a.jpg')
		await render([item, {...item}])
		// Two icons for one file share the request
		expect(requests).toHaveLength(1)
		await answer(item.path, '/api/files/thumbnail/a.webp')
		expect(shown(item)).toBe('/api/files/thumbnail/a.webp')

		await render([])
		await render([item])
		expect(shown(item)).toBe('/api/files/thumbnail/a.webp')
		expect(requests).toHaveLength(1)
	})

	test('a file that changed is asked about again', async () => {
		const item = photo('a.jpg')
		await render([item])
		await answer(item.path, '/api/files/thumbnail/a.webp')
		await render([{...item, modified: 2}])
		expect(requests).toHaveLength(2)
	})

	test('a failure is not asked about again by a row that scrolls straight back', async () => {
		const item = photo('broken.jpg')
		await render([item])
		await fail(item.path)
		expect(shown(item)).toBe('none')
		await render([])
		await render([item])
		expect(requests).toHaveLength(1)
	})

	test('… but is not kept either: once it has had time to recover, the next row to show it asks again', async () => {
		vi.useFakeTimers({toFake: ['Date']})
		const item = photo('on-a-nas.jpg')
		await render([item])
		await fail(item.path)
		await render([])
		vi.setSystemTime(Date.now() + 61_000)
		await render([item])
		expect(requests).toHaveLength(2)
		await answer(item.path, '/api/files/thumbnail/nas.webp', 1)
		expect(shown(item)).toBe('/api/files/thumbnail/nas.webp')
	})

	test('a refreshed listing retries the failures at once, on screen or off, and leaves the answers be', async () => {
		vi.useFakeTimers({toFake: ['Date']})
		const [failed, offScreen, fine] = [photo('failed.jpg'), photo('off-screen.jpg'), photo('fine.jpg')]
		await render([failed, offScreen, fine])
		await fail(failed.path)
		await fail(offScreen.path)
		await answer(fine.path, '/api/files/thumbnail/fine.webp')
		await render([failed, fine])
		expect(requests).toHaveLength(3)

		// A listing refreshing in the same breath changes nothing: a busy folder
		// must not re-ask its broken files on every pass
		await refreshListings()
		expect(requests).toHaveLength(3)

		vi.setSystemTime(Date.now() + 6_000)
		await refreshListings()
		expect(requests.map((request) => request.path)).toEqual([failed.path, offScreen.path, fine.path, failed.path])

		await render([failed, offScreen, fine])
		expect(requests.map((request) => request.path).slice(4)).toEqual([offScreen.path])
	})

	test('a file replaced under the same name and modified time is a new file', async () => {
		const item = photo('a.jpg')
		await render([item])
		await answer(item.path, '/api/files/thumbnail/old.webp')
		// cp -p, rsync -t, a Rewind restore: new bytes, old timestamp
		await render([{...item, size: 2}])
		expect(shown(item)).toBe('none')
		expect(requests).toHaveLength(2)
	})

	test('a file still uploading is left alone until it has arrived', async () => {
		const item = photo('a.jpg', {isUploading: true})
		await render([item])
		expect(requests).toHaveLength(0)
		await render([{...item, isUploading: false}])
		expect(requests).toHaveLength(1)
	})

	test('an ask already sent is finished even if its row leaves: the answer is there when it returns', async () => {
		const item = photo('a.jpg')
		await render([item])
		await render([])
		await answer(item.path, '/api/files/thumbnail/a.webp')
		await render([item])
		expect(shown(item)).toBe('/api/files/thumbnail/a.webp')
		expect(requests).toHaveLength(1)
	})

	test('a row that left while waiting, and came back, is asked about once when its turn comes', async () => {
		const items = Array.from({length: 5}, (_, index) => photo(`${index}.jpg`))
		await render(items)
		await render(items.slice(0, 4))
		await render(items)
		await answer(items[0]!.path, '/api/files/thumbnail/0.webp')
		expect(requests.filter((request) => request.path === items[4]!.path)).toHaveLength(1)
	})

	test('only a few are in flight at once, and a row that leaves gives up its place in line', async () => {
		const items = Array.from({length: 7}, (_, index) => photo(`${index}.jpg`))
		await render(items)
		expect(requests.map((request) => request.path)).toEqual(items.slice(0, 4).map((item) => item.path))

		// 4 and 5 scroll away while waiting; 6 stays
		await render([...items.slice(0, 4), items[6]!])
		await answer(items[0]!.path, '/api/files/thumbnail/0.webp')
		expect(requests.map((request) => request.path)).toEqual([...items.slice(0, 4), items[6]!].map((item) => item.path))

		// The freed slots keep flowing: nothing is left stuck behind the cap
		for (const request of requests.slice(1)) await act(async () => request.resolve(`${request.path}.webp`))
		await settle()
		const late = photo('late.jpg')
		await render([late])
		expect(requests.at(-1)!.path).toBe(late.path)
	})
})
