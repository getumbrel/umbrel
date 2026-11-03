// @vitest-environment jsdom

import {act, type ReactNode} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, expect, test, vi} from 'vitest'

import VideoViewer from '@/features/files/components/file-viewer/video-viewer'
import type {FileSystemItem} from '@/features/files/types'

const previewUrl = vi.hoisted(() => ({current: {status: 'error', url: '', retry: vi.fn()}}))
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('react-video-kit', () => {
	// Every part a plain wrapper, the media a bare video element
	const Part = ({children}: {children?: ReactNode}) => <>{children}</>
	const parts = ['Root', 'Backdrop', 'Header', 'Center', 'Footer', 'Title', 'Timeline', 'Loading']
	const buttons = ['PlayPause', 'SeekBack', 'SeekForward', 'FullscreenToggle', 'PipToggle']
	return {
		Video: {
			...Object.fromEntries([...parts, ...buttons].map((name) => [name, Part])),
			Media: () => (
				<video>
					<source />
				</video>
			),
			Volume: {Button: Part, Slider: Part},
			Time: {Current: Part, Remaining: Part},
		},
	}
})
vi.mock('@/modules/auth/http-auth', () => ({
	useAuthorizedHttpUrlQuery: () => previewUrl.current,
	useAuthorizedHttpUrl: (url: string) => url,
}))
vi.mock('@/features/files/components/shared/file-item-icon', () => ({FileItemIcon: () => null}))
vi.mock('@/features/files/components/file-viewer/shell/context', () => ({useViewerSize: () => {}}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const item = {name: 'clip.mp4', path: '/Home/clip.mp4', type: 'video/mp4', operations: []} as unknown as FileSystemItem

// What the video element reports, as a browser would once its metadata is in or it fails
const fresh = {
	readyState: 0,
	networkState: 0,
	currentSrc: '',
	videoWidth: 0,
	videoHeight: 0,
	error: null as {code: number} | null,
}
const media = {...fresh}
for (const key of Object.keys(media) as (keyof typeof media)[])
	Object.defineProperty(HTMLVideoElement.prototype, key, {configurable: true, get: () => media[key]})
vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
// jsdom has no MediaError
vi.stubGlobal('MediaError', {MEDIA_ERR_NETWORK: 2, MEDIA_ERR_DECODE: 3})

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
	await act(async () => roots.splice(0).forEach((root) => root.unmount()))
	Object.assign(media, fresh)
})
async function render() {
	const container = document.createElement('div')
	const root = createRoot(container)
	roots.push(root)
	await act(async () => root.render(<VideoViewer item={item} mode='open' />))
	return container
}

test('a video the Umbrel couldn’t be asked for says so, and tries again', async () => {
	previewUrl.current = {status: 'error', url: '', retry: vi.fn()}
	const container = await render()
	expect(container.querySelector('h3')?.textContent).toBe('files-viewer.unreachable-title')
	await act(async () => container.querySelector('button')?.click())
	expect(previewUrl.current.retry).toHaveBeenCalled()
})

test('the player takes the video’s shape, whether its size arrives before the player mounts or after', async () => {
	previewUrl.current = {status: 'ready', url: 'blob:clip', retry: vi.fn()}
	const shape = (container: HTMLElement) =>
		parseFloat(container.querySelector('video')!.parentElement!.style.aspectRatio)

	// 16:9 until it's known, then the video's own
	const later = await render()
	expect(shape(later)).toBe(16 / 9)
	Object.assign(media, {readyState: HTMLMediaElement.HAVE_METADATA, videoWidth: 1080, videoHeight: 1920})
	await act(async () => later.querySelector('video')!.dispatchEvent(new Event('loadedmetadata')))
	expect(shape(later)).toBe(1080 / 1920)

	// Already known as it mounts
	Object.assign(media, {videoWidth: 1440, videoHeight: 1080})
	expect(shape(await render())).toBe(1440 / 1080)

	// No picture, no shape to take
	Object.assign(media, {videoWidth: 0, videoHeight: 0})
	expect(shape(await render())).toBe(16 / 9)
})

test('a video the browser can’t play says so, and offers the download', async () => {
	previewUrl.current = {status: 'ready', url: 'blob:clip', retry: vi.fn()}

	// Its format or codecs fail its source, before any of it plays
	const unsupported = await render()
	await act(async () => unsupported.querySelector('source')!.dispatchEvent(new Event('error')))
	expect(unsupported.querySelector('video')).toBeNull()
	expect(unsupported.querySelector('h3')?.textContent).toBe('files-video.unplayable-title')
	expect(unsupported.querySelector('a')?.getAttribute('download')).toBe('clip.mp4')

	// Damage fails the video itself as it decodes
	const damaged = await render()
	media.error = {code: MediaError.MEDIA_ERR_DECODE}
	await act(async () => damaged.querySelector('video')!.dispatchEvent(new Event('error')))
	expect(damaged.querySelector('h3')?.textContent).toBe('files-video.unplayable-title')

	// Either may be over before the player is on the page, the video loading as it's built
	expect((await render()).querySelector('h3')?.textContent).toBe('files-video.unplayable-title')
	Object.assign(media, {error: null, networkState: HTMLMediaElement.NETWORK_NO_SOURCE, currentSrc: 'blob:clip'})
	expect((await render()).querySelector('h3')?.textContent).toBe('files-video.unplayable-title')
})

test('a video that plays stays in the player, even when its connection drops', async () => {
	previewUrl.current = {status: 'ready', url: 'blob:clip', retry: vi.fn()}
	// Not yet looking for its source as it mounts
	media.networkState = HTMLMediaElement.NETWORK_NO_SOURCE
	const container = await render()
	expect(container.querySelector('h3')).toBeNull()
	const video = container.querySelector('video')!
	Object.assign(media, {readyState: HTMLMediaElement.HAVE_METADATA, videoWidth: 1920, videoHeight: 1080})
	await act(async () => video.dispatchEvent(new Event('loadedmetadata')))
	media.error = {code: MediaError.MEDIA_ERR_NETWORK}
	await act(async () => video.dispatchEvent(new Event('error')))
	expect(container.querySelector('video')).toBe(video)
	expect(container.querySelector('h3')).toBeNull()
})
