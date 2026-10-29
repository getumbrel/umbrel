// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect, test, vi} from 'vitest'

import SlidesViewer from '@/features/files/components/file-viewer/slides-viewer'
import type {FileSystemItem} from '@/features/files/types'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/modules/auth/http-auth', () => ({useAuthorizedHttpUrl: (url?: string) => url}))
vi.mock('@/features/files/components/shared/file-item-icon', () => ({FileItemIcon: () => null}))
vi.mock('@/features/files/providers/files-capabilities-context', () => ({useIsFilesReadOnly: () => false}))
vi.mock('@/features/files/components/file-viewer/shell/use-file-bytes', () => ({
	useFileBytes: () => ({status: 'ready', bytes: new ArrayBuffer(8), revision: '"r1"'}),
}))
// A legacy binary .ppt renamed .pptx: the engine finds an OLE file where a package should be
vi.mock('@/features/files/components/file-viewer/slides-viewer/engine', () => {
	class PresentationError extends Error {
		constructor(
			readonly code: string,
			message: string,
		) {
			super(message)
		}
	}
	return {PresentationError, openPresentation: async () => Promise.reject(new PresentationError('unsupported', 'OLE'))}
})
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

test('a presentation in the older PowerPoint format says so, rather than that it may be damaged', async () => {
	const item = {name: 'old.pptx', path: '/Home/old.pptx', type: 'pptx', operations: []} as unknown as FileSystemItem
	const container = document.createElement('div')
	const root = createRoot(container)
	await act(async () => root.render(<SlidesViewer item={item} mode='open' />))
	expect(container.querySelector('h3')?.textContent).toBe('files-slides.damaged-title')
	expect(container.querySelector('h3 + p')?.textContent).toBe('files-slides.legacy-detail')
	await act(async () => root.unmount())
})
