// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, expect, test, vi} from 'vitest'

import ImageViewer from '@/features/files/components/file-viewer/image-viewer'
import type {FileSystemItem} from '@/features/files/types'

const getThumbnail = vi.hoisted(() => vi.fn())
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/modules/auth/http-auth', () => ({useAuthorizedHttpUrl: (url?: string) => url}))
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {useUtils: () => ({client: {files: {getThumbnail: {mutate: getThumbnail}}}})},
}))
vi.mock('@/features/files/components/shared/file-item-icon', () => ({FileItemIcon: () => null}))
vi.mock('@/features/files/components/file-viewer/shell/context', () => ({
	useViewerSize: () => {},
	ViewerBackdrop: () => null,
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => getThumbnail.mockReset())

async function render(name: string, type: string) {
	const item = {name, path: `/Home/${name}`, type, modified: 1, size: 2, operations: []} as unknown as FileSystemItem
	const container = document.createElement('div')
	const root = createRoot(container)
	await act(async () =>
		root.render(
			<QueryClientProvider client={new QueryClient()}>
				<ImageViewer item={item} mode='open' />
			</QueryClientProvider>,
		),
	)
	// React Query batches its notifications on a timer: let one pass
	await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))
	return {container, unmount: () => act(async () => root.unmount())}
}

test('a picture that can’t be shown offers the download its card speaks of', async () => {
	const {container, unmount} = await render('broken.jpg', 'image/jpeg')
	await act(async () => void container.querySelector('img')?.dispatchEvent(new Event('error')))
	const download = container.querySelector('a[download]')
	expect(download?.textContent).toBe('files-viewer.download')
	expect(download?.getAttribute('href')).toBe('/api/files/download?path=%2FHome%2Fbroken.jpg')
	await unmount()
})

test('a picture a browser decodes is read from the file itself', async () => {
	const {container, unmount} = await render('photo.jpg', 'image/jpeg')
	expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/files/view?path=%2FHome%2Fphoto.jpg')
	expect(getThumbnail).not.toHaveBeenCalled()
	await unmount()
})

test('a HEIC, TIFF or RAW picture is shown from the rendition umbreld makes of it', async () => {
	getThumbnail.mockResolvedValue('/api/files/thumbnail/rendition.webp?path=%2FHome%2Fphoto.heic')
	const {container, unmount} = await render('photo.heic', 'image/heic')
	expect(getThumbnail).toHaveBeenCalledWith({path: '/Home/photo.heic', variant: 'preview-1280-webp-v2'})
	expect(container.querySelector('img')?.getAttribute('src')).toBe(
		'/api/files/thumbnail/rendition.webp?path=%2FHome%2Fphoto.heic',
	)
	await unmount()
})

test('a rendition that can’t be made offers the download instead', async () => {
	getThumbnail.mockRejectedValue(new Error('Unsupported or missing thumbnail source'))
	const {container, unmount} = await render('photo.dng', 'image/x-adobe-dng')
	expect(container.querySelector('img')).toBeNull()
	expect(container.querySelector('a[download]')?.getAttribute('href')).toBe(
		'/api/files/download?path=%2FHome%2Fphoto.dng',
	)
	await unmount()
})
