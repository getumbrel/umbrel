// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect, test, vi} from 'vitest'

import {AudioViewer} from '@/features/files/components/file-viewer/audio-viewer'
import type {FileSystemItem} from '@/features/files/types'

const island = vi.hoisted(() => ({audio: {path: null as string | null, name: null as string | null}}))
vi.mock('@/providers/global-files', () => ({
	useGlobalFiles: () => ({setAudio: (audio: typeof island.audio) => void (island.audio = audio)}),
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const song = (name: string) => ({name, path: `/Home/${name}`, type: 'audio/mpeg'}) as FileSystemItem

test('a quick look plays in the island only while it’s looked at; an opened file plays on', async () => {
	const root = createRoot(document.createElement('div'))
	await act(async () => root.render(<AudioViewer item={song('a.mp3')} mode='preview' />))
	expect(island.audio.path).toBe('/Home/a.mp3')
	// Stepped on to the next song, which plays in its place
	await act(async () => root.render(<AudioViewer item={song('b.mp3')} mode='preview' />))
	expect(island.audio.path).toBe('/Home/b.mp3')
	// Closed, or stepped on to a file the island doesn't play
	await act(async () => root.render(null))
	expect(island.audio.path).toBeNull()

	await act(async () => root.render(<AudioViewer item={song('a.mp3')} mode='open' />))
	await act(async () => root.render(null))
	expect(island.audio.path).toBe('/Home/a.mp3')
	await act(async () => root.unmount())
})
