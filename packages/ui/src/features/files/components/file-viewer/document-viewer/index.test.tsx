// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect, test, vi} from 'vitest'

import DocumentViewer from '@/features/files/components/file-viewer/document-viewer'
import type {FileSystemItem} from '@/features/files/types'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/modules/auth/http-auth', () => ({useAuthorizedHttpUrl: (url?: string) => url}))
vi.mock('@/features/files/components/shared/file-item-icon', () => ({FileItemIcon: () => null}))
vi.mock('@/features/files/hooks/use-is-touch-device', () => ({useIsTouchDevice: () => false}))
// The file's bytes, and whether they were asked for
const useFileBytes = vi.hoisted(() => vi.fn(() => ({status: 'loading'})))
vi.mock('@/features/files/components/file-viewer/shell/use-file-bytes', async (importOriginal) => ({
	...(await importOriginal()),
	useFileBytes,
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

test('a document too large to hold while open is never downloaded: it says so, with the file to download', async () => {
	const item = {name: 'huge.docx', path: '/Home/huge.docx', type: 'docx', size: 513 * 2 ** 20, operations: []}
	const container = document.createElement('div')
	const root = createRoot(container)
	await act(async () => root.render(<DocumentViewer item={item as unknown as FileSystemItem} mode='open' />))
	expect(container.querySelector('h3')?.textContent).toBe('files-document.too-large-title')
	expect(container.querySelector('h3 + p')?.textContent).toBe('files-viewer.too-large-detail')
	expect(container.querySelector('a[download]')).not.toBeNull()
	expect(useFileBytes).not.toHaveBeenCalled()
	await act(async () => root.unmount())
})
